import { describe, expect, it } from 'vitest';
import {
  AFTER_GAME_POLLS,
  DIALOG_POLL_MS,
  GameDialogWatch,
  waitsForGameWindow,
  type OwnerWindow,
} from './game-dialog';

// NativeWindowViews of Electron 44: SetEnabled changes its own flag and calls EnableWindow
// only when the system state differs; IsEnabled reads IsWindowEnabled.
class FakeWindow implements OwnerWindow {
  private flag = true;
  system = true;
  readonly calls: boolean[] = [];

  isDestroyed = (): boolean => false;
  isEnabled = (): boolean => this.system;
  setEnabled = (enabled: boolean): void => {
    this.calls.push(enabled);
    if (enabled !== this.flag) {
      this.flag = enabled;
      this.system = enabled;
    }
  };
}

interface Rig {
  watch: GameDialogWatch;
  window: FakeWindow;
  found: number[];
  tick: () => void;
  polling: () => boolean;
  prompt: { open: boolean };
}

function rig(): Rig {
  const window = new FakeWindow();
  const found: number[] = [];
  const prompt = { open: false };
  let run: (() => void) | null = null;
  const watch = new GameDialogWatch({
    window: (): OwnerWindow => window,
    ownPrompt: (): boolean => prompt.open,
    found: (): void => {
      found.push(1);
    },
    setInterval: (next, ms): number => {
      expect(ms).toBe(DIALOG_POLL_MS);
      run = next;
      return 1;
    },
    clearInterval: (): void => {
      run = null;
    },
  });
  return {
    watch,
    window,
    found,
    tick: (): void => {
      run?.();
    },
    polling: () => run !== null,
    prompt,
  };
}

describe("the game's own error dialog owning the launcher window", () => {
  it('a launcher disabled for two polls while the game has no window: enabled again and reported', () => {
    const r = rig();
    r.watch.update(true);
    r.tick();
    r.window.system = false;
    r.tick();
    expect(r.found).toEqual([]);
    r.tick();
    expect(r.found).toEqual([1]);
    expect(r.window.system).toBe(true);
    expect(r.window.calls).toEqual([false, true]);
  });

  it('a blink of a disabled window is not a dialog', () => {
    const r = rig();
    r.watch.update(true);
    r.window.system = false;
    r.tick();
    r.window.system = true;
    r.tick();
    r.window.system = false;
    r.tick();
    expect(r.found).toEqual([]);
  });

  it("the launcher's own message box is left alone", () => {
    const r = rig();
    r.watch.update(true);
    r.prompt.open = true;
    r.window.system = false;
    r.tick();
    r.tick();
    r.tick();
    expect(r.found).toEqual([]);
    expect(r.window.system).toBe(false);
  });

  it('after the game is gone it checks a few times more and then stops polling', () => {
    const r = rig();
    r.watch.update(true);
    r.watch.update(false);
    r.window.system = false;
    r.tick();
    expect(r.window.system).toBe(true);
    expect(r.found).toEqual([]);
    for (let i = 1; i < AFTER_GAME_POLLS; i += 1) {
      r.tick();
    }
    expect(r.polling()).toBe(false);
  });

  it('polls nothing while no game waits for its window', () => {
    const r = rig();
    r.watch.update(false);
    expect(r.polling()).toBe(false);
  });

  it('waits for the window only while the process runs without it', () => {
    expect(waitsForGameWindow({ phase: 'running', windowReady: false })).toBe(true);
    expect(waitsForGameWindow({ phase: 'running', windowReady: true })).toBe(false);
    expect(waitsForGameWindow({ phase: 'preparing', windowReady: false })).toBe(false);
  });
});
