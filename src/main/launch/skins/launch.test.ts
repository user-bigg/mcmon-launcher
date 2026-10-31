import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { LaunchOption, ResolvedVersion } from '@xmcl/core';
import type { InstallRuntime } from '@xmcl/installer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchEvent, LaunchRequest, LaunchTarget } from '@shared/launch';
import type { SkinModTable } from '@shared/skin-mod';
import type { LaunchTelemetryEvent } from '@shared/telemetry';
import type { TrackedRuntime } from '../download';
import type { PlayerResolver } from '../accounts';
import type { GameProcessHandlers } from '../game-process';
import { gameLayout } from '../layout';
import { LaunchOptionsStore } from '../launch-options';
import type { LoaderStepOptions, PreparedLoader } from '../loader-step';
import { loaderVersionId } from '../loaders/versions';
import { createLaunchService, type GameLaunchService, type LaunchDependencies } from '../service';
import type { VersionEntry } from '../version-manifest';
import { skinConfig, skinConfigFile } from './config';
import type { ModFetch } from './mod-file';
import type { SkinModSource } from './variant';

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn((): boolean => true);
}

const JAR = Buffer.from('the original mod jar');
const SHA = createHash('sha256').update(JAR).digest('hex');
const MOD_URL = 'https://cdn.modrinth.com/data/idMHQ4n2/versions/yyYvYfZI/mod.jar';
const FABRIC_ID = 'fabric-loader-0.19.5-26.3';

const table: SkinModTable = {
  updated_at: null,
  service_root: 'https://mc-mon.ru/skins/',
  source_url: null,
  license_url: null,
  license: null,
  entries: [
    {
      minecraft: '26.3',
      loader: 'fabric',
      loader_version: '0.19.5',
      mod: { version: '15.1-Universal', urls: [MOD_URL], sha256: SHA, size: JAR.byteLength },
    },
  ],
  client_mod: null,
};

const server: LaunchTarget = {
  kind: 'server',
  serverId: 7,
  minecraft: '26.3',
  address: 'play.example.org',
};
const byNick: LaunchRequest = { target: server, account: { kind: 'nick', nick: 'Steve' } };

function versionFor(id: string): ResolvedVersion {
  return {
    id,
    minecraftVersion: '26.3',
    libraries: [],
    arguments: { game: [], jvm: [] },
  } as unknown as ResolvedVersion;
}

function fakeTransfer(): TrackedRuntime {
  return {
    runtime: {} as InstallRuntime,
    downloadedBytes: () => 0,
    execute: () => Promise.resolve(),
    onInstallEvent: () => undefined,
  };
}

let root: string;
let handlers: GameProcessHandlers | null;
let launched: LaunchOption[];
let events: LaunchEvent[];
let telemetry: LaunchTelemetryEvent[];
let loaders: LoaderStepOptions['runtime'][];
let modRequests: string[];
let serveMod: ModFetch;
let prepareLoader: LaunchDependencies['prepareLoader'];
let verifyWithLoaderRepair: LaunchDependencies['verifyWithLoaderRepair'];
let launchOptions: LaunchOptionsStore;
let whileFilesInstall: () => Promise<unknown>;

const licence: PlayerResolver = (account) =>
  Promise.resolve(
    account.kind === 'nick'
      ? { nick: account.nick, telemetry: 'nick', auth: null }
      : { nick: 'Alex', telemetry: 'microsoft', auth: { uuid: '0'.repeat(32), accessToken: 't' } },
  );

function makeService(skinMod: SkinModSource | undefined): GameLaunchService {
  const entry: VersionEntry = {
    id: '26.3',
    type: 'release',
    url: `https://piston-meta.mojang.com/v1/packages/${'a'.repeat(40)}/26.3.json`,
    sha1: 'a'.repeat(40),
    releaseTime: '2026-09-01T00:00:00+00:00',
  };
  const dependencies: Partial<LaunchDependencies> = {
    findVersion: () => Promise.resolve(entry),
    installVersionJson: (_folder, item) => Promise.resolve(versionFor(item.id)),
    installJava: () => Promise.resolve('/java/bin/java'),
    readVersionLock: () => Promise.resolve(undefined),
    writeVersionLock: () => Promise.resolve(true),
    removeVersionLock: () => Promise.resolve(),
    installAssetIndex: () => Promise.resolve(),
    installGameFiles: async () => {
      await whileFilesInstall();
    },
    verifyInstallation: () => Promise.resolve(),
    countVerifiedFiles: () => Promise.resolve(1),
    createTransfer: () => fakeTransfer(),
    prepareLoader: (options, transfer) => prepareLoader(options, transfer),
    verifyWithLoaderRepair: (options, prepared, base, transfer) =>
      verifyWithLoaderRepair(options, prepared, base, transfer),
    fetchSkinMod: (url, maxBytes, signal) => {
      modRequests.push(url);
      return serveMod(url, maxBytes, signal);
    },
    launchGame: (options) => {
      launched.push(options);
      return Promise.resolve(new FakeChild() as unknown as ChildProcess);
    },
    watchGame: (_child, _options, watch) => {
      handlers = watch;
    },
    killGame: () => undefined,
  };
  const service = createLaunchService({
    root,
    platform: 'darwin',
    arch: 'arm64',
    totalMemoryBytes: 16 * 1024 ** 3,
    fetch: () => Promise.resolve({}),
    ...(skinMod === undefined ? {} : { skinMod }),
    withoutMods: async (folderId) => (await launchOptions.get(folderId)).withoutMods,
    resolvePlayer: licence,
    telemetry: (event) => {
      telemetry.push(event);
    },
    dependencies,
  });
  service.onEvent((event) => {
    events.push(event);
  });
  return service;
}

async function finish(service: GameLaunchService): Promise<void> {
  handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
  await service.whenIdle();
}

function jvmArgs(index = 0): string[] {
  return launched[index]?.extraJVMArgs ?? [];
}

function modsFolderArg(index = 0): string | undefined {
  return jvmArgs(index).find((arg) => arg.startsWith('-Dfabric.modsFolder='));
}

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-skins-launch-'));
  launchOptions = new LaunchOptionsStore(gameLayout(root));
  whileFilesInstall = (): Promise<void> => Promise.resolve();
  handlers = null;
  launched = [];
  events = [];
  telemetry = [];
  loaders = [];
  modRequests = [];
  serveMod = (): Promise<Uint8Array> => Promise.resolve(JAR);
  prepareLoader = (options): Promise<PreparedLoader> => {
    loaders.push(options.runtime);
    const id = loaderVersionId(options.runtime);
    return Promise.resolve({
      version: versionFor(id),
      lockFile: join(root, 'versions', id, 'mcmonitor-lock.json'),
      validatedAt: undefined,
      fresh: true,
    });
  };
  verifyWithLoaderRepair = (_options, prepared): Promise<ResolvedVersion> =>
    Promise.resolve(prepared.version);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe('launch with MC Monitor skins', () => {
  it('by nickname the game starts on Fabric with the mod folder and says so', async () => {
    const service = makeService(() => Promise.resolve(table));
    const result = await service.launch(byNick);
    expect(result).toMatchObject({
      ok: true,
      value: { minecraft: '26.3', loader: 'fabric', skins: 'on', instance: 'server-7' },
    });
    expect(launched[0]?.version).toMatchObject({ id: FABRIC_ID });
    expect(modsFolderArg()).toBe(`-Dfabric.modsFolder=${join(root, 'skin-mod', SHA)}`);
    expect(launched[0]?.javaPath).toBe('/java/bin/java');
    expect(loaders).toEqual([{ minecraft: '26.3', loader: 'fabric', loaderVersion: '0.19.5' }]);
    expect(telemetry.find((event) => event.type === 'launch.started')).toMatchObject({
      loader: 'fabric',
    });
    await finish(service);
  });

  it('the mod lives outside the instance; the instance gets only the settings file', async () => {
    const service = makeService(() => Promise.resolve(table));
    await service.launch(byNick);
    const instance = join(root, 'instances', 'server-7');
    expect(launched[0]?.gamePath).toBe(instance);
    expect(await readdir(join(root, 'skin-mod', SHA))).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
    ]);
    await expect(readdir(join(instance, 'mods'))).rejects.toThrow();
    const written: unknown = JSON.parse(await readFile(skinConfigFile(instance), 'utf8'));
    expect(written).toEqual(skinConfig('https://mc-mon.ru/skins/'));
    await finish(service);
  });

  it('the server record still names the plain game, so no update is offered', async () => {
    const service = makeService(() => Promise.resolve(table));
    await service.launch(byNick);
    const record: unknown = JSON.parse(
      await readFile(join(root, 'instances', 'server-7', 'mcmonitor-instance.json'), 'utf8'),
    );
    expect(record).toEqual({
      installed: { minecraft: '26.3', loader: { kind: 'vanilla', version: null } },
    });
    await finish(service);
  });

  it('the next plain launch of the same server gets neither Fabric nor the mod folder', async () => {
    const service = makeService(() => Promise.resolve(table));
    await service.launch(byNick);
    await finish(service);
    await launchOptions.setWithoutMods('server-7', true);
    const plain = await service.launch(byNick);
    expect(plain).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'user' } });
    expect(launched[1]?.version).toMatchObject({ id: '26.3' });
    expect(modsFolderArg(1)).toBeUndefined();
    expect(launched[1]?.gamePath).toBe(launched[0]?.gamePath);
    await finish(service);
  });

  it('a licence never gets the mod or Fabric, and the table is not even asked', async () => {
    const source = vi.fn(() => Promise.resolve(table));
    const service = makeService(source);
    const result = await service.launch({
      target: server,
      account: { kind: 'account', id: 'ms-1' },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { nick: 'Alex', loader: 'vanilla', skins: 'license' },
    });
    expect(launched[0]?.version).toMatchObject({ id: '26.3' });
    expect(launched[0]?.accessToken).toBe('t');
    expect(modsFolderArg()).toBeUndefined();
    expect(source).not.toHaveBeenCalled();
    expect(loaders).toEqual([]);
    expect(modRequests).toEqual([]);
    const instance = join(root, 'instances', 'server-7');
    await expect(readdir(join(instance, 'CustomSkinLoader'))).rejects.toThrow();
    await expect(readdir(join(root, 'skin-mod'))).rejects.toThrow();
    await finish(service);
  });

  it('the choice to launch without mods is kept in the game folder, apart for each server', async () => {
    await launchOptions.setWithoutMods('server-7', true);
    const reopened = new LaunchOptionsStore(gameLayout(root));
    expect(await reopened.get('server-7')).toEqual({ withoutMods: true });
    expect(await reopened.get('server-8')).toEqual({ withoutMods: false });
    await reopened.setWithoutMods('server-7', false);
    expect(await new LaunchOptionsStore(gameLayout(root)).get('server-7')).toEqual({
      withoutMods: false,
    });
    await expect(reopened.get('../outside')).rejects.toMatchObject({
      error: { code: 'invalid-request' },
    });
    expect(await readdir(join(root, 'instances'))).toEqual(['launch-options.json']);
  });

  it('mods switched off while the files download: this very launch goes plain', async () => {
    whileFilesInstall = (): Promise<unknown> => launchOptions.setWithoutMods('server-7', true);
    const service = makeService(() => Promise.resolve(table));
    const result = await service.launch(byNick);
    expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'user' } });
    expect(loaders).toEqual([]);
    expect(modsFolderArg()).toBeUndefined();
    await finish(service);
  });

  it('mods switched back on while the files download: skins are on', async () => {
    await launchOptions.setWithoutMods('server-7', true);
    const source = vi.fn(() => Promise.resolve(table));
    whileFilesInstall = async (): Promise<void> => {
      await launchOptions.setWithoutMods('server-7', false);
    };
    const service = makeService(source);
    const result = await service.launch(byNick);
    expect(result).toMatchObject({ ok: true, value: { loader: 'fabric', skins: 'on' } });
    expect(source).toHaveBeenCalledOnce();
    expect(modsFolderArg()).toBeDefined();
    await finish(service);
  });

  it('a server that turned skins off gets the plain game while the table has no client mod', async () => {
    const service = makeService(() => Promise.resolve(table));
    const result = await service.launch({ ...byNick, serverSkins: false });
    expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'server' } });
    expect(loaders).toEqual([]);
    expect(modRequests).toEqual([]);
    await finish(service);
  });

  it('a game version missing from the table starts without skins', async () => {
    const service = makeService(() => Promise.resolve({ ...table, entries: [] }));
    const result = await service.launch(byNick);
    expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'version' } });
    expect(modsFolderArg()).toBeUndefined();
    await finish(service);
  });

  it('an old site without the table and a failing request start the plain game', async () => {
    const none = makeService(() => Promise.resolve(null));
    expect(await none.launch(byNick)).toMatchObject({ ok: true, value: { loader: 'vanilla' } });
    await finish(none);
    const failing = makeService(() => Promise.reject(new Error('offline')));
    expect(await failing.launch(byNick)).toMatchObject({ ok: true, value: { skins: 'table' } });
    expect(loaders).toEqual([]);
    await finish(failing);
  });

  it('a mod that fails the hash check does not stop the game: it starts without skins', async () => {
    serveMod = (): Promise<Uint8Array> => Promise.resolve(Buffer.from('a rebuilt mod jar...'));
    const service = makeService(() => Promise.resolve(table));
    const result = await service.launch(byNick);
    expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'unavailable' } });
    expect(launched[0]?.version).toMatchObject({ id: '26.3' });
    expect(modsFolderArg()).toBeUndefined();
    expect(loaders).toEqual([]);
    expect(await readdir(join(root, 'skin-mod', SHA)).catch(() => [])).toEqual([]);
    const loaderStep = events.at(-1)?.state.progress?.steps.find((step) => step.id === 'loader');
    expect(loaderStep?.status).toBe('skipped');
    await finish(service);
  });

  it('an unreachable mod address starts the game without skins', async () => {
    serveMod = (): Promise<Uint8Array> => Promise.reject(new Error('ENOTFOUND'));
    const service = makeService(() => Promise.resolve(table));
    expect(await service.launch(byNick)).toMatchObject({
      ok: true,
      value: { skins: 'unavailable' },
    });
    expect(modRequests).toEqual([MOD_URL]);
    await finish(service);
  });

  it('Fabric that fails to install starts the game without skins', async () => {
    prepareLoader = (): Promise<PreparedLoader> => Promise.reject(new Error('maven is down'));
    const service = makeService(() => Promise.resolve(table));
    const result = await service.launch(byNick);
    expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'unavailable' } });
    expect(launched[0]?.version).toMatchObject({ id: '26.3' });
    expect(modsFolderArg()).toBeUndefined();
    await finish(service);
  });

  it('Fabric that fails verification starts the game without skins', async () => {
    verifyWithLoaderRepair = (): Promise<ResolvedVersion> =>
      Promise.reject(new Error('pinned hash changed'));
    const service = makeService(() => Promise.resolve(table));
    const result = await service.launch(byNick);
    expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'unavailable' } });
    expect(modsFolderArg()).toBeUndefined();
    await finish(service);
  });

  it('a full disk while installing Fabric is still an error', async () => {
    prepareLoader = (): Promise<PreparedLoader> =>
      Promise.reject(Object.assign(new Error('full'), { code: 'ENOSPC' }));
    const service = makeService(() => Promise.resolve(table));
    expect(await service.launch(byNick)).toMatchObject({
      ok: false,
      error: { code: 'disk-full' },
    });
    expect(launched).toEqual([]);
  });

  it('the status reaches the screen while the files are still being installed', async () => {
    const service = makeService(() => Promise.resolve(table));
    await service.launch(byNick);
    const preparing = events.filter((event) => event.state.phase === 'preparing');
    expect(preparing.some((event) => event.state.skins === 'on')).toBe(true);
    const running = await service.state();
    expect(running.ok && running.value.skins).toBe('on');
    await finish(service);
    const idle = await service.state();
    expect(idle.ok && idle.value.skins).toBeNull();
  });

  it('installing ahead of time does not ask about skins', async () => {
    const source = vi.fn(() => Promise.resolve(table));
    const service = makeService(source);
    expect(await service.prepare(server)).toMatchObject({
      ok: true,
      value: { loader: 'vanilla', versionId: '26.3' },
    });
    expect(source).not.toHaveBeenCalled();
    expect(loaders).toEqual([]);
  });
});

describe('launch with the MC Monitor client mod', () => {
  const CLIENT_JAR = Buffer.from('the MC Monitor client mod jar');
  const CLIENT_SHA = createHash('sha256').update(CLIENT_JAR).digest('hex');
  const CLIENT_URL = `https://mc-mon.ru/storage/client-mod/${CLIENT_SHA}.jar`;
  const withClient: SkinModTable = {
    ...table,
    client_mod: {
      version: '0.1.0',
      license: 'GPL-3.0-only',
      license_url: null,
      source_url: null,
      lines: [
        {
          minecraft_from: '26.1',
          minecraft_to: null,
          loader_version: '0.19.5',
          mod: {
            version: '0.1.0',
            urls: [CLIENT_URL],
            sha256: CLIENT_SHA,
            size: CLIENT_JAR.byteLength,
          },
        },
      ],
    },
  };
  const modsDirOf = (): string => modsFolderArg()?.replace('-Dfabric.modsFolder=', '') ?? '';

  beforeEach(() => {
    serveMod = (url): Promise<Uint8Array> => Promise.resolve(url === CLIENT_URL ? CLIENT_JAR : JAR);
  });

  it('goes together with the skins mod in one folder', async () => {
    const service = makeService(() => Promise.resolve(withClient));
    expect(await service.launch(byNick)).toMatchObject({
      ok: true,
      value: { loader: 'fabric', skins: 'on' },
    });
    expect((await readdir(modsDirOf())).sort()).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
      'MCMonitor-0.1.0.jar',
    ]);
    await finish(service);
  });

  it('goes alone on Fabric when the server turned skins off, with no skins settings', async () => {
    const service = makeService(() => Promise.resolve(withClient));
    const result = await service.launch({ ...byNick, serverSkins: false });
    expect(result).toMatchObject({ ok: true, value: { loader: 'fabric', skins: 'server' } });
    expect(modsDirOf()).toBe(join(root, 'skin-mod', CLIENT_SHA));
    expect(await readdir(modsDirOf())).toEqual(['MCMonitor-0.1.0.jar']);
    expect(loaders).toEqual([{ minecraft: '26.3', loader: 'fabric', loaderVersion: '0.19.5' }]);
    await expect(
      readdir(join(root, 'instances', 'server-7', 'CustomSkinLoader')),
    ).rejects.toThrow();
    await finish(service);
  });

  it('goes when the player chose to launch without skins', async () => {
    await launchOptions.setWithoutMods('server-7', true);
    const service = makeService(() => Promise.resolve(withClient));
    const result = await service.launch(byNick);
    expect(result).toMatchObject({ ok: true, value: { loader: 'fabric', skins: 'user' } });
    expect(await readdir(modsDirOf())).toEqual(['MCMonitor-0.1.0.jar']);
    await finish(service);
  });

  const startedClientMod = (): unknown =>
    telemetry.find((event) => event.type === 'launch.started')?.client_mod;

  it('a server with a modpack gets the plain game without the client mod', async () => {
    const service = makeService(() => Promise.resolve(withClient));
    const result = await service.launch({ ...byNick, serverSkins: false, serverModpack: true });
    expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'server' } });
    expect(modsFolderArg()).toBeUndefined();
    expect(loaders).toEqual([]);
    expect(modRequests).toEqual([]);
    expect(startedClientMod()).toBe('off');
    await finish(service);
  });

  it('a client mod that fails the hash check leaves the plain game', async () => {
    serveMod = (): Promise<Uint8Array> => Promise.resolve(Buffer.from('a rebuilt client mod jar'));
    const service = makeService(() => Promise.resolve(withClient));
    const result = await service.launch({ ...byNick, serverSkins: false });
    expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'server' } });
    expect(modsFolderArg()).toBeUndefined();
    expect(loaders).toEqual([]);
    expect(startedClientMod()).toBe('unavailable');
    await finish(service);
  });

  it('Fabric that fails to install makes the client mod unavailable', async () => {
    prepareLoader = (): Promise<PreparedLoader> => Promise.reject(new Error('maven is down'));
    const service = makeService(() => Promise.resolve(withClient));
    await service.launch({ ...byNick, serverSkins: false });
    expect(modsFolderArg()).toBeUndefined();
    expect(startedClientMod()).toBe('unavailable');
    await finish(service);
  });

  describe('after the client mod crashed the game at start', () => {
    const crashed = { minecraft: '26.3', sha256: CLIENT_SHA };

    it('the next launch of this version goes without it and without Fabric for it', async () => {
      const service = makeService(() => Promise.resolve(withClient));
      await service.blockClientMod(crashed);
      const result = await service.launch({ ...byNick, serverSkins: false });
      expect(result).toMatchObject({ ok: true, value: { loader: 'vanilla', skins: 'server' } });
      expect(modsFolderArg()).toBeUndefined();
      expect(loaders).toEqual([]);
      expect(startedClientMod()).toBe('unavailable');
      await finish(service);
    });

    it('skins still go on Fabric, only the client mod is left out', async () => {
      const service = makeService(() => Promise.resolve(withClient));
      await service.blockClientMod(crashed);
      await service.launch(byNick);
      expect(await readdir(modsDirOf())).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
      await finish(service);
    });

    it('a launch right after the crash waits until the crash check has saved the block', async () => {
      const service = makeService(() => Promise.resolve(withClient));
      let saved = false;
      const check = new Promise<void>((resolve) => {
        setTimeout(() => {
          void service.blockClientMod(crashed).then(() => {
            saved = true;
            resolve();
          });
        }, 20);
      });
      service.holdLaunchesUntil(check);
      await service.launch({ ...byNick, serverSkins: false });
      expect(saved).toBe(true);
      expect(modsFolderArg()).toBeUndefined();
      await finish(service);
    });

    it('the window learns about the block from the launch state', async () => {
      const service = makeService(() => Promise.resolve(withClient));
      await service.blockClientMod(crashed);
      const state = await service.state();
      expect(state.ok && state.value.blockedClientMods).toEqual([crashed]);
      expect(events.at(-1)?.state.blockedClientMods).toEqual([crashed]);
    });

    it('the block outlives a restart of the launcher', async () => {
      await makeService(() => Promise.resolve(withClient)).blockClientMod(crashed);
      const restarted = makeService(() => Promise.resolve(withClient));
      await restarted.launch({ ...byNick, serverSkins: false });
      expect(modsFolderArg()).toBeUndefined();
      await finish(restarted);
    });

    it('a new jar in the table lifts the block by itself', async () => {
      const service = makeService(() => Promise.resolve(withClient));
      await service.blockClientMod({ ...crashed, sha256: 'e'.repeat(64) });
      await service.launch({ ...byNick, serverSkins: false });
      expect(await readdir(modsDirOf())).toEqual(['MCMonitor-0.1.0.jar']);
      expect(startedClientMod()).toBe('on');
      expect(service.clientModRunOf(4242)).toEqual(crashed);
      await finish(service);
    });
  });
});
