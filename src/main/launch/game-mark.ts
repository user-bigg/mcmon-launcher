import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './json-cache';

export const GAME_MARK_FILE = 'mcmonitor-game.json';

export interface GameMarkProbe {
  now: () => number;
  uptimeMs: () => number;
  isAlive: (pid: number) => boolean;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export const systemGameMarkProbe: GameMarkProbe = {
  now: Date.now,
  uptimeMs: () => os.uptime() * 1000,
  isAlive: processExists,
};

function markFile(instance: string): string {
  return path.join(instance, GAME_MARK_FILE);
}

export function markGameStarted(instance: string, pid: number, startedAt: number): Promise<void> {
  return writeJsonAtomic(markFile(instance), { pid, startedAt });
}

export async function clearGameMark(instance: string): Promise<void> {
  await rm(markFile(instance), { force: true });
}

// A game outlives the launcher that started it when the launcher crashes or is closed. A mark
// from before the last boot is stale even if its process id has since been given to another
// program.
export async function isGameRunningIn(
  instance: string,
  probe: GameMarkProbe = systemGameMarkProbe,
): Promise<boolean> {
  const mark = await readJson(markFile(instance));
  if (typeof mark !== 'object' || mark === null) {
    return false;
  }
  const { pid, startedAt } = mark as { pid?: unknown; startedAt?: unknown };
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (typeof startedAt !== 'number' || startedAt < probe.now() - probe.uptimeMs()) {
    return false;
  }
  return probe.isAlive(pid);
}
