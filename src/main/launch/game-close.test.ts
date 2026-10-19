import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_ESCALATION_MS, closeGracefully, type SpawnGame } from './game-process';

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  readonly signals: string[] = [];

  kill(signal: string): boolean {
    this.signals.push(signal);
    return true;
  }

  exit(code: number): void {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

function asChild(child: FakeChild): ChildProcess {
  return child as unknown as ChildProcess;
}

function taskkill(code: number): { spawn: SpawnGame; calls: string[][] } {
  const calls: string[][] = [];
  const spawn: SpawnGame = (command, args = []) => {
    calls.push([command, ...args]);
    const process = new EventEmitter();
    queueMicrotask(() => process.emit('exit', code));
    return process as unknown as ChildProcess;
  };
  return { spawn, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('closeGracefully', () => {
  it('Windows: taskkill without /F, game closes on its own — no force kill', async () => {
    const child = new FakeChild();
    const { spawn, calls } = taskkill(0);
    closeGracefully(asChild(child), { platform: 'win32', spawnImpl: spawn });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([['taskkill', '/PID', '4242']]);
    child.exit(0);
    await vi.advanceTimersByTimeAsync(CLOSE_ESCALATION_MS);
    expect(child.signals).toEqual([]);
  });

  it("Windows: game doesn't close within 15s — kill it", async () => {
    const child = new FakeChild();
    const { spawn } = taskkill(0);
    closeGracefully(asChild(child), { platform: 'win32', spawnImpl: spawn });
    await vi.advanceTimersByTimeAsync(CLOSE_ESCALATION_MS - 1);
    expect(child.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.signals).toEqual(['SIGKILL']);
  });

  it('Windows: taskkill fails (no window) — kill immediately', async () => {
    const child = new FakeChild();
    const { spawn } = taskkill(128);
    closeGracefully(asChild(child), { platform: 'win32', spawnImpl: spawn });
    await vi.advanceTimersByTimeAsync(0);
    expect(child.signals).toEqual(['SIGKILL']);
  });

  it('macOS and Linux: SIGTERM, then SIGKILL on timer', async () => {
    const child = new FakeChild();
    closeGracefully(asChild(child), { platform: 'darwin' });
    expect(child.signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(CLOSE_ESCALATION_MS);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('an already exited process is left alone', () => {
    const child = new FakeChild();
    child.exitCode = 0;
    closeGracefully(asChild(child), { platform: 'linux' });
    expect(child.signals).toEqual([]);
  });
});
