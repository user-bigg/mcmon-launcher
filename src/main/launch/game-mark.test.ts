import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearGameMark,
  GAME_MARK_FILE,
  isGameRunningIn,
  markGameStarted,
  type GameMarkProbe,
} from './game-mark';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function probe(alive: readonly number[], uptimeMs = 10 * HOUR): GameMarkProbe {
  return { now: () => NOW, uptimeMs: () => uptimeMs, isAlive: (pid) => alive.includes(pid) };
}

describe('mark of a game running from an instance folder', () => {
  let instance: string;

  beforeEach(async () => {
    instance = await mkdtemp(join(tmpdir(), 'mcmonitor-mark-'));
  });

  afterEach(async () => {
    await rm(instance, { recursive: true, force: true });
  });

  it('no mark — no game', async () => {
    expect(await isGameRunningIn(instance, probe([4321]))).toBe(false);
  });

  it('a live process started after the boot is a running game', async () => {
    await markGameStarted(instance, 4321, NOW - HOUR);
    expect(await isGameRunningIn(instance, probe([4321]))).toBe(true);
  });

  it('a finished process is not', async () => {
    await markGameStarted(instance, 4321, NOW - HOUR);
    expect(await isGameRunningIn(instance, probe([]))).toBe(false);
  });

  it('a mark from before the boot is stale even when its process id is taken again', async () => {
    await markGameStarted(instance, 4321, NOW - 2 * HOUR);
    expect(await isGameRunningIn(instance, probe([4321], HOUR))).toBe(false);
  });

  it('a damaged mark is no game', async () => {
    await writeFile(join(instance, GAME_MARK_FILE), '{"pid":"x"');
    expect(await isGameRunningIn(instance, probe([4321]))).toBe(false);
    await writeFile(join(instance, GAME_MARK_FILE), '{"pid":0,"startedAt":1}');
    expect(await isGameRunningIn(instance, probe([0]))).toBe(false);
  });

  it('the mark is removed when the game exits', async () => {
    await markGameStarted(instance, 4321, NOW);
    await clearGameMark(instance);
    expect(await readdir(instance)).toEqual([]);
    await clearGameMark(instance);
  });
});
