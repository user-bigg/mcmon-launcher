import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WINDOW_QUIET_MS,
  WINDOW_WAIT_LIMIT_MS,
  WINDOW_WAIT_MS,
  WindowWait,
  windowWaitDeadline,
} from './window-wait';

describe('windowWaitDeadline', () => {
  it('a silent game is asked about after the base wait', () => {
    expect(windowWaitDeadline(1000, 1000)).toBe(1000 + WINDOW_WAIT_MS);
  });

  it('fresh log lines move the deadline past the base wait', () => {
    const lastLine = 1000 + WINDOW_WAIT_MS - 5000;
    expect(windowWaitDeadline(1000, lastLine)).toBe(lastLine + WINDOW_QUIET_MS);
  });

  it('a log that never stops does not move the deadline past the limit', () => {
    const lastLine = 1000 + WINDOW_WAIT_LIMIT_MS - 1;
    expect(windowWaitDeadline(1000, lastLine)).toBe(1000 + WINDOW_WAIT_LIMIT_MS);
  });
});

describe('WindowWait', () => {
  let slow: number;
  let wait: WindowWait;

  beforeEach(() => {
    vi.useFakeTimers();
    slow = 0;
    wait = new WindowWait(Date.now, () => {
      slow += 1;
    });
  });

  afterEach(() => {
    wait.stop();
    vi.useRealTimers();
  });

  it('reports a slow start once the base wait passes in silence', () => {
    wait.start();
    vi.advanceTimersByTime(WINDOW_WAIT_MS - 1);
    expect(slow).toBe(0);
    vi.advanceTimersByTime(1);
    expect(slow).toBe(1);
    vi.advanceTimersByTime(WINDOW_WAIT_LIMIT_MS);
    expect(slow).toBe(1);
  });

  it('keeps waiting while the log moves and reports after it goes quiet', () => {
    wait.start();
    for (let passed = 0; passed < WINDOW_WAIT_MS + 60_000; passed += 10_000) {
      vi.advanceTimersByTime(10_000);
      wait.output();
    }
    expect(slow).toBe(0);
    vi.advanceTimersByTime(WINDOW_QUIET_MS - 1);
    expect(slow).toBe(0);
    vi.advanceTimersByTime(1);
    expect(slow).toBe(1);
  });

  it('a log that never goes quiet is still reported at the limit', () => {
    wait.start();
    for (let passed = 0; passed < WINDOW_WAIT_LIMIT_MS; passed += 10_000) {
      expect(slow).toBe(0);
      vi.advanceTimersByTime(10_000);
      wait.output();
    }
    expect(slow).toBe(1);
  });

  it('starting again gives a full new wait', () => {
    wait.start();
    vi.advanceTimersByTime(WINDOW_WAIT_MS);
    expect(slow).toBe(1);
    wait.start();
    vi.advanceTimersByTime(WINDOW_WAIT_MS - 1);
    expect(slow).toBe(1);
    vi.advanceTimersByTime(1);
    expect(slow).toBe(2);
  });

  it('a stopped wait reports nothing', () => {
    wait.start();
    wait.stop();
    vi.advanceTimersByTime(WINDOW_WAIT_LIMIT_MS);
    expect(slow).toBe(0);
  });
});
