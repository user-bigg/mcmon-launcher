import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { javaMajorFromReport, nickFromLog, parseLaunchNote, scanLogOrder } from './crash-sources';

describe('order of joining and resource loading in a big log', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function logFile(text: string): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-order-'));
    const file = join(dir, 'game.log');
    await writeFile(file, text);
    return file;
  }

  const mods = (bytes: number): string =>
    '[12:00:00] [main/INFO]: Loading mod example_mod_with_a_long_name 1.0.0\n'.repeat(
      Math.ceil(bytes / 70),
    );

  it('finds both lines far past the first 64 KB and across a chunk boundary', async () => {
    const before = mods(200 * 1024);
    const connect = '[12:01:00] [Render thread/INFO]: Connecting to play.example.net, 25565\n';
    const load = '[12:01:01] [Render thread/INFO]: Reloading ResourceManager: Default\n';
    const file = await logFile(before + connect + load);
    expect(await scanLogOrder(file)).toEqual({
      connectAt: before.length + connect.indexOf('Connecting'),
      loadAt: before.length + connect.length + load.indexOf('Reloading'),
    });
    const cut = 64 * 1024 - 20;
    const padded = 'x'.repeat(cut) + connect;
    expect((await scanLogOrder(await logFile(padded))).connectAt).toBe(cut + connect.indexOf('C'));
  });

  it('stops at the limit and without the file', async () => {
    const file = await logFile(mods(300 * 1024) + 'Reloading ResourceManager: Default\n');
    expect(await scanLogOrder(file, 128 * 1024)).toEqual({ connectAt: null, loadAt: null });
    expect(await scanLogOrder(join(tmpdir(), 'no-such-mcmonitor-log'))).toEqual({
      connectAt: null,
      loadAt: null,
    });
  });
});

describe('launch data from the log', () => {
  it('launcher note in old and new format', () => {
    expect(
      parseLaunchNote(
        '[MC Monitor] minecraft=26.3 java=/g/runtime/java-runtime-epsilon/bin/java memory=4096MB join=none',
      ),
    ).toEqual({
      minecraft: '26.3',
      javaPath: '/g/runtime/java-runtime-epsilon/bin/java',
      memoryMb: 4096,
    });
    expect(
      parseLaunchNote(
        '[MC Monitor] minecraft=1.21.1 version=fabric-loader-0.16.10-1.21.1 loader=fabric java=C:\\MC Monitor\\runtime\\java-runtime-delta\\bin\\javaw.exe memory=6144MB join=none',
      ),
    ).toEqual({
      minecraft: '1.21.1',
      javaPath: 'C:\\MC Monitor\\runtime\\java-runtime-delta\\bin\\javaw.exe',
      memoryMb: 6144,
    });
    expect(parseLaunchNote('[Render thread/INFO]: hello')).toBeNull();
  });

  it('nickname from "Setting user" and Java from reports', () => {
    expect(nickFromLog('<![CDATA[Setting user: Frostbyte]]>')).toBe('Frostbyte');
    expect(javaMajorFromReport('\tJava Version: 21.0.7, Microsoft')).toBe(21);
    expect(
      javaMajorFromReport('# JRE version: OpenJDK Runtime Environment (17.0.8+7) (build )'),
    ).toBe(17);
    expect(javaMajorFromReport('\tJava Version: 1.8.0_51, Oracle Corporation')).toBe(8);
  });
});
