import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Version, type Platform, type ResolvedVersion } from '@xmcl/core';
import type { InstallManifest, InstallRuntime } from '@xmcl/installer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrackedRuntime } from './download';
import { gameJvmArgs } from './game-process';
import { gameLayout } from './layout';
import { macGlfwJvmArgs, needsMacGlfw, prepareMacGlfw } from './mac-glfw';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'arch');
const MAC: Platform = { name: 'osx', version: '15.5', arch: 'arm64' };

function macVersion(id: string): ResolvedVersion {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `libraries-mac-${id}.json`), 'utf8')) as {
    libraries: Parameters<typeof Version.resolveLibraries>[0];
  };
  return { id, libraries: Version.resolveLibraries(fixture.libraries, MAC) } as ResolvedVersion;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-glfw-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function transfer(
  write: (path: string) => Promise<void>,
  plans: InstallManifest[],
): TrackedRuntime {
  return {
    runtime: {} as InstallRuntime,
    downloadedBytes: () => 0,
    execute: async (plan): Promise<void> => {
      plans.push(plan);
      const task = plan.tasks[0];
      if (task?.type === 'files') {
        await Promise.all(task.files.map((file) => write(file.path)));
      }
    },
    onInstallEvent: () => undefined,
  };
}

describe('needsMacGlfw', () => {
  it('only LWJGL 3.2.1 on macOS gets GLFW 3.3.10', () => {
    expect(needsMacGlfw(macVersion('1.16.5'), 'darwin')).toBe(true);
    expect(needsMacGlfw(macVersion('1.16.5'), 'win32')).toBe(false);
    expect(needsMacGlfw(macVersion('1.19'), 'darwin')).toBe(false);
    expect(needsMacGlfw(macVersion('1.8.9'), 'darwin')).toBe(false);
  });
});

describe('the JVM argument', () => {
  it('points LWJGL at the library, and nothing is added without one', () => {
    expect(macGlfwJvmArgs('/g/libglfw.3.dylib')).toEqual([
      '-Dorg.lwjgl.glfw.libname=/g/libglfw.3.dylib',
    ]);
    expect(gameJvmArgs(null, false, '/g/libglfw.3.dylib')).toContain(
      '-Dorg.lwjgl.glfw.libname=/g/libglfw.3.dylib',
    );
    expect(gameJvmArgs().some((arg) => arg.includes('glfw'))).toBe(false);
  });
});

describe('prepareMacGlfw', () => {
  it('downloads the release archive of GLFW pinned by sha1 and size', async () => {
    const plans: InstallManifest[] = [];
    const broken = transfer((path) => writeFile(path, 'not a zip'), plans);
    await mkdir(join(root, 'runtime', 'glfw', '3.3.10'), { recursive: true });
    await expect(prepareMacGlfw(gameLayout(root), broken)).rejects.toThrow();
    expect(plans[0]?.tasks[0]).toMatchObject({
      type: 'files',
      files: [
        {
          path: join(root, 'runtime', 'glfw', '3.3.10', 'glfw-3.3.10.bin.MACOS.zip'),
          urls: ['https://github.com/glfw/glfw/releases/download/3.3.10/glfw-3.3.10.bin.MACOS.zip'],
          size: 1261810,
          checksum: { algorithm: 'sha1', value: 'a5cb5f736fa6d768f92b53557905e6a43302252a' },
        },
      ],
    });
  });

  it('a library on disk that matches its hash is used without a download', async () => {
    const dir = join(root, 'runtime', 'glfw', '3.3.10');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'libglfw.3.dylib'), 'glfw');
    const plans: InstallManifest[] = [];
    const library = await prepareMacGlfw(
      gameLayout(root),
      transfer(() => Promise.resolve(), plans),
      createHash('sha256').update('glfw').digest('hex'),
    );
    expect(library).toBe(join(dir, 'libglfw.3.dylib'));
    expect(plans).toEqual([]);
  });

  it('an archive without the right library is a checksum error, not an unknown one', async () => {
    const broken = transfer((path) => writeFile(path, 'not a zip'), []);
    await mkdir(join(root, 'runtime', 'glfw', '3.3.10'), { recursive: true });
    await expect(prepareMacGlfw(gameLayout(root), broken)).rejects.toMatchObject({
      error: { code: 'checksum-mismatch', file: 'libglfw.3.dylib' },
    });
  });

  it('a library on disk that does not match its hash is not used', async () => {
    const dir = join(root, 'runtime', 'glfw', '3.3.10');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'libglfw.3.dylib'), 'tampered');
    const plans: InstallManifest[] = [];
    const broken = transfer((path) => writeFile(path, 'not a zip'), plans);
    await expect(prepareMacGlfw(gameLayout(root), broken)).rejects.toThrow();
    expect(plans).toHaveLength(1);
  });
});
