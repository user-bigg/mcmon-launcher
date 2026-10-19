import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientModLine, SkinModEntry, SkinModFile, SkinModTable } from '@shared/skin-mod';
import { gameLayout, type GameLayout } from '../layout';
import { extraListDir, skinConfig } from './config';
import {
  createModFetch,
  ensureFabricMods,
  fabricModFileName,
  fabricModsDir,
  pruneSkinMods,
  skinModsRoot,
  type FabricMod,
  type ModFetch,
} from './mod-file';
import {
  canPlayWithoutSkins,
  fabricModsKeys,
  placeSkinFiles,
  planSkins,
  type SkinsRequest,
} from './variant';

const JAR = Buffer.from('the original mod jar');
const FIRST = 'https://cdn.modrinth.com/data/idMHQ4n2/versions/yyYvYfZI/mod.jar';
const SECOND = 'https://mc-mon.ru/files/skin-mod/mod.jar';
const CLIENT_URL = 'https://mc-mon.ru/storage/client-mod/mod.jar';
const CLIENT_JAR = Buffer.from('the MC Monitor client mod jar');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function modOf(bytes: Uint8Array, version = '15.1-Universal'): SkinModFile {
  return { version, urls: [FIRST, SECOND], sha256: sha256(bytes), size: bytes.byteLength };
}

function entryOf(mod: SkinModFile, minecraft = '1.21.1'): SkinModEntry {
  return { minecraft, loader: 'fabric', loader_version: '0.19.5', mod };
}

function tableOf(entries: SkinModEntry[]): SkinModTable {
  return {
    updated_at: null,
    service_root: 'https://mc-mon.ru/skins/',
    source_url: null,
    license_url: null,
    license: null,
    entries,
    client_mod: null,
  };
}

function clientLineOf(
  bytes: Uint8Array,
  from = '1.20.2',
  to: string | null = '1.21.11',
  loaderVersion = '0.19.5',
): ClientModLine {
  return {
    minecraft_from: from,
    minecraft_to: to,
    loader_version: loaderVersion,
    mod: { version: '0.1.0', urls: [CLIENT_URL], sha256: sha256(bytes), size: bytes.byteLength },
  };
}

function withClient(table: SkinModTable, lines: ClientModLine[]): SkinModTable {
  return {
    ...table,
    client_mod: {
      version: '0.1.0',
      license: 'GPL-3.0-only',
      license_url: null,
      source_url: null,
      lines,
    },
  };
}

function skinsMod(file: SkinModFile): FabricMod {
  return { role: 'skins', file };
}

function clientMod(file: SkinModFile): FabricMod {
  return { role: 'client', file };
}

function dirOf(...files: SkinModFile[]): string {
  return fabricModsDir(
    layout,
    files.map((file) => file.sha256),
  );
}

function nameOf(file: SkinModFile): string {
  return fabricModFileName(skinsMod(file));
}

let root: string;
let layout: GameLayout;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
const signal = new AbortController().signal;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-skins-'));
  layout = gameLayout(root);
  log = vi.fn();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

function serving(replies: Record<string, Uint8Array | Error>): ModFetch & { calls: string[] } {
  const calls: string[] = [];
  const fetch: ModFetch = (url) => {
    calls.push(url);
    const reply = replies[url];
    if (reply === undefined || reply instanceof Error) {
      return Promise.reject(reply ?? new Error('HTTP 404'));
    }
    return Promise.resolve(reply);
  };
  return Object.assign(fetch, { calls });
}

async function ensureOne(
  mod: SkinModFile,
  fetch: ModFetch,
  stop: AbortSignal = signal,
): Promise<string | null> {
  const placed = await ensureFabricMods({
    layout,
    mods: [skinsMod(mod)],
    fetch,
    signal: stop,
    log,
  });
  return placed?.dir ?? null;
}

describe('ensureFabricMods', () => {
  it('downloads the mod, checks sha256 and size and puts it in a folder of its own', async () => {
    const mod = modOf(JAR);
    const fetch = serving({ [FIRST]: JAR });
    const dir = await ensureOne(mod, fetch);
    expect(dir).toBe(dirOf(mod));
    expect(await readdir(dir ?? '')).toEqual(['CustomSkinLoader-15.1-Universal.jar']);
    expect(await readFile(join(dir ?? '', nameOf(mod)))).toEqual(JAR);
    expect(fetch.calls).toEqual([FIRST]);
  });

  it('a verified file on disk is not downloaded again', async () => {
    const mod = modOf(JAR);
    await ensureOne(mod, serving({ [FIRST]: JAR }));
    const again = serving({});
    expect(await ensureOne(mod, again)).not.toBeNull();
    expect(again.calls).toEqual([]);
  });

  it('goes on to the second address when the first gives another file', async () => {
    const mod = modOf(JAR);
    const fetch = serving({ [FIRST]: Buffer.from('a rebuilt mod with extras'), [SECOND]: JAR });
    const dir = await ensureOne(mod, fetch);
    expect(fetch.calls).toEqual([FIRST, SECOND]);
    expect(await readFile(join(dir ?? '', nameOf(mod)))).toEqual(JAR);
  });

  it('goes on to the second address when the first is unreachable', async () => {
    const mod = modOf(JAR);
    const fetch = serving({ [FIRST]: new Error('ENOTFOUND'), [SECOND]: JAR });
    expect(await ensureOne(mod, fetch)).not.toBeNull();
    expect(fetch.calls).toEqual([FIRST, SECOND]);
  });

  it('a file of the right size and a wrong hash is refused', async () => {
    const forged = Buffer.from(JAR);
    forged[0] = (forged[0] ?? 0) ^ 0xff;
    const fetch = serving({ [FIRST]: forged, [SECOND]: forged });
    const mod = modOf(JAR);
    expect(await ensureOne(mod, fetch)).toBeNull();
    expect(await readdir(dirOf(mod)).catch(() => [])).toEqual([]);
  });

  it('every address failing gives no mod and leaves no file behind', async () => {
    const mod = modOf(JAR);
    const fetch = serving({});
    expect(await ensureOne(mod, fetch)).toBeNull();
    expect(fetch.calls).toEqual([FIRST, SECOND]);
    expect(await readdir(dirOf(mod)).catch(() => [])).toEqual([]);
  });

  it('a damaged file on disk is removed and replaced by the original', async () => {
    const mod = modOf(JAR);
    const dir = dirOf(mod);
    const file = join(dir, nameOf(mod));
    await mkdir(dir, { recursive: true });
    await writeFile(file, Buffer.from('the damaged mod jar.'));
    expect(await ensureOne(mod, serving({}))).toBeNull();
    expect(await readdir(dir)).toEqual([]);
    await writeFile(file, Buffer.from('the damaged mod jar.'));
    await ensureOne(mod, serving({ [FIRST]: JAR }));
    expect(await readFile(file)).toEqual(JAR);
  });

  it('a folder sitting where the jar belongs is replaced by the file', async () => {
    const mod = modOf(JAR);
    const file = join(dirOf(mod), nameOf(mod));
    await mkdir(join(file, 'inner'), { recursive: true });
    await ensureOne(mod, serving({ [FIRST]: JAR }));
    expect(await readFile(file)).toEqual(JAR);
  });

  it('a stray jar next to the mod is removed before the game sees the folder', async () => {
    const mod = modOf(JAR);
    const dir = dirOf(mod);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'stranger.jar'), 'not ours');
    await ensureOne(mod, serving({ [FIRST]: JAR }));
    expect(await readdir(dir)).toEqual([nameOf(mod)]);
  });

  it('stops on cancel instead of trying the next address', async () => {
    const controller = new AbortController();
    const fetch: ModFetch = () => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    };
    await expect(ensureOne(modOf(JAR), fetch, controller.signal)).rejects.toThrow();
  });

  it('refuses a hash or a version that could leave the folder', () => {
    expect(() => fabricModsDir(layout, ['../../outside'])).toThrow();
    expect(() => nameOf({ ...modOf(JAR), version: '../x' })).toThrow();
  });
});

describe('ensureFabricMods with the client mod', () => {
  const skins = modOf(JAR);
  const client = clientLineOf(CLIENT_JAR).mod;
  const both = serving({ [FIRST]: JAR, [CLIENT_URL]: CLIENT_JAR });

  it('puts both mods in one folder of their own and nothing else', async () => {
    const placed = await ensureFabricMods({
      layout,
      mods: [skinsMod(skins), clientMod(client)],
      fetch: both,
      signal,
      log,
    });
    expect(placed?.dir).toBe(dirOf(skins, client));
    expect(placed?.dir).not.toBe(dirOf(skins));
    expect([...(placed?.roles ?? [])]).toEqual(['skins', 'client']);
    expect((await readdir(placed?.dir ?? '')).sort()).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
      'MCMonitor-0.1.0.jar',
    ]);
  });

  it('a mod that cannot be had is left out, the other one goes alone', async () => {
    const placed = await ensureFabricMods({
      layout,
      mods: [skinsMod(skins), clientMod(client)],
      fetch: serving({ [CLIENT_URL]: CLIENT_JAR }),
      signal,
      log,
    });
    expect(placed?.dir).toBe(dirOf(client));
    expect([...(placed?.roles ?? [])]).toEqual(['client']);
    expect(await readdir(placed?.dir ?? '')).toEqual(['MCMonitor-0.1.0.jar']);
  });

  it('takes a verified jar from the folder of another set instead of downloading it', async () => {
    await ensureOne(skins, serving({ [FIRST]: JAR }));
    const fetch = serving({ [CLIENT_URL]: CLIENT_JAR });
    const placed = await ensureFabricMods({
      layout,
      mods: [skinsMod(skins), clientMod(client)],
      fetch,
      signal,
      log,
    });
    expect(fetch.calls).toEqual([CLIENT_URL]);
    expect(await readFile(join(placed?.dir ?? '', nameOf(skins)))).toEqual(JAR);
    expect(await readFile(join(dirOf(skins), nameOf(skins)))).toEqual(JAR);
  });

  it('a damaged jar in another set is not taken', async () => {
    await mkdir(dirOf(skins), { recursive: true });
    await writeFile(join(dirOf(skins), nameOf(skins)), Buffer.from('the damaged mod jar.'));
    const fetch = serving({ [FIRST]: JAR, [CLIENT_URL]: CLIENT_JAR });
    const mods = [skinsMod(skins), clientMod(client)];
    const placed = await ensureFabricMods({ layout, mods, fetch, signal, log });
    expect(fetch.calls).toEqual([FIRST, CLIENT_URL]);
    expect(await readFile(join(placed?.dir ?? '', nameOf(skins)))).toEqual(JAR);
  });

  it('a temporary file and an old jar are removed from the folder of both mods', async () => {
    const dir = dirOf(skins, client);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'MCMonitor-0.1.0.jar.1a2b3c4d.tmp'), 'half a download');
    await writeFile(join(dir, 'CustomSkinLoader-15.0-Universal.jar'), 'the previous mod');
    const mods = [skinsMod(skins), clientMod(client)];
    await ensureFabricMods({ layout, mods, fetch: both, signal, log });
    expect((await readdir(dir)).sort()).toEqual([
      'CustomSkinLoader-15.1-Universal.jar',
      'MCMonitor-0.1.0.jar',
    ]);
  });

  it('the set without skins gets its own folder, the folder with both is not touched', async () => {
    const mods = [skinsMod(skins), clientMod(client)];
    await ensureFabricMods({ layout, mods, fetch: both, signal, log });
    const alone = await ensureFabricMods({
      layout,
      mods: [clientMod(client)],
      fetch: both,
      signal,
      log,
    });
    expect(await readdir(alone?.dir ?? '')).toEqual(['MCMonitor-0.1.0.jar']);
    expect(await readdir(dirOf(skins, client))).toHaveLength(2);
  });
});

describe('pruneSkinMods', () => {
  it('a new table replaces the old mod: folders of other hashes are removed', async () => {
    const old = modOf(JAR, '15.0-Universal');
    const fresh = modOf(Buffer.from('the next mod jar'), '15.2-Universal');
    await ensureOne(old, serving({ [FIRST]: JAR }));
    const plan = await planSkins(requestFor(tableOf([entryOf(fresh)])), {
      minecraft: '1.21.1',
      loader: 'vanilla',
    });
    expect(plan.plan).not.toBeNull();
    if (plan.plan === null) {
      return;
    }
    await placeSkinFiles({
      layout,
      instance: join(root, 'instances', 'server-7'),
      plan: plan.plan,
      fetch: serving({ [FIRST]: Buffer.from('the next mod jar') }),
      signal,
      log,
    });
    expect(await readdir(skinModsRoot(layout))).toEqual([fresh.sha256]);
  });

  it('keeps the folders of the client mod: alone and together with the skins mod', async () => {
    const skins = modOf(JAR);
    const line = clientLineOf(CLIENT_JAR);
    const later = clientLineOf(Buffer.from('the 26.1 line jar'), '26.1', null);
    const keys = fabricModsKeys(withClient(tableOf([entryOf(skins)]), [line, later]));
    expect(keys).toEqual(
      new Set([skins.sha256, line.mod.sha256, later.mod.sha256, dirOf(skins, line.mod).slice(-64)]),
    );
    for (const key of [...keys, 'c'.repeat(64)]) {
      await mkdir(join(skinModsRoot(layout), key), { recursive: true });
    }
    await pruneSkinMods(layout, keys);
    expect(new Set(await readdir(skinModsRoot(layout)))).toEqual(keys);
  });
});

describe('createModFetch', () => {
  function reply(bytes: Uint8Array, init: ResponseInit = {}): Response {
    return new Response(Buffer.from(bytes), init);
  }

  it('reads the body and sends no cookies', async () => {
    const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(reply(JAR)),
    );
    const bytes = await createModFetch(fetchImpl)(FIRST, JAR.byteLength, signal);
    expect(Buffer.from(bytes)).toEqual(JAR);
    expect(fetchImpl.mock.calls[0]?.[1].credentials).toBe('omit');
    expect(fetchImpl.mock.calls[0]?.[1].headers).toBeUndefined();
  });

  it('refuses a redirect that ends on another host', async () => {
    const moved = (): Promise<Response> => {
      const response = reply(JAR);
      Object.defineProperty(response, 'url', { value: 'https://evil.example/mod.jar' });
      return Promise.resolve(response);
    };
    await expect(createModFetch(moved)(FIRST, JAR.byteLength, signal)).rejects.toThrow(
      'another host',
    );
    const same = (): Promise<Response> => {
      const response = reply(JAR);
      Object.defineProperty(response, 'url', { value: `${FIRST}?cache=1` });
      return Promise.resolve(response);
    };
    expect(Buffer.from(await createModFetch(same)(FIRST, JAR.byteLength, signal))).toEqual(JAR);
  });

  it('refuses http, an error status and a body longer than the table says', async () => {
    const ok = vi.fn(() => Promise.resolve(reply(JAR)));
    await expect(createModFetch(ok)('http://cdn.modrinth.com/a.jar', 100, signal)).rejects.toThrow(
      'https',
    );
    expect(ok).not.toHaveBeenCalled();
    const missing = (): Promise<Response> => Promise.resolve(reply(JAR, { status: 404 }));
    await expect(createModFetch(missing)(FIRST, 100, signal)).rejects.toThrow('404');
    await expect(createModFetch(ok)(FIRST, JAR.byteLength - 1, signal)).rejects.toThrow('larger');
  });
});

describe('skinConfig', () => {
  it('lists the MC Monitor service first and the game server textures second', () => {
    expect(skinConfig('https://mc-mon.ru/skins/')).toEqual({
      loadlist: [
        { name: 'MC Monitor', type: 'ElyByAPI', root: 'https://mc-mon.ru/skins/' },
        { name: 'GameProfile', type: 'GameProfile' },
      ],
      forceLoadAllTextures: false,
      enableCape: true,
    });
  });

  it('has no Mojang source and no source named after a built-in site of the mod', () => {
    const { loadlist } = skinConfig('https://mc-mon.ru/skins/');
    expect(loadlist.map((source) => source.type)).not.toContain('MojangAPI');
    const builtIn = ['Mojang', 'ElyBy', 'TLauncher', 'GlitchlessGames', 'LittleSkin'];
    expect(builtIn).not.toContain(loadlist[0]?.name);
  });
});

function requestFor(table: SkinModTable | null, change: Partial<SkinsRequest> = {}): SkinsRequest {
  return {
    auth: 'nick',
    serverSkins: undefined,
    modpack: false,
    withoutMods: () => Promise.resolve(false),
    table: () => Promise.resolve(table),
    ...change,
  };
}

describe('planSkins', () => {
  const table = tableOf([entryOf(modOf(JAR))]);
  const vanilla = { minecraft: '1.21.1', loader: 'vanilla' } as const;

  it('plans Fabric of the table version for a plain game', async () => {
    const planned = await planSkins(requestFor(table), vanilla);
    expect(planned.status).toBe('on');
    expect(planned.plan?.runtime).toEqual({
      minecraft: '1.21.1',
      loader: 'fabric',
      loaderVersion: '0.19.5',
    });
    expect(planned.plan?.skins?.serviceRoot).toBe('https://mc-mon.ru/skins/');
    expect(planned.plan?.clientMod).toBeNull();
  });

  it('never asks for the table when the answer is already no', async () => {
    const ask = vi.fn(() => Promise.resolve(table));
    const fabric = { minecraft: '1.21.1', loader: 'fabric', loaderVersion: '0.19.5' } as const;
    expect((await planSkins(requestFor(table, { table: ask }), fabric)).status).toBe('loader');
    expect(
      (await planSkins(requestFor(table, { table: ask, auth: 'license' }), vanilla)).status,
    ).toBe('license');
    expect(
      (await planSkins(requestFor(table, { table: ask, modpack: true }), vanilla)).status,
    ).toBe('server');
    expect(ask).not.toHaveBeenCalled();
  });

  it('the choice made while the table was on its way is the one that counts', async () => {
    let off = false;
    const request = requestFor(table, {
      withoutMods: () => Promise.resolve(off),
      table: () => {
        off = true;
        return Promise.resolve(table);
      },
    });
    expect(await planSkins(request, vanilla)).toEqual({
      status: 'user',
      clientMod: 'off',
      plan: null,
    });
  });

  it('a choice that cannot be read counts as mods allowed', async () => {
    const request = requestFor(table, { withoutMods: () => Promise.reject(new Error('disk')) });
    expect((await planSkins(request, vanilla)).status).toBe('on');
  });

  it('a missing table, a failed request or an unknown version mean no skins', async () => {
    expect((await planSkins(requestFor(null), vanilla)).status).toBe('table');
    const failing = requestFor(table, { table: () => Promise.reject(new Error('offline')) });
    expect((await planSkins(failing, vanilla)).status).toBe('table');
    const old = { minecraft: '1.12.2', loader: 'vanilla' } as const;
    expect((await planSkins(requestFor(table), old)).status).toBe('version');
  });

  it('a launch that never asked about skins has no status', async () => {
    expect(await planSkins(null, vanilla)).toEqual({ status: null, clientMod: null, plan: null });
  });
});

describe('planSkins with the client mod', () => {
  const vanilla = { minecraft: '1.21.1', loader: 'vanilla' } as const;
  const line = clientLineOf(CLIENT_JAR);
  const table = withClient(tableOf([entryOf(modOf(JAR))]), [line]);
  const catalog = (change: Partial<SkinsRequest> = {}): SkinsRequest => requestFor(table, change);

  it('a catalog server gets both mods on one Fabric', async () => {
    const planned = await planSkins(catalog(), vanilla);
    expect(planned.status).toBe('on');
    expect(planned.plan?.skins?.entry.mod.sha256).toBe(sha256(JAR));
    expect(planned.plan?.clientMod).toBe(line);
  });

  it('the client mod alone when skins are off by the server, by the player or by the table', async () => {
    const cases: [Partial<SkinsRequest>, string][] = [
      [{ serverSkins: false }, 'server'],
      [{ withoutMods: () => Promise.resolve(true) }, 'user'],
      [{ table: () => Promise.resolve(withClient(tableOf([]), [line])) }, 'version'],
    ];
    for (const [change, status] of cases) {
      const planned = await planSkins(catalog(change), vanilla);
      expect(planned.status).toBe(status);
      expect(planned.plan?.skins).toBeNull();
      expect(planned.plan?.clientMod).toBe(line);
      expect(planned.plan?.runtime).toEqual({
        minecraft: '1.21.1',
        loader: 'fabric',
        loaderVersion: '0.19.5',
      });
    }
  });

  it('no client mod for a licence game, a game with a loader or a version without a line', async () => {
    const ask = vi.fn(() => Promise.resolve(table));
    const license = await planSkins(catalog({ auth: 'license', table: ask }), vanilla);
    expect(license).toEqual({ status: 'license', clientMod: 'off', plan: null });
    const fabric = { minecraft: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10' } as const;
    expect(await planSkins(catalog({ table: ask }), fabric)).toEqual({
      status: 'loader',
      clientMod: 'off',
      plan: null,
    });
    expect(ask).not.toHaveBeenCalled();
    const skinsOnly = await planSkins(catalog(), { minecraft: '1.21.12', loader: 'vanilla' });
    expect(skinsOnly.status).toBe('version');
    expect(skinsOnly.plan).toBeNull();
  });

  it('counts the loader of the skin mod only when the skin mod goes into this launch', async () => {
    const newer = withClient(tableOf([{ ...entryOf(modOf(JAR)), loader_version: '0.19.10' }]), [
      line,
    ]);
    const source: Partial<SkinsRequest> = { table: () => Promise.resolve(newer) };
    const offs: Partial<SkinsRequest>[] = [
      { serverSkins: false },
      { withoutMods: () => Promise.resolve(true) },
    ];
    for (const change of offs) {
      const planned = await planSkins(catalog({ ...source, ...change }), vanilla);
      expect(planned.plan?.skins).toBeNull();
      expect(planned.plan?.runtime.loaderVersion).toBe(line.loader_version);
    }
    const on = await planSkins(catalog(source), vanilla);
    expect(on.plan?.runtime.loaderVersion).toBe('0.19.10');
  });

  it('a server with a modpack gets the plain game, one that only turned skins off does not', async () => {
    const pack = await planSkins(catalog({ serverSkins: false, modpack: true }), vanilla);
    expect(pack).toEqual({ status: 'server', clientMod: 'off', plan: null });
    const silent = await planSkins(catalog({ serverSkins: undefined, modpack: true }), vanilla);
    expect(silent).toEqual({ status: 'server', clientMod: 'off', plan: null });
    const off = await planSkins(catalog({ serverSkins: false, modpack: false }), vanilla);
    expect(off.clientMod).toBe('on');
    expect(off.plan?.clientMod).toBe(line);
  });

  it('tells the telemetry whether the client mod was due', async () => {
    expect((await planSkins(catalog(), vanilla)).clientMod).toBe('on');
    const old = { minecraft: '1.12.2', loader: 'vanilla' } as const;
    expect((await planSkins(catalog(), old)).clientMod).toBe('off');
    const none = catalog({ table: () => Promise.resolve(null) });
    expect((await planSkins(none, vanilla)).clientMod).toBe('unavailable');
  });

  it('takes the newer loader of the two lines', async () => {
    const newer = withClient(tableOf([entryOf(modOf(JAR))]), [
      clientLineOf(CLIENT_JAR, '1.20.2', '1.21.11', '0.19.10'),
    ]);
    const up = await planSkins(catalog({ table: () => Promise.resolve(newer) }), vanilla);
    expect(up.plan?.runtime.loaderVersion).toBe('0.19.10');
    const older = withClient(tableOf([entryOf(modOf(JAR))]), [
      clientLineOf(CLIENT_JAR, '1.20.2', '1.21.11', '0.15.0'),
    ]);
    const down = await planSkins(catalog({ table: () => Promise.resolve(older) }), vanilla);
    expect(down.plan?.runtime.loaderVersion).toBe('0.19.5');
  });
});

describe('placeSkinFiles', () => {
  it('settings that cannot be written leave the client mod alone in its folder', async () => {
    const instance = join(root, 'instances', 'server-7');
    await mkdir(join(root, 'instances'), { recursive: true });
    await writeFile(instance, 'a file where the instance folder should be');
    const line = clientLineOf(CLIENT_JAR);
    const request = requestFor(withClient(tableOf([entryOf(modOf(JAR))]), [line]));
    const planned = await planSkins(request, { minecraft: '1.21.1', loader: 'vanilla' });
    if (planned.plan === null) {
      throw new Error('no plan');
    }
    const fetch = serving({ [FIRST]: JAR, [CLIENT_URL]: CLIENT_JAR });
    const placed = await placeSkinFiles({
      layout,
      instance,
      plan: planned.plan,
      fetch,
      signal,
      log,
    });
    expect(placed?.modsDir).toBe(dirOf(line.mod));
    expect([...(placed?.roles ?? [])]).toEqual(['client']);
    expect(await readdir(placed?.modsDir ?? '')).toEqual(['MCMonitor-0.1.0.jar']);
    expect(fetch.calls).toEqual([FIRST, CLIENT_URL]);
  });

  it('sources dropped into ExtraList are removed before the mod can read them', async () => {
    const instance = join(root, 'instances', 'server-7');
    await mkdir(extraListDir(instance), { recursive: true });
    await writeFile(
      join(extraListDir(instance), 'evil.json'),
      JSON.stringify({ name: 'Evil', type: 'ElyByAPI', root: 'https://evil.example/' }),
    );
    const planned = await planSkins(requestFor(tableOf([entryOf(modOf(JAR))])), {
      minecraft: '1.21.1',
      loader: 'vanilla',
    });
    if (planned.plan === null) {
      throw new Error('no plan');
    }
    await placeSkinFiles({
      layout,
      instance,
      plan: planned.plan,
      fetch: serving({ [FIRST]: JAR }),
      signal,
      log,
    });
    expect(await readdir(join(instance, 'CustomSkinLoader'))).toEqual(['CustomSkinLoader.json']);
  });

  it('without the mod there is no settings file either', async () => {
    const instance = join(root, 'instances', 'server-7');
    const planned = await planSkins(requestFor(tableOf([entryOf(modOf(JAR))])), {
      minecraft: '1.21.1',
      loader: 'vanilla',
    });
    if (planned.plan === null) {
      throw new Error('no plan');
    }
    const modsDir = await placeSkinFiles({
      layout,
      instance,
      plan: planned.plan,
      fetch: serving({}),
      signal,
      log,
    });
    expect(modsDir).toBeNull();
    expect(await readdir(instance).catch(() => [])).toEqual([]);
  });
});

describe('canPlayWithoutSkins', () => {
  it('a failed loader is survivable, a full disk and a cancel are not', () => {
    expect(canPlayWithoutSkins(new Error('boom'), signal)).toBe(true);
    expect(canPlayWithoutSkins(Object.assign(new Error('x'), { code: 'ENOSPC' }), signal)).toBe(
      false,
    );
    const controller = new AbortController();
    controller.abort();
    expect(canPlayWithoutSkins(new Error('boom'), controller.signal)).toBe(false);
  });
});
