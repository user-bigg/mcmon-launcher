import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from './cache';
import { SiteClient } from './client';
import { SiteHttp, type Headers } from './http';
import { assetHosts } from './assets';
import clientModBody from './fixtures/client-mod.json';
import { parseSkinMod, serviceRoot } from './skin-mod';

const BASE = 'https://mc-mon.ru/api/launcher/v1';
const SHA = 'c8769a38b3cc1da2a7b2f5827d1a53a24cd1ef6d0784b1eb545569f5882a2ffb';
const MODRINTH =
  'https://cdn.modrinth.com/data/idMHQ4n2/versions/yyYvYfZI/CustomSkinLoader_Universal-15.1.jar';
const MIRROR = 'https://mc-mon.ru/files/skin-mod/CustomSkinLoader_Universal-15.1.jar';

const skinHosts = new Set(['mc-mon.ru']);

function entry(change: Record<string, unknown> = {}, mod: Record<string, unknown> = {}): unknown {
  return {
    minecraft: '1.21.1',
    loader: 'fabric',
    loader_version: '0.19.5',
    mod: { version: '15.1-Universal', urls: [MODRINTH, MIRROR], sha256: SHA, size: 222917, ...mod },
    ...change,
  };
}

function body(entries: unknown[], change: Record<string, unknown> = {}): unknown {
  return {
    updated_at: '2026-10-13T07:30:51Z',
    service_root: 'https://mc-mon.ru/skins/',
    source_url: 'https://github.com/xfl03/MCCustomSkinLoader',
    license_url: 'https://www.gnu.org/licenses/gpl-3.0.html',
    license: 'GPL-3.0-only',
    entries,
    ...change,
  };
}

function parse(value: unknown): ReturnType<typeof parseSkinMod> {
  return parseSkinMod(value, { skinHosts, log: vi.fn() });
}

function urlsOf(mod: Record<string, unknown>): string[] | undefined {
  return parse(body([entry({}, mod)]))?.entries[0]?.mod.urls;
}

describe('parseSkinMod', () => {
  it('reads the table of the site', () => {
    expect(parse(body([entry()]))).toEqual({
      updated_at: '2026-10-13T07:30:51Z',
      service_root: 'https://mc-mon.ru/skins/',
      source_url: 'https://github.com/xfl03/MCCustomSkinLoader',
      license_url: 'https://www.gnu.org/licenses/gpl-3.0.html',
      license: 'GPL-3.0-only',
      entries: [
        {
          minecraft: '1.21.1',
          loader: 'fabric',
          loader_version: '0.19.5',
          mod: { version: '15.1-Universal', urls: [MODRINTH, MIRROR], sha256: SHA, size: 222917 },
        },
      ],
      client_mod: null,
    });
  });

  it('ignores unknown fields and keeps an empty table', () => {
    const parsed = parse(body([entry({ future: 1 }, { sha512: 'x' })], { extra: { a: 1 } }));
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0]).not.toHaveProperty('future');
    expect(parse(body([]))?.entries).toEqual([]);
    expect(parse(body('nonsense' as unknown as unknown[]))?.entries).toEqual([]);
  });

  it('drops mod addresses on a foreign host, over http or with credentials', () => {
    expect(urlsOf({ urls: ['https://evil.example/mod.jar', MODRINTH] })).toEqual([MODRINTH]);
    expect(urlsOf({ urls: [MODRINTH.replace('https:', 'http:'), MIRROR] })).toEqual([MIRROR]);
    expect(urlsOf({ urls: ['https://user:pass@cdn.modrinth.com/a.jar', MIRROR] })).toEqual([
      MIRROR,
    ]);
    expect(urlsOf({ urls: ['https://cdn.modrinth.com.evil.example/a.jar', MIRROR] })).toEqual([
      MIRROR,
    ]);
    expect(urlsOf({ urls: ['https://cdn.modrinth.com/a.exe', MIRROR] })).toEqual([MIRROR]);
    expect(urlsOf({ urls: [`${MIRROR}?to=evil`, `${MIRROR}#x`, MODRINTH] })).toEqual([MODRINTH]);
    expect(urlsOf({ urls: ['https://cdn.modrinth.com:8443/data/idMHQ4n2/versions/a.jar'] })).toBe(
      undefined,
    );
    expect(urlsOf({ urls: ['https://cdn.modrinth.com./data/idMHQ4n2/versions/a.jar'] })).toBe(
      undefined,
    );
  });

  it('on Modrinth only files of the CustomSkinLoader project are taken', () => {
    expect(
      urlsOf({ urls: ['https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar', MIRROR] }),
    ).toEqual([MIRROR]);
    expect(urlsOf({ urls: ['https://cdn.modrinth.com/evil.jar'] })).toBeUndefined();
    expect(
      urlsOf({ urls: ['https://cdn.modrinth.com/data/idMHQ4n2/versions/../../x/evil.jar'] }),
    ).toBeUndefined();
  });

  it('takes a new mod file by the hash of the table, without a launcher release', () => {
    const next = 'a'.repeat(64);
    const url = 'https://cdn.modrinth.com/data/idMHQ4n2/versions/newer/CustomSkinLoader-16.0.jar';
    const mod = { version: '16.0-Universal', urls: [url], sha256: next, size: 230001 };
    expect(parse(body([entry({}, mod)]))?.entries[0]?.mod).toEqual(mod);
  });

  it('a new hash does not let a file in from a foreign host or another Modrinth project', () => {
    const next = 'a'.repeat(64);
    const foreign = ['https://evil.example/mod.jar', 'https://cdn.modrinth.com/data/x/v/a.jar'];
    expect(parse(body([entry({}, { sha256: next, urls: foreign })]))?.entries).toEqual([]);
  });

  it('skips an entry left without addresses', () => {
    expect(parse(body([entry({}, { urls: [] })]))?.entries).toEqual([]);
    expect(parse(body([entry({}, { urls: ['https://evil.example/mod.jar'] })]))?.entries).toEqual(
      [],
    );
    expect(parse(body([entry({}, { urls: 'https://cdn.modrinth.com/a.jar' })]))?.entries).toEqual(
      [],
    );
  });

  it('skips an entry with a bad hash, size, version or loader', () => {
    const bad = [
      entry({}, { sha256: 'abc' }),
      entry({}, { size: 0 }),
      entry({}, { size: 1e12 }),
      entry({}, { version: '../15.1' }),
      entry({ loader: 'forge' }),
      entry({ loader_version: '0.14.22' }),
      entry({ loader_version: '../0.19.5' }),
      entry({ minecraft: '../1.21.1' }),
      'text',
    ];
    expect(parse(body(bad))?.entries).toEqual([]);
  });

  it('keeps the first entry of a game version and lowers the hash', () => {
    const parsed = parse(
      body([entry({}, { sha256: SHA.toUpperCase() }), entry({ loader_version: '0.19.6' })]),
    );
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0]?.loader_version).toBe('0.19.5');
    expect(parsed?.entries[0]?.mod.sha256).toBe(SHA);
  });

  it('rejects the whole table when the skin service is not an https folder on the site', () => {
    for (const root of [
      'http://mc-mon.ru/skins/',
      'https://evil.example/skins/',
      'https://mc-mon.ru/skins',
      'https://mc-mon.ru/skins/?nick=',
      'https://user@mc-mon.ru/skins/',
      null,
    ]) {
      expect(parse(body([entry()], { service_root: root }))).toBeNull();
    }
    expect(serviceRoot('https://mc-mon.ru/skins/', skinHosts)).toBe('https://mc-mon.ru/skins/');
  });

  it('drops links that are not https and keeps the table', () => {
    const parsed = parse(body([entry()], { source_url: 'http://github.com/x', license: 7 }));
    expect(parsed?.source_url).toBeNull();
    expect(parsed?.license).toBeNull();
    expect(parsed?.entries).toHaveLength(1);
  });
});

let lastLog: string[] = [];

function lineOf(index: number, change: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...clientModBody.lines[index], ...change };
}

function clientMod(change: Record<string, unknown> = {}): ReturnType<typeof parse> {
  const log = vi.fn();
  const table = parseSkinMod(body([], { client_mod: { ...clientModBody, ...change } }), {
    skinHosts,
    log,
  });
  lastLog = log.mock.calls.map((call) => String(call[0]));
  return table;
}

function rangesOf(table: ReturnType<typeof parse>): string[] | undefined {
  return table?.client_mod?.lines.map(
    (line) => `${line.minecraft_from}–${line.minecraft_to ?? '∞'}`,
  );
}

describe('parseSkinMod: client_mod', () => {
  it('reads the lines of the staging site reply, with the mod version in each file', () => {
    const parsed = clientMod();
    expect(parsed?.client_mod?.version).toBe('0.1.0');
    expect(parsed?.client_mod?.license).toBe('GPL-3.0-only');
    expect(rangesOf(parsed)).toEqual(['1.14–1.20.1', '1.20.2–1.21.11', '26.1–∞']);
    expect(parsed?.client_mod?.lines[2]).toEqual({
      minecraft_from: '26.1',
      minecraft_to: null,
      loader_version: '0.19.5',
      mod: { ...clientModBody.lines[2]?.mod, version: '0.1.0' },
    });
  });

  it('keeps the https links of the licence and the source, a missing source is no link', () => {
    const links = {
      license_url: 'https://www.gnu.org/licenses/gpl-3.0.html',
      source_url: 'https://github.com/mc-monitor/client-mod',
    };
    expect(clientMod(links)?.client_mod).toMatchObject(links);
    const plain = clientMod({ license_url: 'http://www.gnu.org/licenses/gpl-3.0.html' });
    expect(plain?.client_mod?.license_url).toBeNull();
    expect(plain?.client_mod?.source_url).toBeNull();
  });

  it('no key, a broken key or a bad version means no client mod, the skins stay', () => {
    expect(parse(body([entry()]))?.client_mod).toBeNull();
    for (const value of ['text', { ...clientModBody, version: '../0.1' }, { lines: [] }]) {
      const parsed = parse(body([entry()], { client_mod: value }));
      expect(parsed?.client_mod).toBeNull();
      expect(parsed?.entries).toHaveLength(1);
    }
  });

  it('drops a bad line and keeps the others', () => {
    const bad = [
      lineOf(0, { minecraft_from: '1.14-pre1' }),
      lineOf(0, { minecraft_from: '23w14a' }),
      lineOf(0, { minecraft_to: '1.20.1-rc1' }),
      lineOf(0, { minecraft_to: undefined }),
      lineOf(0, { minecraft_from: '1.21', minecraft_to: '1.20.1' }),
      lineOf(0, { loader_version: '0.14.22' }),
      lineOf(0, { mod: { ...clientModBody.lines[0]?.mod, sha256: 'abc' } }),
      lineOf(0, { mod: { ...clientModBody.lines[0]?.mod, urls: ['https://evil.example/m.jar'] } }),
      lineOf(0, {
        mod: {
          ...clientModBody.lines[0]?.mod,
          urls: ['https://cdn.modrinth.com/data/idMHQ4n2/versions/x/m.jar'],
        },
      }),
    ];
    for (const line of bad) {
      expect(rangesOf(clientMod({ lines: [line, lineOf(1)] }))).toEqual(['1.20.2–1.21.11']);
    }
  });

  it('logs the lines past the limit as skipped', () => {
    const many = Array.from({ length: 17 }, (_, index) =>
      lineOf(0, { minecraft_from: `1.${String(index)}`, minecraft_to: `1.${String(index)}` }),
    );
    expect(clientMod({ lines: many })?.client_mod?.lines).toHaveLength(16);
    expect(lastLog).toContain('site: skipped skin-mod client_mod lines[16]');
  });

  it('drops both lines that cover one version and says so in the log', () => {
    const touching = lineOf(1, { minecraft_from: '1.20.1' });
    expect(rangesOf(clientMod({ lines: [lineOf(0), touching, lineOf(2)] }))).toEqual(['26.1–∞']);
    expect(lastLog.some((line) => line.includes('overlap'))).toBe(true);
    const open = lineOf(1, { minecraft_to: null });
    expect(rangesOf(clientMod({ lines: [lineOf(0), open, lineOf(2)] }))).toEqual(['1.14–1.20.1']);
  });
});

function client(replies: Response[]): { client: SiteClient; fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(() => {
    const next = replies.shift();
    return next === undefined
      ? Promise.reject(new TypeError('no more replies'))
      : Promise.resolve(next);
  });
  const http = new SiteHttp({
    base: BASE,
    fetch,
    headers: (): Promise<Headers> => Promise.resolve({}),
    cache: new MemoryCache(),
    now: (): number => 1_000_000,
    sleep: (): Promise<void> => Promise.resolve(),
    log: vi.fn(),
  });
  return {
    client: new SiteClient({
      http,
      log: vi.fn(),
      localIcon: (remote) => remote,
      skinHosts,
    }),
    fetch,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SiteClient.fetchSkinMod', () => {
  it('asks /skin-mod once and answers from the cache afterwards', async () => {
    const built = client([json(body([entry()]))]);
    const first = await built.client.fetchSkinMod();
    const second = await built.client.fetchSkinMod();
    expect(first.ok && first.value.entries).toHaveLength(1);
    expect(second.ok).toBe(true);
    expect(built.fetch).toHaveBeenCalledTimes(1);
    expect(built.fetch.mock.calls[0]?.[0]).toBe(`${BASE}/skin-mod`);
  });

  it('an old site without the route (404) gives no table', async () => {
    const built = client([json({ error: { code: 'not_found' } }, 404)]);
    const result = await built.client.fetchSkinMod();
    expect(result.ok).toBe(false);
  });

  it('a host named only in the links of /meta is not a host of the site for the table', () => {
    const hosts = assetHosts(BASE, []);
    expect([...hosts]).toEqual(['mc-mon.ru']);
    const rules = { skinHosts: hosts, log: vi.fn() };
    expect(
      parseSkinMod(body([entry()], { service_root: 'https://rules.example/skins/' }), rules),
    ).toBeNull();
    const table = parseSkinMod(
      body([entry({}, { urls: ['https://rules.example/files/mod.jar', MIRROR] })]),
      rules,
    );
    expect(table?.entries[0]?.mod.urls).toEqual([MIRROR]);
  });

  it('a mirror on the site host is allowed, on any other host it is not', async () => {
    const built = client([
      json(body([entry({}, { urls: ['https://files.example/mod.jar', MIRROR] })])),
    ]);
    const result = await built.client.fetchSkinMod();
    expect(result.ok && result.value.entries[0]?.mod.urls).toEqual([MIRROR]);
  });
});
