import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { LaunchOption, ResolvedVersion } from '@xmcl/core';
import type { InstallRuntime } from '@xmcl/installer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchEvent, LaunchRequest, LaunchTarget } from '@shared/launch';
import {
  DEFAULT_MOD_CHOICES,
  NO_SERVER_MODS,
  type ServerModsSource,
  type CatalogMod,
  type ModCatalog,
  type ModChoices,
  type ModKind,
  type ServerMods,
} from '@shared/mods';
import type { SkinModTable } from '@shared/skin-mod';
import type { LaunchTelemetryEvent } from '@shared/telemetry';
import type { PlayerResolver } from '../accounts';
import type { TrackedRuntime } from '../download';
import type { GameProcessHandlers } from '../game-process';
import type { LoaderStepOptions, PreparedLoader } from '../loader-step';
import { loaderVersionId } from '../loaders/versions';
import { createLaunchService, type GameLaunchService, type LaunchDependencies } from '../service';
import type { VersionEntry } from '../version-manifest';
import type { ModFetch } from '../skins/mod-file';

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn((): boolean => true);
}

const MC = '1.21.11';
const SKIN_JAR = Buffer.from('the skin mod jar');
const SKIN_SHA = createHash('sha256').update(SKIN_JAR).digest('hex');
const SKIN_URL = 'https://cdn.modrinth.com/data/idMHQ4n2/versions/yyYvYfZI/mod.jar';

const skinTable: SkinModTable = {
  updated_at: null,
  service_root: 'https://mc-mon.ru/skins/',
  source_url: null,
  license_url: null,
  license: null,
  entries: [
    {
      minecraft: MC,
      loader: 'fabric',
      loader_version: '0.17.3',
      mod: {
        version: '15.1-Universal',
        urls: [SKIN_URL],
        sha256: SKIN_SHA,
        size: SKIN_JAR.byteLength,
      },
    },
  ],
  client_mod: null,
};

const served = new Map<string, Buffer>([[SKIN_URL, SKIN_JAR]]);

function bytesOf(slug: string): Buffer {
  return Buffer.from(`the file of ${slug}`);
}

function urlOf(slug: string, kind: ModKind): string {
  return `https://mc-mon.ru/storage/mods/${slug}.${kind === 'mod' ? 'jar' : 'zip'}`;
}

function catalogMod(
  slug: string,
  patch: Partial<CatalogMod> = {},
  loaderMin = '0.16.10',
): CatalogMod {
  const kind = patch.kind ?? 'mod';
  const bytes = bytesOf(slug);
  served.set(urlOf(slug, kind), bytes);
  return {
    slug,
    kind,
    title: `Title ${slug}`,
    short: `Short ${slug}`,
    summary: '',
    group: 'interface',
    player: true,
    server: false,
    often_forbidden: false,
    requires: [],
    modrinth_id: 'AAAAAAAA',
    license: 'MIT',
    source_url: null,
    credit: null,
    options: null,
    files: [
      {
        minecraft: MC,
        loader: kind === 'mod' ? 'fabric' : null,
        loader_min: kind === 'mod' ? loaderMin : null,
        version: `${slug}-1.0`,
        channel: slug === 'emotes' ? 'beta' : 'release',
        urls: [urlOf(slug, kind)],
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength,
        requires: patch.requires ?? [],
      },
    ],
    ...patch,
  };
}

const catalog: ModCatalog = {
  updated_at: null,
  mods: [
    catalogMod('fabric-api', { player: false }),
    catalogMod('rso', { player: false }),
    catalogMod('sodium', { requires: ['rso'] }, '0.17.2'),
    catalogMod('iris', { requires: ['sodium'] }),
    catalogMod('minimap'),
    catalogMod('appleskin'),
    catalogMod('voice', { server: true }),
    catalogMod('emotes', { player: false, server: true, requires: ['fabric-api'] }, '0.18.1'),
    catalogMod('old-only', { files: [] }),
    catalogMod('light-pack', {
      kind: 'shader_pack',
      player: false,
      requires: ['iris'],
      options: { profile: 'low' },
    }),
  ],
  shaders: { light: 'light-pack', beautiful: 'light-pack' },
};

const target: LaunchTarget = {
  kind: 'server',
  serverId: 68,
  minecraft: MC,
  address: 'play.example.org',
};

const lines = new Map<number, ServerModsSource>();

function serverHas(serverMods: ServerMods | undefined, serverId = 68): void {
  lines.set(serverId, { state: 'known', modpack: false, mods: serverMods ?? NO_SERVER_MODS });
}

// The window says nothing about the mods of the server: main asks the site by the id.
function byNick(
  serverMods: ServerMods | undefined,
  patch: Partial<LaunchRequest> = {},
): LaunchRequest {
  serverHas(serverMods);
  return { target, account: { kind: 'nick', nick: 'Steve' }, ...patch };
}

const VOICE_SERVER: ServerMods = { required: ['voice'], optional: ['emotes'], forbidden: [] };

function versionFor(id: string): ResolvedVersion {
  return {
    id,
    minecraftVersion: MC,
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
let choices: ModChoices;
let catalogSource: () => Promise<ModCatalog | null>;
let skinSource: () => Promise<SkinModTable | null>;
let serverAsked: number[];
let javaInstalls: number;
let beforeLoader: () => Promise<void>;

const licence: PlayerResolver = (account) =>
  Promise.resolve(
    account.kind === 'nick'
      ? { nick: account.nick, telemetry: 'nick', auth: null }
      : { nick: 'Alex', telemetry: 'microsoft', auth: { uuid: '0'.repeat(32), accessToken: 't' } },
  );

function makeService(): GameLaunchService {
  const entry: VersionEntry = {
    id: MC,
    type: 'release',
    url: `https://piston-meta.mojang.com/v1/packages/${'a'.repeat(40)}/${MC}.json`,
    sha1: 'a'.repeat(40),
    releaseTime: '2025-12-01T00:00:00+00:00',
  };
  const dependencies: Partial<LaunchDependencies> = {
    findVersion: () => Promise.resolve(entry),
    installVersionJson: (_folder, item) => Promise.resolve(versionFor(item.id)),
    installJava: () => {
      javaInstalls += 1;
      return Promise.resolve('/java/bin/java');
    },
    readVersionLock: () => Promise.resolve(undefined),
    writeVersionLock: () => Promise.resolve(true),
    removeVersionLock: () => Promise.resolve(),
    installAssetIndex: () => Promise.resolve(),
    installGameFiles: () => Promise.resolve(),
    verifyInstallation: () => Promise.resolve(),
    countVerifiedFiles: () => Promise.resolve(1),
    createTransfer: () => fakeTransfer(),
    prepareLoader: async (options): Promise<PreparedLoader> => {
      loaders.push(options.runtime);
      await beforeLoader();
      const id = loaderVersionId(options.runtime);
      return {
        version: versionFor(id),
        lockFile: join(root, 'versions', id, 'mcmonitor-lock.json'),
        validatedAt: undefined,
        fresh: true,
      };
    },
    verifyWithLoaderRepair: (_options, prepared) => Promise.resolve(prepared.version),
    fetchSkinMod: (url, maxBytes, signal, onBytes) => {
      modRequests.push(url);
      return serveMod(url, maxBytes, signal, onBytes);
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
    skinMod: () => skinSource(),
    mods: {
      catalog: () => catalogSource(),
      server: (serverId) => {
        serverAsked.push(serverId);
        return Promise.resolve(
          lines.get(serverId) ?? { state: 'known', modpack: false, mods: NO_SERVER_MODS },
        );
      },
      choices: () => Promise.resolve(structuredClone(choices)),
    },
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

async function waitingMods(): Promise<unknown> {
  for (let tries = 0; tries < 400; tries += 1) {
    const waiting = events.at(-1)?.state.modsWaiting;
    if (waiting !== undefined) {
      return waiting;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the launch did not ask about the mods');
}

async function finish(service: GameLaunchService): Promise<void> {
  handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
  await service.whenIdle();
}

function modsDir(index = 0): string | null {
  const arg = (launched[index]?.extraJVMArgs ?? []).find((item) =>
    item.startsWith('-Dfabric.modsFolder='),
  );
  return arg === undefined ? null : arg.slice('-Dfabric.modsFolder='.length);
}

async function modsInGame(index = 0): Promise<string[]> {
  const dir = modsDir(index);
  return dir === null ? [] : (await readdir(dir)).sort();
}

function started(): LaunchTelemetryEvent | undefined {
  return telemetry.filter((event) => event.type === 'launch.started').at(-1);
}

const instance = (): string => join(root, 'instances', 'server-68');

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-mods-launch-'));
  handlers = null;
  launched = [];
  events = [];
  telemetry = [];
  loaders = [];
  modRequests = [];
  choices = structuredClone(DEFAULT_MOD_CHOICES);
  lines.clear();
  serverAsked = [];
  javaInstalls = 0;
  beforeLoader = (): Promise<void> => Promise.resolve();
  catalogSource = (): Promise<ModCatalog | null> => Promise.resolve(catalog);
  skinSource = (): Promise<SkinModTable | null> => Promise.resolve(skinTable);
  serveMod = (url): Promise<Uint8Array> => {
    const bytes = served.get(url);
    return bytes === undefined ? Promise.reject(new Error('HTTP 404')) : Promise.resolve(bytes);
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe('launch with server and player mods', () => {
  it('puts the server mods, their dependencies and the player mods next to the skin mod', async () => {
    choices.enabled = ['appleskin'];
    const service = makeService();
    const result = await service.launch(byNick(VOICE_SERVER));
    expect(result).toMatchObject({ ok: true, value: { loader: 'fabric', skins: 'on' } });
    expect(await modsInGame()).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
      'appleskin.jar',
      'emotes.jar',
      'fabric-api.jar',
      'voice.jar',
    ]);
    expect(await readFile(join(modsDir() ?? '', 'voice.jar'))).toEqual(bytesOf('voice'));
    await expect(readdir(join(instance(), 'mods'))).rejects.toThrow();
    expect(started()).toMatchObject({
      loader: 'fabric',
      skins: 'on',
      mods: [
        { slug: 'voice', state: 'on', version: 'voice-1.0' },
        { slug: 'emotes', state: 'on', version: 'emotes-1.0' },
        { slug: 'appleskin', state: 'on', version: 'appleskin-1.0' },
      ],
    });
    await finish(service);
  });

  it('one Fabric Loader serves the launch: the highest of what the mods and the skin mod need', async () => {
    const service = makeService();
    await service.launch(byNick(VOICE_SERVER));
    expect(loaders).toEqual([{ minecraft: MC, loader: 'fabric', loaderVersion: '0.18.1' }]);
    await finish(service);
    choices.enabled = [];
    await service.launch(byNick(undefined));
    expect(loaders[1]).toEqual({ minecraft: MC, loader: 'fabric', loaderVersion: '0.17.3' });
    await finish(service);
  });

  it('a licence gets the mods but neither the skin mod nor the client mod', async () => {
    const service = makeService();
    choices.enabled = ['sodium'];
    serverHas(VOICE_SERVER);
    const result = await service.launch({ target, account: { kind: 'account', id: 'ms-1' } });
    expect(result).toMatchObject({ ok: true, value: { loader: 'fabric', skins: 'license' } });
    expect(await modsInGame()).toEqual([
      'emotes.jar',
      'fabric-api.jar',
      'rso.jar',
      'sodium.jar',
      'voice.jar',
    ]);
    expect(loaders).toEqual([{ minecraft: MC, loader: 'fabric', loaderVersion: '0.18.1' }]);
    expect(started()).toMatchObject({
      skins: 'off',
      client_mod: 'off',
      mods: [
        { slug: 'voice', state: 'on' },
        { slug: 'emotes', state: 'on' },
        { slug: 'sodium', state: 'on' },
      ],
    });
    await expect(readdir(join(instance(), 'CustomSkinLoader'))).rejects.toThrow();
    await finish(service);
  });

  it('a licence without mods gets no Fabric at all, and neither does a plain server', async () => {
    const service = makeService();
    await service.launch({ target, account: { kind: 'account', id: 'ms-1' } });
    expect(modsDir()).toBeNull();
    expect(loaders).toEqual([]);
    expect(started()).not.toHaveProperty('mods');
    await finish(service);
    skinSource = (): Promise<SkinModTable | null> => Promise.resolve(null);
    await service.launch(byNick(undefined));
    expect(modsDir(1)).toBeNull();
    expect(loaders).toEqual([]);
    await finish(service);
  });

  it('a required mod without a file stops the launch before the game, with no launch.started', async () => {
    const service = makeService();
    const result = await service.launch(
      byNick({ required: ['old-only', 'mystery'], optional: [], forbidden: [] }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'mods-required-missing',
        mods: [
          { slug: 'old-only', short: 'Short old-only', title: 'Title old-only' },
          { slug: 'mystery', short: null, title: null },
        ],
      },
    });
    expect(launched).toEqual([]);
    expect(started()).toBeUndefined();
    expect(modRequests).toEqual([]);
  });

  it('a required mod that did not download stops the launch with a retry, and the retry works', async () => {
    const working = serveMod;
    serveMod = (url, ...rest): Promise<Uint8Array> =>
      url.includes('voice') ? Promise.reject(new Error('HTTP 503')) : working(url, ...rest);
    const service = makeService();
    const result = await service.launch(byNick(VOICE_SERVER));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'mods-required-failed', mods: [{ slug: 'voice', short: 'Short voice' }] },
    });
    expect(launched).toEqual([]);
    expect(started()).toBeUndefined();
    serveMod = working;
    expect(await service.launch(byNick(VOICE_SERVER))).toMatchObject({ ok: true });
    expect(await modsInGame()).toContain('voice.jar');
    await finish(service);
  });

  it('a required mod with no catalog fails and offers a retry', async () => {
    catalogSource = (): Promise<ModCatalog | null> => Promise.reject(new Error('offline'));
    const service = makeService();
    expect(await service.launch(byNick(VOICE_SERVER))).toMatchObject({
      ok: false,
      error: { code: 'mods-required-failed', mods: [{ slug: 'voice', short: null }] },
    });
  });

  it('a failed optional mod waits for the player and is dropped with its dependants', async () => {
    served.set(urlOf('fabric-api', 'mod'), Buffer.from('tampered'));
    const service = makeService();
    const launching = service.launch(byNick(VOICE_SERVER));
    const asked = await waitingMods();
    expect(asked).toEqual([{ slug: 'emotes', short: 'Short emotes', title: 'Title emotes' }]);
    expect(launched).toEqual([]);
    expect(await service.answerMods('without')).toEqual({ ok: true, value: null });
    const result = await launching;
    served.set(urlOf('fabric-api', 'mod'), bytesOf('fabric-api'));
    expect(result).toMatchObject({ ok: true });
    expect(events.at(-1)?.state.modsWaiting).toBeUndefined();
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar', 'voice.jar']);
    expect(started()).toMatchObject({
      mods: [
        { slug: 'voice', state: 'on' },
        { slug: 'emotes', state: 'failed' },
      ],
    });
    const mods = events.at(-1)?.state.progress?.mods;
    expect(mods?.steps.map((step) => [step.slug, step.status])).toEqual([
      ['voice', 'done'],
      ['fabric-api', 'failed'],
      ['emotes', 'skipped'],
    ]);
    expect(loaders).toEqual([{ minecraft: MC, loader: 'fabric', loaderVersion: '0.17.3' }]);
    await finish(service);
  });

  it('Retry fetches only the mods that failed and the launch goes on with them', async () => {
    served.set(urlOf('fabric-api', 'mod'), Buffer.from('tampered'));
    const fetched: string[] = [];
    const working = serveMod;
    serveMod = (url, ...rest): Promise<Uint8Array> => {
      fetched.push(url);
      return working(url, ...rest);
    };
    const service = makeService();
    const launching = service.launch(byNick(VOICE_SERVER));
    await waitingMods();
    served.set(urlOf('fabric-api', 'mod'), bytesOf('fabric-api'));
    fetched.length = 0;
    expect(await service.answerMods('retry')).toEqual({ ok: true, value: null });
    expect(await launching).toMatchObject({ ok: true });
    serveMod = working;
    expect(fetched.filter((url) => url.includes('/storage/mods/'))).toEqual([
      urlOf('fabric-api', 'mod'),
    ]);
    expect(await modsInGame()).toContain('emotes.jar');
    expect(started()).toMatchObject({
      mods: [
        { slug: 'voice', state: 'on' },
        { slug: 'emotes', state: 'on' },
      ],
    });
    await finish(service);
  });

  it('a cancel while the launch waits for the player ends it without the game', async () => {
    served.set(urlOf('fabric-api', 'mod'), Buffer.from('tampered'));
    const service = makeService();
    const launching = service.launch(byNick(VOICE_SERVER));
    await waitingMods();
    await service.cancel();
    const result = await launching;
    served.set(urlOf('fabric-api', 'mod'), bytesOf('fabric-api'));
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(launched).toEqual([]);
    expect(await service.answerMods('without')).toEqual({
      ok: false,
      error: { code: 'not-running' },
    });
    await service.whenIdle();
  });

  it('there is nothing to answer when the launch does not wait', async () => {
    expect(await makeService().answerMods('retry')).toEqual({
      ok: false,
      error: { code: 'not-running' },
    });
  });

  it('a file whose hash does not match never reaches the game folder', async () => {
    served.set(urlOf('appleskin', 'mod'), Buffer.from('not the jar'));
    choices.enabled = ['appleskin'];
    const service = makeService();
    await service.launch(byNick(undefined));
    served.set(urlOf('appleskin', 'mod'), bytesOf('appleskin'));
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
    expect(started()).toMatchObject({ mods: [{ slug: 'appleskin', state: 'failed' }] });
    await expect(readdir(join(root, 'mod-files'))).rejects.toThrow();
    await finish(service);
  });

  it('the player may turn an optional mod off for this server', async () => {
    choices.optionalOff = { '68': ['emotes'] };
    const service = makeService();
    await service.launch(byNick(VOICE_SERVER));
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar', 'voice.jar']);
    expect(started()).toMatchObject({
      mods: [
        { slug: 'voice', state: 'on' },
        { slug: 'emotes', state: 'off_by_player' },
      ],
    });
    await finish(service);
  });

  it('a forbidden mod is left out on this server and stays on the others', async () => {
    choices.enabled = ['minimap', 'appleskin'];
    const service = makeService();
    await service.launch(byNick({ required: [], optional: [], forbidden: ['minimap'] }));
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar', 'appleskin.jar']);
    expect(started()).toMatchObject({
      mods: [
        { slug: 'minimap', state: 'forbidden' },
        { slug: 'appleskin', state: 'on' },
      ],
    });
    expect(events.at(-1)?.state.progress?.mods?.skipped).toEqual([
      {
        slug: 'minimap',
        short: 'Short minimap',
        title: 'Title minimap',
        state: 'forbidden',
        role: 'player',
      },
    ]);
    await finish(service);
    await service.launch({ ...byNick(undefined), target: { ...target, serverId: 69 } });
    expect(await modsInGame(1)).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
      'appleskin.jar',
      'minimap.jar',
    ]);
    await finish(service);
  });

  it('a jar of the last launch does not stay: the folder holds exactly this launch', async () => {
    choices.enabled = ['appleskin', 'minimap'];
    const service = makeService();
    await service.launch(byNick(undefined));
    const first = modsDir() ?? '';
    await writeFile(join(first, 'stray.jar'), 'x');
    await finish(service);
    choices.enabled = ['appleskin'];
    await service.launch(byNick(undefined));
    expect(await modsInGame(1)).toEqual(['CustomSkinLoader-15.1-Universal.jar', 'appleskin.jar']);
    await expect(readdir(first)).rejects.toThrow();
    await finish(service);
    choices.enabled = ['appleskin', 'minimap'];
    await service.launch(byNick(undefined));
    expect(await modsInGame(2)).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
      'appleskin.jar',
      'minimap.jar',
    ]);
    await finish(service);
  });

  it('each file is downloaded once and then taken from the store by its hash', async () => {
    choices.enabled = ['appleskin'];
    const service = makeService();
    await service.launch(byNick(undefined));
    await finish(service);
    choices.enabled = [];
    await service.launch(byNick(undefined));
    await finish(service);
    choices.enabled = ['appleskin'];
    await service.launch(byNick(undefined));
    expect(modRequests.filter((url) => url.includes('appleskin'))).toHaveLength(1);
    expect(events.at(-1)?.state.progress?.mods?.steps).toMatchObject([
      { slug: 'appleskin', status: 'done', fromDisk: true },
    ]);
    await finish(service);
  });

  it('a server with a modpack gets none of the catalog mods', async () => {
    choices.enabled = ['appleskin'];
    const service = makeService();
    await service.launch(byNick(VOICE_SERVER, { serverModpack: true }));
    expect(modsDir()).toBeNull();
    expect(started()).not.toHaveProperty('mods');
    await finish(service);
  });

  it('shows each mod as a step of the launch with its size and beta mark', async () => {
    const service = makeService();
    await service.launch(byNick(VOICE_SERVER));
    const mods = events.at(-1)?.state.progress?.mods;
    expect(
      mods?.steps.map((step) => [
        step.slug,
        step.role,
        step.channel,
        step.status,
        step.dependencyOf,
      ]),
    ).toEqual([
      ['voice', 'required', 'release', 'done', []],
      ['fabric-api', 'dependency', 'release', 'done', ['emotes']],
      ['emotes', 'optional', 'beta', 'done', []],
    ]);
    expect(mods?.steps[0]).toMatchObject({
      short: 'Short voice',
      title: 'Title voice',
      version: 'voice-1.0',
      size: bytesOf('voice').byteLength,
      fromDisk: false,
    });
    await finish(service);
  });
});

describe('launch with shaders', () => {
  it('lays out the chosen pack with its profile and turns shaders on in Iris', async () => {
    choices.shaders = 'light';
    const service = makeService();
    await service.launch(byNick(undefined));
    expect(await modsInGame()).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
      'iris.jar',
      'rso.jar',
      'sodium.jar',
    ]);
    expect((await readdir(join(instance(), 'shaderpacks'))).sort()).toEqual([
      'light-pack.zip',
      'light-pack.zip.txt',
    ]);
    expect(await readFile(join(instance(), 'config', 'iris.properties'), 'utf8')).toBe(
      'shaderPack=light-pack.zip\nenableShaders=true\ndisableUpdateMessage=true\n',
    );
    expect(started()).toMatchObject({
      mods: [{ slug: 'light-pack', state: 'on', version: 'light-pack-1.0' }],
    });
    await finish(service);
  });

  it("shaders off with Iris on: our pack leaves, the player's pack and other lines stay", async () => {
    choices.shaders = 'light';
    const service = makeService();
    await service.launch(byNick(undefined));
    await finish(service);
    await writeFile(
      join(instance(), 'config', 'iris.properties'),
      'colorSpace=SRGB\nshaderPack=light-pack.zip\nenableShaders=true\n',
    );
    await writeFile(join(instance(), 'shaderpacks', 'BSL.zip'), 'x');
    choices.shaders = 'off';
    choices.enabled = ['iris'];
    await service.launch(byNick(undefined));
    expect(await readdir(join(instance(), 'shaderpacks'))).toEqual(['BSL.zip']);
    expect(await readFile(join(instance(), 'config', 'iris.properties'), 'utf8')).toBe(
      'colorSpace=SRGB\nshaderPack=light-pack.zip\nenableShaders=false\n',
    );
    await finish(service);
  });

  it('a server that forbids Sodium gets no shaders and no pack in the folder', async () => {
    await mkdir(join(instance(), 'shaderpacks'), { recursive: true });
    await writeFile(join(instance(), 'shaderpacks', 'light-pack.zip'), 'old');
    choices.shaders = 'light';
    const service = makeService();
    await service.launch(byNick({ required: [], optional: [], forbidden: ['sodium'] }));
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
    expect(await readdir(join(instance(), 'shaderpacks'))).toEqual([]);
    expect(started()).toMatchObject({ mods: [{ slug: 'light-pack', state: 'forbidden' }] });
    await finish(service);
  });
});

describe('mods of the server come from the site', () => {
  it('main asks the site by the id of the server, whatever the window sent', async () => {
    serverHas({ required: [], optional: [], forbidden: ['minimap'] });
    choices.enabled = ['minimap'];
    const service = makeService();
    await service.launch({ target, account: { kind: 'nick', nick: 'Steve' } });
    expect(serverAsked).toEqual([68]);
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
    expect(started()).toMatchObject({ mods: [{ slug: 'minimap', state: 'forbidden' }] });
    await finish(service);
  });

  it('a server whose mods are unknown is not entered: retry, before Java and the game', async () => {
    lines.set(68, { state: 'unknown' });
    choices.enabled = ['appleskin'];
    const service = makeService();
    expect(await service.launch({ target, account: { kind: 'nick', nick: 'Steve' } })).toEqual({
      ok: false,
      error: { code: 'mods-server-unknown' },
    });
    expect(javaInstalls).toBe(0);
    expect(launched).toEqual([]);
    expect(started()).toBeUndefined();
  });

  it('a server with a modpack by the site gets no mods even if the window did not say so', async () => {
    lines.set(68, { state: 'known', modpack: true, mods: NO_SERVER_MODS });
    choices.enabled = ['appleskin'];
    const service = makeService();
    await service.launch({ target, account: { kind: 'nick', nick: 'Steve' } });
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
    expect(started()).not.toHaveProperty('mods');
    await finish(service);
  });

  it('a required mod without a file refuses before Java and the game are downloaded', async () => {
    const service = makeService();
    expect(
      await service.launch(byNick({ required: ['old-only'], optional: [], forbidden: [] })),
    ).toMatchObject({ ok: false, error: { code: 'mods-required-missing' } });
    expect(javaInstalls).toBe(0);
  });

  it('a required entry the site sent malformed blocks the server like an unknown mod', async () => {
    const service = makeService();
    expect(
      await service.launch(byNick({ required: ['', 'voice'], optional: [], forbidden: [] })),
    ).toEqual({
      ok: false,
      error: { code: 'mods-required-missing', mods: [{ slug: '', short: null, title: null }] },
    });
    expect(javaInstalls).toBe(0);
  });

  it('without a catalog the game goes on without mods and reports none', async () => {
    catalogSource = (): Promise<ModCatalog | null> => Promise.resolve(null);
    choices.enabled = ['appleskin'];
    const service = makeService();
    expect(
      await service.launch(byNick({ required: [], optional: ['emotes'], forbidden: ['minimap'] })),
    ).toMatchObject({ ok: true });
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
    expect(started()).not.toHaveProperty('mods');
    await finish(service);
  });
});

describe('Fabric for the mods', () => {
  it('a licence counts only the mods it gets, not the skin mod it does not', async () => {
    choices.enabled = ['appleskin'];
    const service = makeService();
    await service.launch({ target, account: { kind: 'account', id: 'ms-1' } });
    expect(loaders).toEqual([{ minecraft: MC, loader: 'fabric', loaderVersion: '0.16.10' }]);
    await finish(service);
  });

  it('the line of the client mod sets the lowest loader for the game version, also by licence', async () => {
    const line = {
      minecraft_from: '1.21',
      minecraft_to: null,
      loader_version: '0.18.0',
      mod: { version: '1', urls: [SKIN_URL], sha256: SKIN_SHA, size: SKIN_JAR.byteLength },
    };
    skinSource = (): Promise<SkinModTable | null> =>
      Promise.resolve({
        ...skinTable,
        client_mod: {
          version: '1',
          license: null,
          license_url: null,
          source_url: null,
          lines: [line],
        },
      });
    choices.enabled = ['appleskin'];
    const service = makeService();
    await service.launch({ target, account: { kind: 'account', id: 'ms-1' } });
    expect(loaders).toEqual([{ minecraft: MC, loader: 'fabric', loaderVersion: '0.18.0' }]);
    await finish(service);
  });

  it('Fabric that does not install with a required mod stops with a retry', async () => {
    beforeLoader = (): Promise<void> =>
      Promise.reject(Object.assign(new Error('loader'), { code: 'ECONNRESET' }));
    const service = makeService();
    const result = await service.launch(byNick(VOICE_SERVER));
    expect(result).toMatchObject({ ok: false, error: { code: 'mods-required-failed' } });
    expect(launched).toEqual([]);
  });

  it('a stored file spoiled before placing is left out and the rest is placed again', async () => {
    const working = serveMod;
    serveMod = async (url, ...rest): Promise<Uint8Array> => {
      if (url === SKIN_URL) {
        const voice = catalog.mods.find((item) => item.slug === 'voice')?.files[0];
        await writeFile(join(root, 'mod-files', `${voice?.sha256 ?? ''}.jar`), 'spoiled');
        served.delete(urlOf('voice', 'mod'));
      }
      return working(url, ...rest);
    };
    const service = makeService();
    const result = await service.launch(
      byNick({ required: [], optional: ['voice'], forbidden: [] }),
    );
    served.set(urlOf('voice', 'mod'), bytesOf('voice'));
    expect(result).toMatchObject({ ok: true });
    expect(await modsInGame()).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
    expect(started()).toMatchObject({ mods: [{ slug: 'voice', state: 'failed' }] });
    await finish(service);
  });

  it('without the skin table no set of the skin mod is removed', async () => {
    const kept = join(root, 'skin-mod', 'f'.repeat(64));
    await mkdir(kept, { recursive: true });
    await writeFile(join(kept, 'CustomSkinLoader-15.1-Universal.jar'), SKIN_JAR);
    skinSource = (): Promise<SkinModTable | null> => Promise.resolve(null);
    choices.enabled = ['appleskin'];
    const service = makeService();
    await service.launch(byNick(undefined));
    expect(await modsInGame()).toEqual(['appleskin.jar']);
    expect(await readdir(kept)).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
    await finish(service);
  });
});

describe('shaders that cannot be laid out', () => {
  it('cost only the shaders: the mods stay and the pack is reported as failed', async () => {
    choices.shaders = 'light';
    beforeLoader = async (): Promise<void> => {
      const pack = catalog.mods.find((item) => item.slug === 'light-pack')?.files[0];
      await writeFile(join(root, 'mod-files', `${pack?.sha256 ?? ''}.zip`), 'spoiled');
    };
    const service = makeService();
    expect(await service.launch(byNick(undefined))).toMatchObject({ ok: true });
    expect(await modsInGame()).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
      'iris.jar',
      'rso.jar',
      'sodium.jar',
    ]);
    await expect(readdir(join(instance(), 'shaderpacks'))).resolves.toEqual([]);
    expect(started()).toMatchObject({ mods: [{ slug: 'light-pack', state: 'failed' }] });
    await finish(service);
  });
});
