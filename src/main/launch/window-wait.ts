export const WINDOW_WAIT_MS = 3 * 60_000;
export const WINDOW_QUIET_MS = 30_000;
export const WINDOW_WAIT_LIMIT_MS = 10 * 60_000;
export const WINDOW_FAILURE_GRACE_MS = 3000;

// A heavy modded build keeps writing its log for minutes before the window shows up, so the
// wait goes on while the log moves; a log that never stops still gets the question at the limit.
export function windowWaitDeadline(since: number, lastOutputAt: number): number {
  return Math.min(
    since + WINDOW_WAIT_LIMIT_MS,
    Math.max(since + WINDOW_WAIT_MS, lastOutputAt + WINDOW_QUIET_MS),
  );
}

export class WindowWait {
  private timer: NodeJS.Timeout | null = null;
  private since = 0;
  private lastOutputAt = 0;

  constructor(
    private readonly now: () => number,
    private readonly onSlow: () => void,
  ) {}

  start(): void {
    this.stop();
    this.since = this.now();
    this.lastOutputAt = this.since;
    this.schedule();
  }

  output(): void {
    this.lastOutputAt = this.now();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    const delay = windowWaitDeadline(this.since, this.lastOutputAt) - this.now();
    if (delay <= 0) {
      this.timer = null;
      this.onSlow();
      return;
    }
    this.timer = setTimeout(() => {
      this.schedule();
    }, delay);
    this.timer.unref();
  }
}
