import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameInstanceService } from './instance-service';
import { InstanceStore } from './instances';
import { LaunchOptionsStore } from './launch-options';
import { gameLayout } from './layout';

let root: string;
let active: string | null;
let checking: boolean;
let service: GameInstanceService;
let store: InstanceStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-service-'));
  active = null;
  checking = false;
  const layout = gameLayout(root);
  store = new InstanceStore({ layout, now: Date.now });
  service = new GameInstanceService({
    store,
    launchOptions: new LaunchOptionsStore(layout),
    activeInstance: (): string | null => active,
    checkingCrash: (): boolean => checking,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('server folders in the list', () => {
  it('server-<id> includes size and the last launch time', async () => {
    const server = join(root, 'instances', 'server-123');
    await mkdir(join(server, 'logs'), { recursive: true });
    await mkdir(join(server, 'mods'), { recursive: true });
    await writeFile(join(server, 'mods', 'sodium.jar'), 'x'.repeat(10));
    await writeFile(join(server, 'logs', 'mcmonitor-launch.log'), 'log');
    const record = JSON.stringify({
      installed: { minecraft: '1.21.11', loader: { kind: 'vanilla', version: null } },
    });
    await writeFile(join(server, 'mcmonitor-instance.json'), record);
    const played = new Date('2026-10-02T10:00:00Z');
    await utimes(join(server, 'logs', 'mcmonitor-launch.log'), played, played);
    await mkdir(join(root, 'instances', 'server-0'), { recursive: true });
    await mkdir(join(root, 'instances', 'server-abc'), { recursive: true });
    await mkdir(join(root, 'instances', 'server-9'), { recursive: true });
    const list = await service.list();
    expect(list.ok && list.value).toEqual([
      {
        folderId: 'server-123',
        serverId: 123,
        sizeBytes: 13 + record.length,
        lastPlayedAt: played.toISOString(),
        installed: { minecraft: '1.21.11', loader: { kind: 'vanilla', version: null } },
      },
      {
        folderId: 'server-9',
        serverId: 9,
        sizeBytes: 0,
        lastPlayedAt: null,
        installed: null,
      },
    ]);
  });
});

describe('legacy folders that are not catalog servers', () => {
  it('are neither listed nor removable', async () => {
    const legacy = join(root, 'instances', 'profile-pack-1a2b3c');
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'instance.json'), '{}');
    const list = await service.list();
    expect(list.ok && list.value).toEqual([]);
    expect(await service.remove('profile-pack-1a2b3c')).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(await exists(legacy)).toBe(true);
  });
});

describe('remove', () => {
  it('deletes the server folder and forgets its launch options', async () => {
    const server = join(root, 'instances', 'server-7');
    await mkdir(join(server, 'mods'), { recursive: true });
    await service.setWithoutMods('server-7', true);
    expect(await service.remove('server-7')).toEqual({ ok: true, value: null });
    expect(await exists(server)).toBe(false);
    expect(await service.launchOptions('server-7')).toEqual({
      ok: true,
      value: { withoutMods: false },
    });
  });

  it('a server being launched, played or checked after a crash stays on disk', async () => {
    const server = join(root, 'instances', 'server-7');
    await mkdir(server, { recursive: true });
    active = 'server-7';
    expect(await service.remove('server-7')).toEqual({
      ok: false,
      error: { code: 'server-in-use' },
    });
    active = null;
    const release = store.acquire('server-7');
    expect(await service.remove('server-7')).toEqual({
      ok: false,
      error: { code: 'server-in-use' },
    });
    expect(await exists(server)).toBe(true);
    release();
    checking = true;
    expect(await service.remove('server-7')).toEqual({
      ok: false,
      error: { code: 'server-in-use' },
    });
    expect(await exists(server)).toBe(true);
    checking = false;
    expect(await service.remove('server-7')).toEqual({ ok: true, value: null });
  });
});
