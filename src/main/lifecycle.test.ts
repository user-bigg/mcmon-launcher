import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNavigation } from '@shared/ipc';
import type { GameEvent, LaunchEvent, LaunchPhase, LaunchState } from '@shared/launch';
import type { WhileGame } from '@shared/settings';
import {
  GameLifecycle,
  QUIET_REVEAL_MS,
  type CloseEvent,
  type ConfirmKind,
  type LifecycleWindow,
  type RevealOptions,
  type TrayActions,
  type TrayGame,
} from './lifecycle';

class FakeWindow implements LifecycleWindow {
  destroyed = false;
  visible = true;
  minimized = false;
  focused = true;
  readonly navigations: AppNavigation[] = [];
  private closeListener: ((event: CloseEvent) => void) | null = null;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  hide(): void {
    this.visible = false;
    this.focused = false;
  }

  minimize(): void {
    this.minimized = true;
  }

  on(_event: 'close', listener: (event: CloseEvent) => void): this {
    this.closeListener = listener;
    return this;
  }

  close(): void {
    this.tryClose();
  }

  tryClose(): boolean {
    const result = { prevented: false };
    this.closeListener?.({
      preventDefault: () => {
        result.prevented = true;
      },
    });
    this.destroyed = !result.prevented;
    return result.prevented;
  }
}

const target = { kind: 'server', serverId: 7, minecraft: '26.3', address: 'a.example' } as const;

let listeners: ((event: LaunchEvent) => void)[];
let windows: FakeWindow[];
let trayActions: TrayActions | null;
let trays: { destroy: ReturnType<typeof vi.fn>; games: (TrayGame | null)[] }[];
let background: boolean;
let leftInTray: number;
let gameName: string | null;
let quitCancelled: number;
const cancel = vi.fn(() => Promise.resolve());
let timers: { action: () => void; ms: number }[];
let seq: number;
let now: number;
let mode: WhileGame;
let answer: boolean;
let asked: ConfirmKind[];
let reveals: RevealOptions[];
let hiddenToTray: number;
const kill = vi.fn(() => Promise.resolve());
const quit = vi.fn();

function state(phase: LaunchPhase): LaunchState {
  seq += 1;
  return {
    seq,
    phase,
    operationId: 1,
    target,
    progress: null,
    session: null,
    skins: null,
    windowReady: false,
    windowSlow: false,
    windowDialog: false,
    lastError: null,
    lastExit: null,
    lastCrash: null,
  };
}

function emit(event: LaunchEvent): void {
  for (const listener of [...listeners]) {
    listener(event);
  }
}

function game(event: GameEvent): void {
  emit({ kind: 'game', event, state: state('running') });
}

function phase(next: LaunchPhase): void {
  emit({ kind: 'phase', phase: next, operationId: 1, state: state(next) });
}

function startGame(): void {
  phase('preparing');
  phase('running');
  game({ type: 'started', pid: 1 });
}

function slowStart(slow: boolean): void {
  emit({ kind: 'progress', state: { ...state('running'), windowSlow: slow } });
}

function exitGame(code = 0): void {
  game({ type: 'exit', code, signal: null, byUser: false });
  phase('idle');
}

let dock: ('hide' | 'show')[] = [];

function makeLifecycle(): GameLifecycle<FakeWindow> {
  return new GameLifecycle<FakeWindow>({
    launch: {
      onEvent: (next): (() => void) => {
        listeners.push(next);
        return (): void => {
          listeners = listeners.filter((item) => item !== next);
        };
      },
      kill,
      cancel,
      whenIdle: (): Promise<void> =>
        new Promise((resolve) => {
          listeners.push((event) => {
            if (event.kind === 'phase' && event.phase === 'idle') {
              resolve();
            }
          });
        }),
    },
    whileGame: () => mode,
    openWindow: (): FakeWindow => {
      const window = new FakeWindow();
      windows.push(window);
      return window;
    },
    revealWindow: (window, options): void => {
      reveals.push(options);
      window.visible = true;
      window.minimized = false;
      window.focused = options.focus;
    },
    navigate: (window, navigation): void => {
      window.navigations.push(navigation);
    },
    createTray: (actions): { update: (game: TrayGame | null) => void; destroy: () => void } => {
      trayActions = actions;
      const games: (TrayGame | null)[] = [];
      const tray = { destroy: vi.fn(), games };
      trays.push(tray);
      return {
        destroy: tray.destroy,
        update: (game): void => {
          games.push(game);
        },
      };
    },
    background: () => background,
    gameName: () => gameName,
    onLeftInTray: (): void => {
      leftInTray += 1;
    },
    onQuitCancelled: (): void => {
      quitCancelled += 1;
    },
    confirm: (kind): Promise<boolean> => {
      asked.push(kind);
      return Promise.resolve(answer);
    },
    onHiddenToTray: (): void => {
      hiddenToTray += 1;
    },
    quit,
    dock: {
      hide: (): void => {
        dock.push('hide');
      },
      show: (): void => {
        dock.push('show');
      },
    },
    now: () => now,
    setTimer: (action, ms): number => {
      timers.push({ action, ms });
      return timers.length;
    },
  });
}

beforeEach(() => {
  listeners = [];
  windows = [];
  trayActions = null;
  trays = [];
  timers = [];
  seq = 0;
  now = 1_000_000;
  mode = 'tray';
  answer = true;
  asked = [];
  reveals = [];
  hiddenToTray = 0;
  background = false;
  leftInTray = 0;
  gameName = null;
  quitCancelled = 0;
  dock = [];
  cancel.mockClear();
  kill.mockClear();
  quit.mockClear();
});

describe('GameLifecycle', () => {
  it('tray: window-ready sends the window to /idle and the tray, the game exiting restores the previous screen', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    expect(window.visible).toBe(true);
    game({ type: 'window-ready', afterMs: 10 });
    expect(window.visible).toBe(false);
    expect(window.navigations).toEqual([{ kind: 'idle' }]);
    expect(trays).toHaveLength(1);
    expect(hiddenToTray).toBe(1);
    expect(lifecycle.canQuitOnAllClosed()).toBe(false);
    exitGame();
    expect(window.visible).toBe(true);
    expect(window.navigations).toEqual([{ kind: 'idle' }, { kind: 'restore' }]);
    expect(trays[0]?.destroy).not.toHaveBeenCalled();
    expect(trays[0]?.games.at(-1)).toBeNull();
    expect(lifecycle.canQuitOnAllClosed()).toBe(true);
  });

  it('the launcher stays on screen for as long as the game has no window', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    expect(timers).toHaveLength(0);
    expect(window.visible).toBe(true);
    expect(trays).toHaveLength(0);
  });

  it('the setting is read when the game window appears, not when the process starts', () => {
    mode = 'keep';
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    mode = 'tray';
    game({ type: 'window-ready', afterMs: 10 });
    expect(window.visible).toBe(false);
  });

  it('a setting changed after the window appeared waits for the next launch', () => {
    mode = 'keep';
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    mode = 'tray';
    expect(window.visible).toBe(true);
    exitGame();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    expect(window.visible).toBe(false);
  });

  it('a slow start brings back a launcher closed to the tray, without taking the focus', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    window.tryClose();
    expect(window.visible).toBe(false);
    slowStart(true);
    expect(window.visible).toBe(true);
    expect(reveals).toEqual([{ focus: false }]);
    expect(window.navigations.at(-1)).toEqual({ kind: 'restore' });
  });

  it('the launcher comes back once per question: closed again, it stays closed until the next one', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    window.tryClose();
    slowStart(true);
    window.tryClose();
    slowStart(true);
    expect(window.visible).toBe(false);
    slowStart(false);
    slowStart(true);
    expect(window.visible).toBe(true);
    expect(reveals).toHaveLength(2);
  });

  it('a slow start with the launcher on screen changes nothing', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    slowStart(true);
    expect(reveals).toEqual([]);
    expect(window.navigations).toEqual([]);
  });

  it('minimize: the window minimizes to the taskbar, no tray and no /idle', () => {
    mode = 'minimize';
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    expect(window.minimized).toBe(true);
    expect(window.visible).toBe(true);
    expect(trays).toHaveLength(0);
    expect(window.navigations).toEqual([]);
    exitGame();
    expect(window.minimized).toBe(false);
  });

  it('keep: the window stays, closing it during the game sends it to the tray', () => {
    mode = 'keep';
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    expect(timers).toHaveLength(0);
    expect(window.visible).toBe(true);
    expect(window.tryClose()).toBe(true);
    expect(window.destroyed).toBe(false);
    expect(window.visible).toBe(false);
    expect(trays).toHaveLength(1);
  });

  it('keep: a clean exit leaves the window and screen unchanged', () => {
    mode = 'keep';
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    exitGame();
    expect(reveals).toEqual([]);
    expect(window.navigations).toEqual([]);
  });

  it('crash: a real crash → exit sequence during the running phase leads to /crash/<id>', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    game({ type: 'crash', code: 1, reportPath: null });
    game({ type: 'exit', code: 1, signal: null, byUser: false });
    expect(lifecycle.canQuitOnAllClosed()).toBe(true);
    expect(window.visible).toBe(true);
    expect(window.navigations.at(-1)).toEqual({ kind: 'crash', instanceId: 'server-7' });
    phase('idle');
    expect(window.navigations.at(-1)).toEqual({ kind: 'crash', instanceId: 'server-7' });
  });

  it('a crash with the window open also opens the crash screen', () => {
    mode = 'keep';
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'crash', code: 1, reportPath: null });
    exitGame(1);
    expect(window.navigations).toEqual([{ kind: 'crash', instanceId: 'server-7' }]);
  });

  it('after being shown from the tray, the window is not hidden until the next started', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    window.tryClose();
    expect(window.visible).toBe(false);
    trayActions?.show();
    expect(window.visible).toBe(true);
    expect(window.navigations.at(-1)).toEqual({ kind: 'restore' });
    game({ type: 'window-ready', afterMs: 100_000 });
    expect(window.visible).toBe(true);
    exitGame();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    expect(window.visible).toBe(false);
  });

  it('a deep link or second instance during the game: shown without focus, at most once every 2s', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    lifecycle.revealForLink();
    expect(reveals).toEqual([{ focus: false }]);
    expect(window.visible).toBe(true);
    window.hide();
    now += QUIET_REVEAL_MS - 1;
    lifecycle.revealForLink();
    expect(reveals).toHaveLength(1);
    now += 1;
    lifecycle.revealForLink();
    expect(reveals).toHaveLength(2);
  });

  it('a deep link without a game shows the window with focus', () => {
    const lifecycle = makeLifecycle();
    lifecycle.open();
    lifecycle.revealForLink();
    expect(reveals).toEqual([{ focus: true }]);
  });

  it("'Quit' from the tray during the game: confirmation, a graceful close, waiting for exit, then quit", async () => {
    const lifecycle = makeLifecycle();
    lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    trayActions?.quit();
    await vi.waitFor(() => {
      expect(kill).toHaveBeenCalledOnce();
    });
    expect(asked).toEqual(['quit']);
    expect(quit).not.toHaveBeenCalled();
    exitGame();
    await vi.waitFor(() => {
      expect(quit).toHaveBeenCalledOnce();
    });
    expect(lifecycle.holdQuit()).toBe(false);
    expect(windows[0]?.navigations).toEqual([{ kind: 'idle' }]);
  });

  it('declining the confirmation leaves the game and launcher running', async () => {
    answer = false;
    const lifecycle = makeLifecycle();
    lifecycle.open();
    startGame();
    expect(lifecycle.holdQuit()).toBe(true);
    await vi.waitFor(() => {
      expect(asked).toEqual(['quit']);
    });
    expect(kill).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it('before-quit without a game does not block quitting or ask for confirmation', () => {
    const lifecycle = makeLifecycle();
    lifecycle.open();
    expect(lifecycle.holdQuit()).toBe(false);
    expect(asked).toEqual([]);
  });

  it('a cancelled quit puts the launcher back to normal: the game hides the window again', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    expect(lifecycle.holdQuit()).toBe(false);
    lifecycle.cancelQuit();
    startGame();
    expect(lifecycle.playing).toBe(true);
    expect(window.tryClose()).toBe(true);
    expect(lifecycle.canQuitOnAllClosed()).toBe(false);
  });

  it('Windows session-end allows quitting without a dialog', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    lifecycle.endSession();
    expect(lifecycle.holdQuit()).toBe(false);
    expect(asked).toEqual([]);
    expect(window.tryClose()).toBe(false);
  });

  it("'End game' in the tray asks for confirmation and closes the game gracefully", async () => {
    const lifecycle = makeLifecycle();
    lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    trayActions?.stopGame();
    await vi.waitFor(() => {
      expect(kill).toHaveBeenCalledOnce();
    });
    expect(asked).toEqual(['stop-game']);
  });

  it('closing the window during installation asks for confirmation', async () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    phase('preparing');
    expect(window.tryClose()).toBe(true);
    await vi.waitFor(() => {
      expect(window.destroyed).toBe(true);
    });
    expect(asked).toEqual(['close-install']);
  });

  it('declining to close during installation leaves the window open', async () => {
    answer = false;
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    phase('preparing');
    window.tryClose();
    await vi.waitFor(() => {
      expect(asked).toEqual(['close-install']);
    });
    expect(window.destroyed).toBe(false);
  });

  it('shutdown destroys the tray, the window no longer stays open', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    lifecycle.shutdown();
    expect(trays[0]?.destroy).toHaveBeenCalledOnce();
    expect(lifecycle.canQuitOnAllClosed()).toBe(true);
    expect(window.tryClose()).toBe(false);
  });

  it('tells when a quit did not happen: the player refused it or the launcher was asked to stay', async () => {
    answer = false;
    const lifecycle = makeLifecycle();
    lifecycle.open();
    startGame();
    expect(lifecycle.holdQuit()).toBe(true);
    await vi.waitFor(() => {
      expect(quitCancelled).toBe(1);
    });
    expect(quit).not.toHaveBeenCalled();
    lifecycle.cancelQuit();
    expect(quitCancelled).toBe(2);
  });

  it('the tray is created once at start and shows the game while it runs', () => {
    gameName = 'Cube Island';
    const lifecycle = makeLifecycle();
    lifecycle.startTray();
    lifecycle.startTray();
    expect(trays).toHaveLength(1);
    expect(trays[0]?.games).toEqual([null, null]);
    lifecycle.open();
    startGame();
    expect(trays[0]?.games.at(-1)).toEqual({ name: 'Cube Island', starting: true });
    game({ type: 'window-ready', afterMs: 10 });
    expect(trays[0]?.games.at(-1)).toEqual({ name: 'Cube Island', starting: false });
    exitGame();
    expect(trays).toHaveLength(1);
    expect(trays[0]?.games.at(-1)).toBeNull();
    expect(trays[0]?.destroy).not.toHaveBeenCalled();
  });

  it('a background start opens no window until the launcher is shown', () => {
    const lifecycle = makeLifecycle();
    lifecycle.startTray();
    lifecycle.stayHidden();
    expect(windows).toHaveLength(0);
    expect(lifecycle.current).toBeNull();
    expect(dock).toEqual(['hide']);
    trayActions?.show();
    expect(windows).toHaveLength(1);
    expect(reveals).toEqual([{ focus: true }]);
    expect(windows[0]?.navigations).toEqual([]);
    expect(dock).toEqual(['hide', 'show']);
  });

  it('with autostart on, closing the window leaves the launcher in the tray', () => {
    background = true;
    const lifecycle = makeLifecycle();
    lifecycle.startTray();
    const window = lifecycle.open();
    expect(window.tryClose()).toBe(false);
    expect(window.destroyed).toBe(true);
    expect(lifecycle.canQuitOnAllClosed()).toBe(false);
    expect(leftInTray).toBe(1);
    expect(quit).not.toHaveBeenCalled();
    lifecycle.revealForLink();
    expect(windows).toHaveLength(2);
  });

  it('the Dock icon goes while the launcher is only in the tray and comes back with the window', () => {
    background = true;
    const lifecycle = makeLifecycle();
    lifecycle.startTray();
    lifecycle.open();
    windows[0]?.tryClose();
    expect(dock).toEqual(['hide']);
    trayActions?.show();
    expect(dock).toEqual(['hide', 'show']);
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    expect(dock).toEqual(['hide', 'show', 'hide']);
    exitGame();
    expect(dock).toEqual(['hide', 'show', 'hide', 'show']);
  });

  it('a quiet reveal during the game leaves the Dock icon hidden until the game is over', () => {
    const lifecycle = makeLifecycle();
    lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    lifecycle.revealForLink();
    expect(dock).toEqual(['hide']);
    exitGame();
    expect(dock).toEqual(['hide', 'show']);
  });

  it('closing the window without the tray mode keeps the Dock icon', () => {
    const lifecycle = makeLifecycle();
    lifecycle.startTray();
    lifecycle.open().tryClose();
    expect(dock).toEqual([]);
  });

  it('a minimized window keeps the Dock icon', () => {
    mode = 'minimize';
    const lifecycle = makeLifecycle();
    lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    exitGame();
    expect(dock).toEqual([]);
  });

  it('with autostart off, closing the window lets the launcher quit', () => {
    const lifecycle = makeLifecycle();
    lifecycle.startTray();
    const window = lifecycle.open();
    expect(window.tryClose()).toBe(false);
    expect(lifecycle.canQuitOnAllClosed()).toBe(true);
    expect(leftInTray).toBe(0);
  });

  it("'Quit' in the tray quits even when the launcher stays in the tray", async () => {
    background = true;
    const lifecycle = makeLifecycle();
    lifecycle.startTray();
    lifecycle.open();
    trayActions?.quit();
    await vi.waitFor(() => {
      expect(quit).toHaveBeenCalledOnce();
    });
    expect(lifecycle.canQuitOnAllClosed()).toBe(true);
  });

  it('closing during installation in the tray mode stops the installation', async () => {
    background = true;
    const lifecycle = makeLifecycle();
    lifecycle.startTray();
    const window = lifecycle.open();
    phase('preparing');
    expect(window.tryClose()).toBe(true);
    await vi.waitFor(() => {
      expect(window.destroyed).toBe(true);
    });
    expect(asked).toEqual(['close-install']);
    expect(cancel).toHaveBeenCalledOnce();
    expect(dock).toEqual(['hide']);
  });

  it('the tray notice appears on each new hide; re-hiding an already hidden window skips it', () => {
    const lifecycle = makeLifecycle();
    const window = lifecycle.open();
    startGame();
    game({ type: 'window-ready', afterMs: 10 });
    expect(hiddenToTray).toBe(1);
    expect(window.tryClose()).toBe(true);
    expect(hiddenToTray).toBe(1);
    trayActions?.show();
    expect(window.tryClose()).toBe(true);
    expect(window.visible).toBe(false);
    expect(hiddenToTray).toBe(2);
  });
});
