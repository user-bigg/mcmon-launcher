import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MinecraftFolder } from '@xmcl/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrackedRuntime } from './download';
import { LaunchFailure } from './errors';
import {
  assertHashes,
  countVerifiedFiles,
  fileWithoutHash,
  installGameFiles,
  isPrecheckFailure,
  readVersionLock,
  removeVersionLock,
  repairFiles,
  writeVersionLock,
} from './game-files';
import { writeVersionFixture } from './version-fixture';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-files-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('version lock file', () => {
  it('is written, read for its own version, and removed', async () => {
    const file = join(root, 'versions', '26.3', 'mcmonitor-lock.json');
    const at = Date.parse('2026-10-03T09:00:00Z');
    expect(await readVersionLock(file, '26.3')).toBeUndefined();
    expect(await writeVersionLock(file, '26.3', at)).toBe(true);
    expect(await readVersionLock(file, '26.3')).toBe(at);
    expect(await readVersionLock(file, '26.2')).toBeUndefined();
    await removeVersionLock(file);
    expect(await readVersionLock(file, '26.3')).toBeUndefined();
    await removeVersionLock(file);
  });

  it("corrupt or foreign format is treated as if there'd been no check", async () => {
    const file = join(root, 'lock.json');
    await writeFile(file, '{"schemaVersion":2,"version":"26.3","validatedAt":"2026-10-03"}');
    expect(await readVersionLock(file, '26.3')).toBeUndefined();
    await writeFile(file, '{"schemaVersion":1,"version":"26.3","validatedAt":"вчера"}');
    expect(await readVersionLock(file, '26.3')).toBeUndefined();
    await writeFile(file, 'not json');
    expect(await readVersionLock(file, '26.3')).toBeUndefined();
  });

  it('write is best-effort: an inaccessible folder does not fail the install', async () => {
    const blocker = join(root, 'file');
    await writeFile(blocker, '');
    expect(await writeVersionLock(join(blocker, 'lock.json'), '26.3', Date.now())).toBe(false);
  });
});

describe('repairFiles', () => {
  it('re-downloads the client and libraries without trusting size or old timestamp', async () => {
    const version = await writeVersionFixture(root);
    const folder = MinecraftFolder.from(root);
    const files = repairFiles(version, folder, { jar: '26.3', libraries: version.libraries });
    expect(files.map((file) => file.path)).toEqual([
      folder.getVersionJar('26.3'),
      folder.getLibraryByPath('com/example/lib/1.0/lib-1.0.jar'),
    ]);
    for (const file of files) {
      expect(file).toMatchObject({ replace: true, trustExistingSize: false });
      expect(file.validatedAt).toBeUndefined();
      expect(file.checksum?.algorithm).toBe('sha1');
    }
    expect(repairFiles(version, folder, {})).toEqual([]);
  });
});

describe('hashes in the manifest', () => {
  it('every file has sha1 — launch is allowed', async () => {
    const version = await writeVersionFixture(root);
    expect(fileWithoutHash(version, MinecraftFolder.from(root))).toBeNull();
    expect(() => {
      assertHashes(version, MinecraftFolder.from(root));
    }).not.toThrow();
  });

  it('file without a hash — checksum-mismatch, not running untrusted code', async () => {
    const version = await writeVersionFixture(root, { librarySha1: '' });
    const folder = MinecraftFolder.from(root);
    expect(fileWithoutHash(version, folder)).toBe(
      folder.getLibraryByPath('com/example/lib/1.0/lib-1.0.jar'),
    );
    expect(() => {
      assertHashes(version, folder);
    }).toThrow(LaunchFailure);
  });
});

describe('isPrecheckFailure', () => {
  it('recognizes @xmcl/core precheck errors before launch', () => {
    expect(isPrecheckFailure({ error: 'CorruptedVersionJar' })).toBe(true);
    expect(isPrecheckFailure({ error: 'MissingLibraries' })).toBe(true);
    expect(isPrecheckFailure(new Error('other'))).toBe(false);
    expect(isPrecheckFailure(null)).toBe(false);
  });
});

describe('countVerifiedFiles', () => {
  it('client, libraries, index and asset objects', async () => {
    const version = await writeVersionFixture(root);
    const folder = MinecraftFolder.from(root);
    expect(await countVerifiedFiles(version, folder)).toBe(3);
    await mkdir(folder.getPath('assets', 'indexes'), { recursive: true });
    await writeFile(
      folder.getPath('assets', 'indexes', `${'b'.repeat(40)}.json`),
      JSON.stringify({ objects: { a: {}, b: {} } }),
    );
    expect(await countVerifiedFiles(version, folder)).toBe(5);
  });
});

describe('installGameFiles', () => {
  it('client, libraries and assets — in one batch so the size is known upfront', async () => {
    const version = await writeVersionFixture(root);
    const folder = MinecraftFolder.from(root);
    await mkdir(folder.getPath('assets', 'indexes'), { recursive: true });
    await writeFile(
      folder.getPath('assets', 'indexes', `${'b'.repeat(40)}.json`),
      JSON.stringify({ objects: { 'icons/a.png': { hash: 'd'.repeat(40), size: 5 } } }),
    );
    const plans: Parameters<TrackedRuntime['execute']>[0][] = [];
    const transfer = {
      execute: (plan) => {
        plans.push(plan);
        return Promise.resolve();
      },
    } as TrackedRuntime;
    await installGameFiles(version, folder, transfer, undefined);
    expect(plans).toHaveLength(1);
    const files = plans[0]?.tasks.flatMap((task) => (task.type === 'files' ? task.files : []));
    expect(files?.map((file) => file.path)).toEqual([
      folder.getVersionJar('26.3'),
      folder.getLibraryByPath('com/example/lib/1.0/lib-1.0.jar'),
      folder.getAsset('d'.repeat(40)),
    ]);
  });
});
