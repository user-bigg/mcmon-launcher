import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MinecraftFolder, type ResolvedVersion } from '@xmcl/core';
import type { InstallRuntime } from '@xmcl/installer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedRuntime } from './download';
import { failure } from './errors';
import { writeVersionLock } from './game-files';
import { gameLayout, versionLockFile, type GameLayout } from './layout';
import { prepareLoader, verifyWithLoaderRepair, type LoaderStepOptions } from './loader-step';
import { pinsFile, writePins } from './loaders/pins';

const ID = 'fabric-loader-0.19.5-26.3';
const PINNED = 'libraries/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar';

let root: string;
let layout: GameLayout;
let folder: MinecraftFolder;

function transfer(): TrackedRuntime {
  return {
    runtime: {} as InstallRuntime,
    downloadedBytes: () => 0,
    execute: () => Promise.resolve(),
    onInstallEvent: () => undefined,
  };
}

async function writeInstalled(): Promise<void> {
  await mkdir(join(root, 'versions', '26.3'), { recursive: true });
  await writeFile(
    join(root, 'versions', '26.3', '26.3.json'),
    JSON.stringify({
      id: '26.3',
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      libraries: [],
      arguments: { game: [], jvm: [] },
    }),
  );
  await mkdir(join(root, 'versions', ID), { recursive: true });
  await writeFile(
    join(root, 'versions', ID, `${ID}.json`),
    JSON.stringify({
      id: ID,
      inheritsFrom: '26.3',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      libraries: [],
    }),
  );
}

async function pinLoader(content: string): Promise<void> {
  await mkdir(join(root, ...PINNED.split('/').slice(0, -1)), { recursive: true });
  await writeFile(join(root, ...PINNED.split('/')), content);
  await writePins(pinsFile(layout, ID), {
    schemaVersion: 1,
    version: ID,
    files: { [PINNED]: { sha1: createHash('sha1').update('loader').digest('hex') } },
  });
}

function options(overrides: Partial<LoaderStepOptions> = {}): LoaderStepOptions {
  return {
    layout,
    folder,
    runtime: { minecraft: '26.3', loader: 'fabric', loaderVersion: '0.19.5' },
    fetch: () => Promise.reject(new Error('offline')),
    signal: new AbortController().signal,
    install: vi.fn(() => Promise.resolve(ID)),
    verify: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-loader-step-'));
  layout = gameLayout(root);
  folder = MinecraftFolder.from(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the loader step', () => {
  it('without a lock file it installs; with one, the version is already installed', async () => {
    await writeInstalled();
    const fresh = options();
    const first = await prepareLoader(fresh, transfer());
    expect(first.fresh).toBe(true);
    expect(fresh.install).toHaveBeenCalledTimes(1);
    await writeVersionLock(versionLockFile(layout, ID), ID, Date.now());
    const again = options();
    const second = await prepareLoader(again, transfer());
    expect(second).toMatchObject({ fresh: false, version: { id: ID } });
    expect(again.install).not.toHaveBeenCalled();
  });

  it('when a pinned loader file changes, the loader is reinstalled exactly once', async () => {
    await writeInstalled();
    await pinLoader('loader');
    const base = { version: { id: '26.3' } as ResolvedVersion, validatedAt: undefined };
    const prepared = {
      version: { id: ID } as ResolvedVersion,
      lockFile: versionLockFile(layout, ID),
      validatedAt: undefined,
      fresh: false,
    };
    const ok = options();
    await verifyWithLoaderRepair(ok, prepared, base, transfer());
    expect(ok.install).not.toHaveBeenCalled();
    await pinLoader('tampered');
    const repaired = options();
    await verifyWithLoaderRepair(repaired, prepared, base, transfer());
    expect(repaired.install).toHaveBeenCalledTimes(1);
  });

  it('without a pinned-hashes file (an old install), it reinstalls', async () => {
    await writeInstalled();
    const step = options();
    await verifyWithLoaderRepair(
      step,
      { version: { id: ID } as ResolvedVersion, lockFile: '', validatedAt: 1, fresh: false },
      { version: { id: '26.3' } as ResolvedVersion, validatedAt: undefined },
      transfer(),
    );
    expect(step.install).toHaveBeenCalledTimes(1);
  });

  it('a loader that fails to install is not retried in a loop', async () => {
    await writeInstalled();
    const step = options({
      verify: vi.fn(() =>
        Promise.reject(
          failure({
            code: 'loader-install-failed',
            loader: 'fabric',
            stage: 'library',
            detail: null,
          }),
        ),
      ),
    });
    await expect(
      verifyWithLoaderRepair(
        step,
        { version: { id: ID } as ResolvedVersion, lockFile: '', validatedAt: 1, fresh: false },
        { version: { id: '26.3' } as ResolvedVersion, validatedAt: undefined },
        transfer(),
      ),
    ).rejects.toMatchObject({ error: { code: 'loader-install-failed' } });
    expect(step.install).not.toHaveBeenCalled();
  });

  it('right after installation, only the game files are verified', async () => {
    const step = options();
    const base = { version: { id: '26.3' } as ResolvedVersion, validatedAt: 5 };
    await verifyWithLoaderRepair(
      step,
      { version: { id: ID } as ResolvedVersion, lockFile: '', validatedAt: undefined, fresh: true },
      base,
      transfer(),
    );
    expect(step.verify).toHaveBeenCalledTimes(1);
    expect(step.verify).toHaveBeenCalledWith(
      base.version,
      folder,
      expect.anything(),
      5,
      expect.anything(),
    );
  });
});
