import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrashFix } from '@shared/crash';
import { applyCrashFix, type FixContext } from './crash-fixes';
import { readInstanceOverrides, writeInstanceOverrides } from './instance-overrides';

const GIB = 1024 ** 3;

let root: string;
let instance: string;
let context: FixContext;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-fix-'));
  instance = join(root, 'instances', 'server-12');
  await mkdir(join(instance, 'mods'), { recursive: true });
  context = {
    root,
    instance,
    totalMemoryBytes: 16 * GIB,
    crashReportPath: null,
    saveMemory: (memoryMb): Promise<void> => writeInstanceOverrides(instance, { memoryMb }),
    saveJava: (javaMajor): Promise<void> =>
      writeInstanceOverrides(
        instance,
        javaMajor === null ? { javaMajor: null } : { javaMajor, javaFor: '1.21.11' },
      ),
    openPath: vi.fn(() => Promise.resolve('')),
    writeReport: vi.fn(),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('fix executor', () => {
  it('set-memory writes the instance memory; out of range is rejected', async () => {
    expect((await applyCrashFix({ type: 'set-memory', mb: 6144 }, context)).ok).toBe(true);
    expect(await readInstanceOverrides(instance)).toEqual({ memoryMb: 6144 });
    const tooMuch = await applyCrashFix({ type: 'set-memory', mb: 64 * 1024 }, context);
    expect(tooMuch).toEqual({ ok: false, error: { code: 'invalid-request', field: 'mb' } });
    const tooLittle = await applyCrashFix({ type: 'set-memory', mb: 512 }, context);
    expect(tooLittle.ok).toBe(false);
  });

  it('install-java remembers the Java version for the game version, installs it on next launch', async () => {
    const result = await applyCrashFix({ type: 'install-java', major: 21 }, context);
    expect(result.ok).toBe(true);
    expect(await readInstanceOverrides(instance)).toEqual({ javaMajor: 21, javaFor: '1.21.11' });
    await applyCrashFix({ type: 'install-java', major: 22 }, context);
    expect((await readInstanceOverrides(instance)).javaMajor).toBe(25);
  });

  it('reset-java removes the override', async () => {
    await applyCrashFix({ type: 'install-java', major: 17 }, context);
    expect((await applyCrashFix({ type: 'reset-java' }, context)).ok).toBe(true);
    expect(await readInstanceOverrides(instance)).toEqual({});
  });

  it('disable-mod renames to .disabled; a repeat gets a number suffix', async () => {
    await writeFile(join(instance, 'mods', 'jei-15.3.jar'), 'jar');
    expect((await applyCrashFix({ type: 'disable-mod', file: 'jei-15.3.jar' }, context)).ok).toBe(
      true,
    );
    await writeFile(join(instance, 'mods', 'jei-15.3.jar'), 'jar');
    await applyCrashFix({ type: 'disable-mod', file: 'jei-15.3.jar' }, context);
    expect((await readdir(join(instance, 'mods'))).sort()).toEqual([
      'jei-15.3.jar.1.disabled',
      'jei-15.3.jar.disabled',
    ]);
  });

  it('disable-mod stays inside mods and does not touch a missing file', async () => {
    const escapes: CrashFix[] = [
      { type: 'disable-mod', file: '../options.txt' },
      { type: 'disable-mod', file: '..\\..\\x.jar' },
      { type: 'disable-mod', file: '/etc/passwd.jar' },
      { type: 'disable-mod', file: 'sub/dir.jar' },
    ];
    for (const fix of escapes) {
      expect(await applyCrashFix(fix, context)).toEqual({
        ok: false,
        error: { code: 'outside-game-dir' },
      });
    }
    expect(await applyCrashFix({ type: 'disable-mod', file: 'none.jar' }, context)).toEqual({
      ok: false,
      error: { code: 'file-missing', file: 'none.jar' },
    });
  });

  it('remove-file deletes only game files inside the data folder', async () => {
    const library = join(root, 'libraries', 'org', 'lwjgl', 'lwjgl-3.3.3.jar');
    await mkdir(join(root, 'libraries', 'org', 'lwjgl'), { recursive: true });
    await writeFile(library, 'broken');
    const fix: CrashFix = { type: 'remove-file', path: 'libraries/org/lwjgl/lwjgl-3.3.3.jar' };
    expect((await applyCrashFix(fix, context)).ok).toBe(true);
    expect(await readdir(join(root, 'libraries', 'org', 'lwjgl'))).toEqual([]);
    for (const path of [
      '../secret.jar',
      'libraries/../../x.jar',
      'instances/server-12/options.txt',
    ]) {
      expect(await applyCrashFix({ type: 'remove-file', path }, context)).toEqual({
        ok: false,
        error: { code: 'outside-game-dir' },
      });
    }
  });

  it('open-log and open-folder open only within the instance', async () => {
    await mkdir(join(instance, 'logs'), { recursive: true });
    await writeFile(join(instance, 'logs', 'latest.log'), 'log');
    expect((await applyCrashFix({ type: 'open-log' }, context)).ok).toBe(true);
    expect(context.openPath).toHaveBeenLastCalledWith(join(instance, 'logs', 'latest.log'));
    await applyCrashFix({ type: 'open-folder', folder: 'crash-reports' }, context);
    expect(context.openPath).toHaveBeenLastCalledWith(instance);
    await writeFile(join(root, 'elsewhere.txt'), 'x');
    const outside = await applyCrashFix(
      { type: 'open-log' },
      { ...context, crashReportPath: join(root, 'elsewhere.txt') },
    );
    expect(outside.ok).toBe(true);
    expect(context.openPath).toHaveBeenLastCalledWith(join(instance, 'logs', 'latest.log'));
  });

  it('open-log opens only .txt and .log, not a folder or an unrelated file', async () => {
    await mkdir(join(instance, 'crash-reports', 'dir.txt'), { recursive: true });
    await writeFile(join(instance, 'crash-reports', 'evil.exe'), 'x');
    const folder = await applyCrashFix(
      { type: 'open-log' },
      { ...context, crashReportPath: join(instance, 'crash-reports', 'dir.txt') },
    );
    expect(folder).toEqual({ ok: false, error: { code: 'file-missing', file: 'log' } });
    const binary = await applyCrashFix(
      { type: 'open-log' },
      { ...context, crashReportPath: join(instance, 'crash-reports', 'evil.exe') },
    );
    expect(binary.ok).toBe(false);
  });

  it('an advice fix with no action is not executed', async () => {
    expect(await applyCrashFix({ type: 'advice', advice: 'update-driver' }, context)).toEqual({
      ok: false,
      error: { code: 'fix-not-available' },
    });
  });
});

describe('fixes with filenames taken from the log', () => {
  it('disable-mod: UNC paths, drive letters, control characters and decoy names stay inside mods', async () => {
    for (const file of [
      '\\\\?\\C:\\Windows\\System32\\x.jar',
      '\\\\evil\\share\\x.jar',
      'C:\\x.jar',
      'C:x.jar',
      'x.jar:stream.jar',
      '..',
      '../mods2/x.jar',
      'mods/../../x.jar',
      'x.jar\u0000.txt',
      '<script>.jar',
      'x.exe',
      `${'a'.repeat(300)}.jar`,
    ]) {
      const result = await applyCrashFix({ type: 'disable-mod', file }, context);
      expect({ file, ok: result.ok }).toEqual({ file, ok: false });
    }
    expect(await readdir(join(instance, 'mods'))).toEqual([]);
  });

  it('disable-mod and remove-file do not follow a symlink outside', async () => {
    const outside = join(root, '..', `${String(Date.now())}-outside.jar`);
    await writeFile(outside, 'keep');
    await symlink(outside, join(instance, 'mods', 'link.jar'));
    await mkdir(join(root, 'libraries'), { recursive: true });
    await symlink(outside, join(root, 'libraries', 'link.jar'));
    expect((await applyCrashFix({ type: 'disable-mod', file: 'link.jar' }, context)).ok).toBe(
      false,
    );
    expect(
      (await applyCrashFix({ type: 'remove-file', path: 'libraries/link.jar' }, context)).ok,
    ).toBe(false);
    expect(await readFile(outside, 'utf8')).toBe('keep');
    await rm(outside, { force: true });
  });

  it('remove-file: absolute paths, UNC paths and mixed slashes are rejected', async () => {
    for (const path of [
      '/etc/passwd',
      'C:/Windows/win.ini',
      '\\\\?\\C:\\Windows\\win.ini',
      '\\\\evil\\share\\x.jar',
      'libraries\\..\\..\\x.jar',
      'libraries/a/../../../x.jar',
      'versions/%2e%2e/x.jar',
      'libraries/a\u0000b.jar',
      'mods/x.jar',
      'options.txt',
    ]) {
      const result = await applyCrashFix({ type: 'remove-file', path }, context);
      expect({ path, ok: result.ok }).toEqual({ path, ok: false });
    }
  });
});
