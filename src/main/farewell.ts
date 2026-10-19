import type { AppAliveState } from '@shared/telemetry';

export const FAREWELL_MS = 1500;

export interface PresenceWindow {
  isVisible: () => boolean;
  isMinimized: () => boolean;
}

export function aliveStateOf(playing: boolean, window: PresenceWindow | null): AppAliveState {
  if (playing) {
    return 'playing';
  }
  return window !== null && window.isVisible() && !window.isMinimized()
    ? 'foreground'
    : 'background';
}

export interface FarewellDeps {
  send: () => Promise<void>;
  withdraw: () => void;
  leave: () => void;
  wait: (ms: number) => Promise<void>;
  hideWindows: () => void;
  quit: () => void;
}

type FarewellState = 'idle' | 'running' | 'done';

export class Farewell {
  private state: FarewellState = 'idle';
  private attempt = 0;

  constructor(private readonly deps: FarewellDeps) {}

  holdQuit(): boolean {
    if (this.state === 'done') {
      return false;
    }
    if (this.state === 'idle') {
      this.begin();
    }
    return true;
  }

  // An update install and the end of a Windows session must not wait: the farewell event is
  // only queued and leaves on the next start.
  skip(): void {
    if (this.state === 'idle') {
      this.deps.leave();
    }
    this.state = 'done';
    this.attempt += 1;
  }

  stay(): boolean {
    if (this.state !== 'running') {
      return false;
    }
    this.state = 'idle';
    this.attempt += 1;
    this.deps.withdraw();
    return true;
  }

  private begin(): void {
    this.state = 'running';
    this.attempt += 1;
    const attempt = this.attempt;
    this.deps.hideWindows();
    const finish = (): void => {
      if (this.attempt === attempt) {
        this.state = 'done';
        this.deps.quit();
      }
    };
    void Promise.race([this.deps.send(), this.deps.wait(FAREWELL_MS)]).then(finish, finish);
  }
}
