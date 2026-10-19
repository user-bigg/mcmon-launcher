import type { LaunchState } from '@shared/launch';

export const DIALOG_POLL_MS = 1000;
export const DIALOG_POLLS = 2;
export const AFTER_GAME_POLLS = 3;

export interface OwnerWindow {
  isDestroyed: () => boolean;
  isEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
}

export interface GameDialogDeps {
  window: () => OwnerWindow | null;
  ownPrompt: () => boolean;
  found: () => void;
  setInterval?: (run: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export function waitsForGameWindow(state: Pick<LaunchState, 'phase' | 'windowReady'>): boolean {
  return state.phase === 'running' && !state.windowReady;
}

function blocked(window: OwnerWindow | null): window is OwnerWindow {
  return window !== null && !window.isDestroyed() && !window.isEnabled();
}

// Electron keeps its own "enabled" flag and skips EnableWindow when the flag already says
// true, so the window is switched off and on through it to reach the system.
function release(window: OwnerWindow): void {
  window.setEnabled(false);
  window.setEnabled(true);
}

// Minecraft shows a GLFW error with tinyfd_messageBox, which passes GetForegroundWindow() as
// the owner: a MessageBox disables its owner, and that owner is the launcher the player was
// looking at. Electron reads IsWindowEnabled for isEnabled() on Windows, so a launcher that
// stays disabled while the game has no window of its own is the sign of that dialog.
export class GameDialogWatch {
  private waiting = false;
  private disabledPolls = 0;
  private afterGame = 0;
  private timer: unknown = null;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: GameDialogDeps) {
    this.setTimer =
      deps.setInterval ??
      ((run, ms): unknown => {
        const handle = setInterval(run, ms);
        handle.unref();
        return handle;
      });
    this.clearTimer =
      deps.clearInterval ??
      ((handle): void => {
        clearInterval(handle as NodeJS.Timeout);
      });
  }

  update(waiting: boolean): void {
    if (this.waiting && !waiting) {
      this.afterGame = AFTER_GAME_POLLS;
    }
    if (!waiting) {
      this.disabledPolls = 0;
    }
    this.waiting = waiting;
    if (this.active() && this.timer === null) {
      this.timer = this.setTimer(() => {
        this.poll();
      }, DIALOG_POLL_MS);
    }
  }

  dispose(): void {
    this.waiting = false;
    this.afterGame = 0;
    this.stopTimer();
  }

  private active(): boolean {
    return this.waiting || this.afterGame > 0;
  }

  private poll(): void {
    if (this.waiting) {
      this.pollWaiting();
    } else {
      this.pollAfterGame();
    }
    if (!this.active()) {
      this.stopTimer();
    }
  }

  private pollWaiting(): void {
    const window = this.deps.window();
    if (!blocked(window) || this.deps.ownPrompt()) {
      this.disabledPolls = 0;
      return;
    }
    this.disabledPolls += 1;
    if (this.disabledPolls >= DIALOG_POLLS) {
      this.disabledPolls = 0;
      release(window);
      this.deps.found();
    }
  }

  // A game killed with its dialog open may leave the owner disabled: the dialog's own call
  // that enables it again never runs.
  private pollAfterGame(): void {
    this.afterGame -= 1;
    const window = this.deps.window();
    if (blocked(window) && !this.deps.ownPrompt()) {
      release(window);
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
