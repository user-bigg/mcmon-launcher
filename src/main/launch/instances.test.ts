import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LaunchFailure } from './errors';
import { readInstanceOverrides, writeInstanceOverrides } from './instance-overrides';
import { InstanceStore, listModFileNames } from './instances';
import { serverLaunchProfile } from './launch-profile';
import { gameLayout } from './layout';

let root: string;
let store: InstanceStore;
let clock: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-instances-'));
  clock = Date.parse('2026-10-03T10:00:00Z');
  store = new InstanceStore({ layout: gameLayout(root), now: (): number => clock });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('InstanceStore', () => {
  it('a folder busy with a running launch cannot be removed', async () => {
    await mkdir(join(root, 'instances', 'server-4'), { recursive: true });
    const release = store.acquire('server-4');
    await expect(store.removeServer('server-4')).rejects.toMatchObject({
      error: { code: 'server-in-use' },
    });
    release();
    expect(store.isInUse('server-4')).toBe(false);
    await store.removeServer('server-4');
    expect(await store.listServers()).toEqual([]);
  });

  it("a repeated release by one holder does not free another holder's folder", () => {
    const first = store.acquire('server-4');
    const second = store.acquire('server-4');
    first();
    first();
    expect(store.isInUse('server-4')).toBe(true);
    second();
    expect(store.isInUse('server-4')).toBe(false);
  });

  it('launching a server during its removal returns busy', async () => {
    await mkdir(join(root, 'instances', 'server-4'), { recursive: true });
    const removing = store.removeServer('server-4');
    expect(() => store.acquire('server-4')).toThrow(LaunchFailure);
    await removing;
  });

  it('only a server folder is removed', async () => {
    await mkdir(join(root, 'instances', 'profile-own'), { recursive: true });
    for (const folderId of ['profile-own', '../etc', 'server-0']) {
      await expect(store.removeServer(folderId)).rejects.toMatchObject({
        error: { code: 'invalid-request' },
      });
    }
  });

  it('mods: .jar in any case, .zip, .litemod, and symlinks count; .disabled files and folders do not', async () => {
    const folder = join(root, 'instances', 'server-8');
    const mods = join(folder, 'mods');
    await mkdir(mods, { recursive: true });
    await writeFile(join(mods, 'sodium.jar'), 'x'.repeat(100));
    await writeFile(join(mods, 'lithium.JAR'), 'x'.repeat(50));
    await writeFile(join(mods, 'old.jar.disabled'), 'x');
    await mkdir(join(mods, 'nested.jar'));
    await writeFile(join(root, 'shared.jar'), 'x');
    await symlink(join(root, 'shared.jar'), join(mods, 'linked.jar'));
    await writeFile(join(mods, 'old.zip'), 'x');
    await writeFile(join(mods, 'liteloader.litemod'), 'x');
    expect(await listModFileNames(folder)).toEqual([
      'linked.jar',
      'liteloader.litemod',
      'lithium.JAR',
      'old.zip',
      'sodium.jar',
    ]);
  });

  it('legacy folders that are not catalog servers are not listed', async () => {
    await mkdir(join(root, 'instances', 'profile-pack-1a2b3c', 'mods'), { recursive: true });
    await mkdir(join(root, 'instances', 'server-4'), { recursive: true });
    expect((await store.listServers()).map((server) => server.folderId)).toEqual(['server-4']);
  });

  it('removal leaves the shared game files, also those linked into the folder', async () => {
    const shared = join(root, 'libraries', 'org', 'lwjgl.jar');
    await mkdir(join(root, 'libraries', 'org'), { recursive: true });
    await writeFile(shared, 'lwjgl');
    const mods = join(root, 'instances', 'server-4', 'mods');
    await mkdir(mods, { recursive: true });
    await link(shared, join(mods, 'hard.jar'));
    await symlink(shared, join(mods, 'soft.jar'));
    await store.removeServer('server-4');
    expect(await readFile(shared, 'utf8')).toBe('lwjgl');
    expect(await store.listServers()).toEqual([]);
  });

  it('a game left running in the folder by an earlier launcher keeps it', async () => {
    const folder = join(root, 'instances', 'server-4');
    await mkdir(folder, { recursive: true });
    const running = new InstanceStore({
      layout: gameLayout(root),
      now: (): number => clock,
      isGameRunning: (instance): Promise<boolean> => Promise.resolve(instance === folder),
    });
    await expect(running.removeServer('server-4')).rejects.toMatchObject({
      error: { code: 'server-in-use' },
    });
    expect((await running.listServers()).map((server) => server.folderId)).toEqual(['server-4']);
  });

  it('a size counted before removal does not come back for a new folder', async () => {
    const folder = join(root, 'instances', 'server-4');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'options.txt'), 'x'.repeat(500));
    const counting = store.listServers();
    await store.removeServer('server-4');
    await counting;
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'options.txt'), 'x'.repeat(10));
    expect((await store.listServers())[0]?.sizeBytes).toBe(10);
  });

  it('shared game files are counted once, cached, and a missing folder is zero', async () => {
    expect(await store.sharedSize()).toBe(0);
    clock += 60_000;
    await mkdir(join(root, 'versions', '1.16.5'), { recursive: true });
    await writeFile(join(root, 'versions', '1.16.5', '1.16.5.jar'), 'x'.repeat(400));
    await mkdir(join(root, 'libraries', 'org'), { recursive: true });
    await writeFile(join(root, 'libraries', 'org', 'lwjgl.jar'), 'x'.repeat(200));
    await mkdir(join(root, 'assets', 'objects'), { recursive: true });
    await writeFile(join(root, 'assets', 'objects', 'ab'), 'x'.repeat(100));
    await mkdir(join(root, 'runtime', 'jre-legacy'), { recursive: true });
    await writeFile(join(root, 'runtime', 'jre-legacy', 'java'), 'x'.repeat(50));
    await mkdir(join(root, 'instances', 'server-5'), { recursive: true });
    await writeFile(join(root, 'instances', 'server-5', 'options.txt'), 'x'.repeat(7));
    expect(await store.sharedSize()).toBe(750);
    await writeFile(join(root, 'assets', 'objects', 'cd'), 'x'.repeat(100));
    expect(await store.sharedSize()).toBe(750);
    clock += 60_000;
    expect(await store.sharedSize()).toBe(850);
  });

  it('size counts asked at the same moment share one walk', async () => {
    await mkdir(join(root, 'assets', 'objects'), { recursive: true });
    await writeFile(join(root, 'assets', 'objects', 'ab'), 'x'.repeat(100));
    const first = store.sharedSize();
    const second = store.sharedSize();
    expect(second).toBe(first);
    expect(await Promise.all([first, second])).toEqual([100, 100]);
  });
});

describe('an installed server build', () => {
  const installed = { minecraft: '1.21.11', loader: { kind: 'vanilla', version: null } } as const;

  async function serverFolder(id: number): Promise<string> {
    const dir = join(root, 'instances', `server-${String(id)}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  it('a mcmonitor-instance.json entry in the server folder is read by the list', async () => {
    expect(await store.recordServerInstall(5, installed)).toBe(true);
    const file = join(root, 'instances', 'server-5', 'mcmonitor-instance.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ installed });
    expect(await store.listServers()).toMatchObject([{ serverId: 5, installed }]);
    const fabric = { minecraft: '26.3', loader: { kind: 'fabric', version: '0.19.5' } } as const;
    await store.recordServerInstall(5, fabric);
    expect(await store.listServers()).toMatchObject([{ serverId: 5, installed: fabric }]);
  });

  it('an old folder without an entry, and a corrupt entry, both return null', async () => {
    await serverFolder(1);
    const broken = await serverFolder(2);
    await writeFile(join(broken, 'mcmonitor-instance.json'), '{');
    const bad = [
      { minecraft: '../x', loader: { kind: 'vanilla', version: null } },
      { minecraft: '26.3', loader: { kind: 'optifine', version: null } },
      { minecraft: '26.3', loader: { kind: 'vanilla', version: '1.0' } },
      { minecraft: '26.3', loader: { kind: 'fabric', version: '0.19/5' } },
      { minecraft: 26.3, loader: { kind: 'vanilla', version: null } },
      { minecraft: '26.3' },
    ];
    for (const [index, value] of bad.entries()) {
      const dir = await serverFolder(10 + index);
      await writeFile(join(dir, 'mcmonitor-instance.json'), JSON.stringify({ installed: value }));
    }
    const servers = await store.listServers();
    expect(servers).toHaveLength(2 + bad.length);
    expect(servers.every((server) => server.installed === null)).toBe(true);
  });

  it("the entry and memory overrides don't erase each other; an id out of range is rejected", async () => {
    const dir = await serverFolder(3);
    const file = join(dir, 'mcmonitor-instance.json');
    await writeFile(file, JSON.stringify({ note: 'keep', schemaVersion: 2 }));
    await writeInstanceOverrides(dir, { memoryMb: 6144 });
    await store.recordServerInstall(3, installed);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      note: 'keep',
      schemaVersion: 2,
      memoryMb: 6144,
      installed,
    });
    await writeInstanceOverrides(dir, { memoryMb: 4096 });
    expect(await readInstanceOverrides(dir)).toEqual({ memoryMb: 4096 });
    expect(await store.listServers()).toMatchObject([{ serverId: 3, installed }]);
    await expect(store.recordServerInstall(0, installed)).rejects.toBeInstanceOf(LaunchFailure);
  });
});

describe('serverLaunchProfile', () => {
  it('a catalog server installs as vanilla into its own folder', () => {
    expect(
      serverLaunchProfile({ kind: 'server', serverId: 7, minecraft: '1.21.11', address: 'a.ru' }),
    ).toEqual({
      folderId: 'server-7',
      runtime: { minecraft: '1.21.11', loader: 'vanilla' },
      memoryMb: null,
      javaOverride: null,
    });
  });
});
