import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchEvent, LaunchState } from '@shared/launch';
import type { WindowFailure } from '@shared/window-failure';
import { GameLifecycle, type CloseEvent, type LifecycleWindow } from '../lifecycle';
import { recoveryPage, recoveryPageUrl } from './page';
import {
  BOOT_GRACE_MS,
  RECOVERY_ACTION_PREFIX,
  RETRY_WINDOW_MS,
  UNRESPONSIVE_GRACE_MS,
  WindowRecovery,
  recoveryAction,
  type RecoveryView,
} from './recovery';
import { ru } from '@shared/i18n/ru';

const APP = 'app://launcher/index.html';
const CRASH = { reason: 'crashed', exitCode: 5 };

interface Timer {
  action: () => void;
  ms: number;
  cleared: boolean;
}

let now: number;
let playing: boolean;
let loads: number;
let pages: RecoveryView[];
let lines: string[];
let reports: WindowFailure[];
let timers: Timer[];
const closeWindow = vi.fn();
const crashRenderer = vi.fn();

function make(report = true, appUrl = APP): WindowRecovery {
  return new WindowRecovery({
    appUrl,
    loadApp: (): void => {
      loads += 1;
    },
    showPage: (view): void => {
      pages.push(view);
    },
    closeWindow,
    crashRenderer,
    playing: () => playing,
    report: report
      ? (failure): void => {
          reports.push(failure);
        }
      : null,
    log: (line): void => {
      lines.push(line);
    },
    now: () => now,
    setTimer: (action, ms): Timer => {
      const timer = { action, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer): void => {
      (timer as Timer).cleared = true;
    },
  });
}

function fire(ms: number): void {
  const due = timers.filter((timer) => timer.ms === ms && !timer.cleared);
  for (const timer of due) {
    timer.cleared = true;
    timer.action();
  }
}

beforeEach(() => {
  now = 1_000_000;
  playing = false;
  loads = 0;
  pages = [];
  lines = [];
  reports = [];
  timers = [];
  closeWindow.mockClear();
  crashRenderer.mockClear();
});

describe('a renderer process that is gone', () => {
  it('is reloaded once by itself, and a second loss soon after shows the page', () => {
    const recovery = make();
    recovery.gone(CRASH);
    expect(loads).toBe(1);
    expect(pages).toEqual([]);
    now += 3_000;
    recovery.gone({ reason: 'oom', exitCode: -536870904 });
    expect(loads).toBe(1);
    expect(pages).toEqual([{ kind: 'gone', playing: false, reported: true }]);
  });

  it('never loops: a renderer that dies on every start is reloaded once per click', () => {
    const recovery = make();
    for (let round = 0; round < 50; round += 1) {
      recovery.gone(CRASH);
      now += 200;
    }
    expect(loads).toBe(1);
    expect(pages).toHaveLength(2);
    recovery.act(`${RECOVERY_ACTION_PREFIX}restart`);
    expect(loads).toBe(2);
    recovery.gone(CRASH);
    expect(loads).toBe(2);
    expect(pages).toHaveLength(3);
  });

  it('a loss long after the last one is again reloaded quietly', () => {
    const recovery = make();
    recovery.gone(CRASH);
    now += RETRY_WINDOW_MS;
    recovery.gone(CRASH);
    expect(loads).toBe(2);
    expect(pages).toEqual([]);
  });

  it('a clean exit of the renderer is not a failure', () => {
    const recovery = make();
    recovery.gone({ reason: 'clean-exit', exitCode: 0 });
    expect(loads).toBe(0);
    expect(lines).toEqual([]);
  });

  it('writes the reason, the exit code and the address without the route to the log', () => {
    const recovery = make();
    recovery.navigatedInPage('app://launcher/index.html?q=secret#/server/42');
    recovery.gone(CRASH);
    expect(lines).toEqual(['window: gone reason=crashed exitCode=5 url=app://launcher/index.html']);
  });
});

describe('a graphics process that is gone', () => {
  const details = { reason: 'crashed', exitCode: 133 };

  it('reloads a shown window once, and a second loss soon after shows the page', () => {
    const recovery = make();
    recovery.gpuGone(details, true);
    expect(loads).toBe(1);
    expect(lines).toEqual([
      'window: gpu reason=crashed exitCode=133 url=app://launcher/index.html',
    ]);
    now += 2_000;
    recovery.gpuGone(details, true);
    expect(loads).toBe(1);
    expect(pages).toEqual([{ kind: 'gpu', playing: false, reported: true }]);
    recovery.gpuGone(details, true);
    expect(pages).toHaveLength(1);
  });

  it('leaves a hidden window and a clean exit of the process alone', () => {
    const recovery = make();
    recovery.gpuGone(details, false);
    recovery.gpuGone({ reason: 'clean-exit', exitCode: 0 }, true);
    expect(loads).toBe(0);
    expect(lines).toEqual([]);
  });

  it('shares the loop guard with the renderer: a crash after its reload shows the page', () => {
    const recovery = make();
    recovery.gpuGone(details, true);
    recovery.gone(CRASH);
    expect(loads).toBe(1);
    expect(pages).toEqual([{ kind: 'gone', playing: false, reported: true }]);
  });
});

describe('a page that did not load', () => {
  const failure = {
    errorCode: -6,
    description: 'ERR_FILE_NOT_FOUND',
    url: APP,
    isMainFrame: true,
  };

  it('is tried again once, then the page says the window did not load', () => {
    const recovery = make();
    recovery.loadFailed(failure);
    expect(loads).toBe(1);
    recovery.loadFailed(failure);
    expect(pages).toEqual([{ kind: 'load', playing: false, reported: true }]);
    expect(lines[0]).toBe(
      'window: load reason=ERR_FILE_NOT_FOUND errorCode=-6 url=app://launcher/index.html',
    );
  });

  it('ignores a cancelled load, a frame and the failures of its own page', () => {
    const recovery = make();
    recovery.loadFailed({ ...failure, errorCode: -3 });
    recovery.loadFailed({ ...failure, isMainFrame: false });
    expect(loads).toBe(0);
    recovery.loadFailed(failure);
    recovery.loadFailed(failure);
    recovery.loadFailed({ ...failure, url: `${RECOVERY_ACTION_PREFIX}restart` });
    expect(pages).toHaveLength(1);
    expect(loads).toBe(1);
  });
});

describe('a window that hangs', () => {
  it('is given time, then its renderer is ended and the window reloaded', () => {
    const recovery = make();
    recovery.unresponsive();
    expect(crashRenderer).not.toHaveBeenCalled();
    fire(UNRESPONSIVE_GRACE_MS);
    expect(crashRenderer).toHaveBeenCalledOnce();
    recovery.gone({ reason: 'crashed', exitCode: 1 });
    expect(loads).toBe(1);
    expect(lines).toEqual(['window: hang reason=crashed exitCode=1 url=app://launcher/index.html']);
    recovery.unresponsive();
    fire(UNRESPONSIVE_GRACE_MS);
    recovery.gone({ reason: 'crashed', exitCode: 1 });
    expect(pages).toEqual([{ kind: 'hang', playing: false, reported: true }]);
  });
});

describe('an application that did not start', () => {
  it('a renderer that reports a failed start is reloaded, then the page is shown', () => {
    const recovery = make();
    recovery.navigationStarted();
    recovery.bootFailed();
    expect(loads).toBe(1);
    recovery.navigationStarted();
    recovery.bootFailed();
    expect(pages).toEqual([{ kind: 'boot', playing: false, reported: true }]);
  });

  it('a loaded page that never says it is mounted counts as an empty window', () => {
    const recovery = make();
    recovery.navigationStarted();
    recovery.loaded(APP);
    fire(BOOT_GRACE_MS);
    expect(loads).toBe(1);
    expect(lines).toEqual(['window: boot reason=not-mounted url=app://launcher/index.html']);
  });

  it('a mounted application stops the wait, before or after the load event', () => {
    const recovery = make();
    recovery.navigationStarted();
    recovery.ready();
    recovery.loaded(APP);
    expect(timers).toEqual([]);
    recovery.navigationStarted();
    recovery.loaded(`${APP}#/servers`);
    recovery.ready();
    fire(BOOT_GRACE_MS);
    expect(loads).toBe(0);
  });

  it('another page of the build and the dev server root are told apart from the app', () => {
    const recovery = make();
    recovery.loaded('app://launcher/demo.html');
    expect(timers).toEqual([]);
    const dev = make(true, 'http://localhost:5190');
    dev.loaded('http://localhost:5190/#/servers');
    expect(timers).toHaveLength(1);
  });

  it('a late complaint from a mounted application does not take the window down', () => {
    const recovery = make();
    recovery.ready();
    recovery.bootFailed();
    expect(loads).toBe(0);
  });
});

describe('the recovery page', () => {
  it('its links act only while it is shown', () => {
    const recovery = make();
    expect(recovery.act(`${RECOVERY_ACTION_PREFIX}restart`)).toBe(false);
    expect(loads).toBe(0);
    recovery.gone(CRASH);
    recovery.gone(CRASH);
    expect(recovery.act('app://launcher/index.html')).toBe(false);
    expect(recovery.act(`${RECOVERY_ACTION_PREFIX}close`)).toBe(true);
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(recovery.act(`${RECOVERY_ACTION_PREFIX}restart`)).toBe(true);
    expect(loads).toBe(2);
    expect(recovery.shown).toBeNull();
    expect(recoveryAction(`${RECOVERY_ACTION_PREFIX}restart/../x`)).toBeNull();
  });

  it('is one document without scripts or outside files, with one action and a way to close', () => {
    const html = recoveryPage({ kind: 'gone', playing: false, reported: false });
    expect(html).toContain(ru.recovery.title.gone);
    expect(html).toContain(`href="${RECOVERY_ACTION_PREFIX}restart"`);
    expect(html).toContain(`href="${RECOVERY_ACTION_PREFIX}close"`);
    expect(html).toContain('-webkit-app-region:drag');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script|<link|<img|src=|url\(|@import/);
    expect(html).toMatch(/--mc-bg:\s*#/);
    expect(html).not.toContain(ru.recovery.game);
    expect(html).not.toContain(ru.recovery.reported);
  });

  it.each(['gone', 'load', 'hang', 'boot', 'gpu'] as const)(
    'the %s title is a plain sentence without the word error or a code',
    (kind) => {
      const title = ru.recovery.title[kind];
      expect(recoveryPage({ kind, playing: false, reported: false })).toContain(title);
      expect(title).not.toMatch(/ошибк|\d/i);
    },
  );

  it('says that the game goes on and that the report has left, in the same quiet lines', () => {
    const html = recoveryPage({ kind: 'load', playing: true, reported: true });
    expect(html).toContain(ru.recovery.game);
    expect(html).toContain(ru.recovery.reported);
    expect(
      decodeURIComponent(recoveryPageUrl({ kind: 'load', playing: true, reported: true })),
    ).toBe(`data:text/html;charset=utf-8,${html}`);
  });
});

describe('the failure report', () => {
  it('is handed over once per failure, at the moment of the failure', () => {
    const recovery = make();
    recovery.navigatedInPage(`${APP}#/server/42`);
    recovery.gone(CRASH);
    recovery.gone(CRASH);
    expect(reports).toEqual([
      { kind: 'gone', reason: 'crashed', exitCode: 5, errorCode: null, url: `${APP}#/server/42` },
      { kind: 'gone', reason: 'crashed', exitCode: 5, errorCode: null, url: `${APP}#/server/42` },
    ]);
  });

  it('without a sender nothing is promised on the page', () => {
    const recovery = make(false);
    recovery.gone(CRASH);
    recovery.gone(CRASH);
    expect(pages).toEqual([{ kind: 'gone', playing: false, reported: false }]);
  });
});

describe('a running game', () => {
  class FakeWindow implements LifecycleWindow {
    destroyed = false;
    hidden = false;
    private listener: ((event: CloseEvent) => void) | null = null;

    isDestroyed(): boolean {
      return this.destroyed;
    }

    hide(): void {
      this.hidden = true;
    }

    minimize(): void {
      this.hidden = true;
    }

    on(_event: 'close', listener: (event: CloseEvent) => void): this {
      this.listener = listener;
      return this;
    }

    close(): void {
      let prevented = false;
      this.listener?.({
        preventDefault: () => {
          prevented = true;
        },
      });
      this.destroyed = !prevented;
    }
  }

  it('is not stopped by a dead window, by its restart or by closing the page', () => {
    const listeners: ((event: LaunchEvent) => void)[] = [];
    const kill = vi.fn(() => Promise.resolve());
    const quit = vi.fn();
    const window = new FakeWindow();
    const lifecycle = new GameLifecycle<FakeWindow>({
      launch: {
        onEvent: (listener): (() => void) => {
          listeners.push(listener);
          return (): void => undefined;
        },
        kill,
        whenIdle: (): Promise<void> => Promise.resolve(),
      },
      whileGame: (): 'keep' => 'keep',
      openWindow: (): FakeWindow => window,
      revealWindow: (): void => undefined,
      navigate: (): void => undefined,
      createTray: (): { update: () => void; destroy: () => void } => ({
        update: (): void => undefined,
        destroy: (): void => undefined,
      }),
      confirm: (): Promise<boolean> => Promise.resolve(true),
      quit,
    });
    lifecycle.open();
    const state = { phase: 'running' } as LaunchState;
    for (const listener of listeners) {
      listener({ kind: 'game', event: { type: 'started', pid: 1 }, state });
    }
    playing = lifecycle.playing;
    closeWindow.mockImplementation(() => {
      window.close();
    });
    const recovery = make();
    recovery.gone(CRASH);
    recovery.gone(CRASH);
    expect(pages).toEqual([{ kind: 'gone', playing: true, reported: true }]);
    recovery.act(`${RECOVERY_ACTION_PREFIX}close`);
    expect(window.destroyed).toBe(false);
    expect(window.hidden).toBe(true);
    recovery.act(`${RECOVERY_ACTION_PREFIX}restart`);
    expect(kill).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(lifecycle.playing).toBe(true);
  });
});
