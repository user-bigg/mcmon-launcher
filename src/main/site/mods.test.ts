import { describe, expect, it, vi } from 'vitest';
import { planMods, type CatalogMod, type ModCatalog } from '@shared/mods';
import { MemoryCache } from './cache';
import { SiteClient } from './client';
import { SiteHttp, type Headers } from './http';
import { PAYLOAD } from './fixtures/hostile';
import modsBody from './fixtures/mods.json';
import { parseModCatalog } from './mods';

const BASE = 'https://mc-mon.ru/api/launcher/v1';
const MINUTE = 60_000;
const apiHosts = new Set(['mc-mon.ru']);

type Raw = Record<string, unknown>;

function fixture(): Raw {
  return structuredClone(modsBody);
}

function rawMods(body: Raw): Raw[] {
  return body.mods as Raw[];
}

function rawMod(body: Raw, slug: string): Raw {
  const found = rawMods(body).find((item) => item.slug === slug);
  if (found === undefined) {
    throw new Error(`no ${slug} in the fixture`);
  }
  return found;
}

function firstFile(body: Raw, slug: string): Raw {
  const [first] = rawMod(body, slug).files as Raw[];
  if (first === undefined) {
    throw new Error(`no file of ${slug}`);
  }
  return first;
}

function parse(value: unknown, log = vi.fn()): ModCatalog | null {
  return parseModCatalog(value, { apiHosts, log });
}

function parsed(body: Raw): ModCatalog {
  const catalog = parse(body);
  if (catalog === null) {
    throw new Error('catalog rejected');
  }
  return catalog;
}

function slugs(body: Raw): string[] {
  return parsed(body).mods.map((mod) => mod.slug);
}

function mod(body: Raw, slug: string): CatalogMod | undefined {
  return parsed(body).mods.find((item) => item.slug === slug);
}

function planState(catalog: ModCatalog, minecraft: string, slug: string): string | undefined {
  const plan = planMods({
    catalog,
    minecraft,
    place: 'server',
    server: { required: [], optional: [], forbidden: ['xaeros-minimap'] },
    enabled: [slug],
    shaders: 'off',
    optionalOff: [],
  });
  return plan?.entries.find((entry) => entry.slug === slug)?.state;
}

function changed(slug: string, change: Raw): Raw {
  const body = fixture();
  Object.assign(rawMod(body, slug), change);
  return body;
}

function withFile(slug: string, change: Raw): Raw {
  const body = fixture();
  Object.assign(firstFile(body, slug), change);
  return body;
}

const ALL = [
  'fabric-api',
  'reeses-sodium-options',
  'sodium',
  'iris',
  'xaeros-minimap',
  'simple-voice-chat',
  'emotecraft',
  'makeup-ultra-fast',
  'complementary-reimagined',
];

describe('parseModCatalog', () => {
  it('reads the catalog of the site with every field', () => {
    const catalog = parsed(fixture());
    expect(catalog.updated_at).toBe('2026-10-18T09:00:00Z');
    expect(catalog.mods.map((item) => item.slug)).toEqual(ALL);
    expect(catalog.shaders).toEqual({
      light: 'makeup-ultra-fast',
      beautiful: 'complementary-reimagined',
    });
    expect(catalog.mods.find((item) => item.slug === 'sodium')).toMatchObject({
      kind: 'mod',
      title: "Sodium и Reese's Sodium Options",
      short: 'Sodium',
      group: 'optimization',
      player: true,
      server: false,
      often_forbidden: false,
      requires: ['reeses-sodium-options'],
      modrinth_id: 'AANobbMI',
      source_url: 'https://github.com/CaffeineMC/sodium',
      credit: null,
      options: null,
    });
    const emotes = catalog.mods.find((item) => item.slug === 'emotecraft');
    expect(emotes?.files[0]).toMatchObject({
      minecraft: '1.21.11',
      loader: 'fabric',
      loader_min: '0.19.1',
      version: 'for1.21.11-2.5.4',
      channel: 'beta',
      size: 4300000,
      requires: ['fabric-api'],
    });
    const pack = catalog.mods.find((item) => item.slug === 'complementary-reimagined');
    expect(pack).toMatchObject({
      kind: 'shader_pack',
      credit: 'Complementary Reimagined от Complementary Development',
      options: { profile: 'HIGH', shadowDistance: '2.5' },
    });
    expect(pack?.files[0]).toMatchObject({ loader: null, loader_min: null });
    expect(pack?.files[0]?.urls).toHaveLength(1);
  });

  it('ignores unknown fields at every level', () => {
    const body = fixture();
    body.future = { a: 1 };
    Object.assign(rawMod(body, 'sodium'), { rating: 5 });
    Object.assign(firstFile(body, 'sodium'), { sha512: 'x' });
    const sodium = mod(body, 'sodium');
    expect(sodium).toBeDefined();
    expect(sodium).not.toHaveProperty('rating');
    expect(sodium?.files[0]).not.toHaveProperty('sha512');
  });

  it('refuses an answer that is not a catalog', () => {
    for (const value of [null, [], 'mods', { mods: {} }, { mods: 'x' }, { updated_at: 'x' }]) {
      expect(parse(value)).toBeNull();
    }
    expect(parse({ mods: [] })).toEqual({ updated_at: null, mods: [], shaders: null });
  });

  it.each([
    ['slug', 5],
    ['kind', 'resource_pack'],
    ['title', ''],
    ['title', 42],
    ['short', ' \u0007 '],
    ['summary', null],
    ['group', 'cheats'],
    ['player', 'yes'],
    ['server', 1],
    ['often_forbidden', undefined],
    ['requires', undefined],
    ['requires', 'reeses-sodium-options'],
    ['modrinth_id', 'AANobbM'],
    ['modrinth_id', 'AANobbMI9'],
    ['modrinth_id', '../../xx'],
    ['license', undefined],
    ['files', undefined],
    ['files', {}],
    ['source_url', 'http://github.com/CaffeineMC/sodium'],
    ['source_url', 'javascript:alert(1)'],
    ['credit', 7],
  ])('skips a mod whose %s is %j; what needs it stays, without a file', (field, value) => {
    const body = fixture();
    const target = rawMod(body, 'sodium');
    if (value === undefined) {
      Reflect.deleteProperty(target, field);
    } else {
      target[field] = value;
    }
    const catalog = parsed(body);
    expect(catalog.mods.map((item) => item.slug)).toEqual(ALL.filter((slug) => slug !== 'sodium'));
    expect(planState(catalog, '1.21.11', 'iris')).toBe('no_file');
  });

  it.each([
    'Sodium',
    'so dium',
    '../sodium',
    'sodium/../../x',
    'sodium.jar',
    'a'.repeat(65),
    '',
    'con\u0000',
    'sodium\u202e',
    'con',
    'nul',
    'lpt1',
  ])('skips a mod with the slug %j', (slug) => {
    const body = fixture();
    rawMods(body).push({ ...rawMod(body, 'xaeros-minimap'), slug });
    expect(slugs(body)).toEqual(ALL);
  });

  it('keeps a mod without the optional fields and treats null as absent', () => {
    const body = changed('xaeros-minimap', { source_url: null, credit: null });
    expect(mod(body, 'xaeros-minimap')).toMatchObject({ source_url: null, credit: null });
  });

  it('control characters leave the texts and markup stays plain text', () => {
    expect(
      mod(
        changed('xaeros-minimap', { title: 'Карта\u0007', credit: 'от \u202eавтора' }),
        'xaeros-minimap',
      ),
    ).toMatchObject({ title: 'Карта', credit: 'от автора' });
    expect(
      mod(changed('xaeros-minimap', { title: PAYLOAD.slice(0, 100) }), 'xaeros-minimap'),
    ).toMatchObject({ title: PAYLOAD.slice(0, 100) });
  });

  it('a text longer than the launcher shows is cut at a word, the mod stays', () => {
    const words = (count: number): string => Array.from({ length: count }, () => 'слово').join(' ');
    const long = mod(
      changed('xaeros-minimap', {
        title: words(40),
        short: words(10),
        summary: words(60),
        credit: words(40),
      }),
      'xaeros-minimap',
    );
    expect(long?.short).toBe(`${words(6)}…`);
    expect(Array.from(long?.title ?? '').length).toBeLessThanOrEqual(120);
    expect(long?.title.endsWith('слово…')).toBe(true);
    expect(Array.from(long?.summary ?? '').length).toBeLessThanOrEqual(240);
    expect(Array.from(long?.credit ?? '').length).toBeLessThanOrEqual(160);
  });

  it('an empty credit is no credit', () => {
    expect(mod(changed('xaeros-minimap', { credit: '' }), 'xaeros-minimap')?.credit).toBeNull();
  });

  it('a mod that needs itself, a bad slug or a circle is not available', () => {
    expect(slugs(changed('xaeros-minimap', { requires: ['xaeros-minimap'] }))).not.toContain(
      'xaeros-minimap',
    );
    expect(slugs(changed('xaeros-minimap', { requires: ['Bad Slug'] }))).not.toContain(
      'xaeros-minimap',
    );
    const circle = changed('reeses-sodium-options', { requires: ['iris'] });
    expect(slugs(circle)).toEqual(
      ALL.filter((slug) => !['reeses-sodium-options', 'sodium', 'iris'].includes(slug)),
    );
  });

  it('a dependency missing from the catalog leaves the mod without a file only where a row needs it', () => {
    const body = changed('sodium', { requires: ['reeses-sodium-options', 'unknown-lib'] });
    Object.assign(firstFile(body, 'sodium'), { requires: ['unknown-lib'] });
    const catalog = parsed(body);
    expect(catalog.mods.map((item) => item.slug)).toEqual(ALL);
    expect(planState(catalog, '26.2', 'sodium')).toBe('on');
    expect(planState(catalog, '1.21.11', 'sodium')).toBe('no_file');
  });

  it('two mods with one slug are both left out', () => {
    const body = fixture();
    rawMods(body).push({ ...rawMod(body, 'xaeros-minimap'), title: 'Подмена' });
    expect(slugs(body)).not.toContain('xaeros-minimap');
  });

  it('keeps no more than 256 mods', () => {
    const body = fixture();
    const extra = Array.from({ length: 300 }, (_, index) => ({
      ...rawMod(body, 'xaeros-minimap'),
      slug: `extra-${String(index)}`,
    }));
    body.mods = [...extra, ...rawMods(body)];
    expect(slugs(body)).toHaveLength(256);
  });
});

describe('parseModCatalog files', () => {
  it.each([
    ['minecraft', '1.21.11-pre1'],
    ['minecraft', '25w41a'],
    ['loader', null],
    ['loader', 'forge'],
    ['loader_min', '0.17'],
    ['loader_min', 'latest'],
    ['loader_min', undefined],
    ['version', '../../evil'],
    ['version', 'a b'],
    ['version', ''],
    ['channel', 'alpha'],
    ['sha256', 'A'.repeat(64)],
    ['sha256', 'a'.repeat(63)],
    ['size', 0],
    ['size', 100 * 1024 * 1024 + 1],
    ['size', 1.5],
    ['size', '1024'],
    ['urls', 'https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar'],
    ['requires', undefined],
    ['requires', null],
    ['requires', 'reeses-sodium-options'],
    ['requires', ['iris']],
    ['requires', ['reeses-sodium-options', 'fabric-api']],
    ['requires', [5]],
  ])('drops a mod row whose %s is %j', (field, value) => {
    const body = withFile('sodium', { [field]: value });
    if (value === undefined) {
      Reflect.deleteProperty(firstFile(body, 'sodium'), field);
    }
    const files = mod(body, 'sodium')?.files ?? [];
    expect(files.map((file) => file.minecraft)).toEqual(['26.2']);
  });

  it('a row keeps its own dependencies, each one once, out of those of the mod', () => {
    const body = changed('sodium', { requires: ['reeses-sodium-options', 'fabric-api'] });
    const [first, second] = rawMod(body, 'sodium').files as Raw[];
    Object.assign(first ?? {}, { requires: ['fabric-api', 'fabric-api'] });
    Object.assign(second ?? {}, { requires: [] });
    const sodium = mod(body, 'sodium');
    expect(sodium?.requires).toEqual(['reeses-sodium-options', 'fabric-api']);
    expect(sodium?.files.map((file) => [file.minecraft, file.requires])).toEqual([
      ['1.21.11', ['fabric-api']],
      ['26.2', []],
    ]);
  });

  it('a shader pack row without every dependency of the pack is dropped', () => {
    const body = withFile('makeup-ultra-fast', { requires: [] });
    expect(mod(body, 'makeup-ultra-fast')?.files).toEqual([]);
  });

  it('keeps a size of exactly 100 MB', () => {
    const body = withFile('sodium', { size: 100 * 1024 * 1024 });
    expect(mod(body, 'sodium')?.files[0]?.size).toBe(100 * 1024 * 1024);
  });

  it('a shader pack row has no loader and no loader_min, a mod row has both', () => {
    const withLoader = withFile('makeup-ultra-fast', { loader: 'fabric' });
    expect(mod(withLoader, 'makeup-ultra-fast')?.files).toEqual([]);
    const withMin = withFile('makeup-ultra-fast', { loader_min: '0.16.0' });
    expect(mod(withMin, 'makeup-ultra-fast')?.files).toEqual([]);
    const nullMin = withFile('makeup-ultra-fast', { loader_min: null });
    expect(mod(nullMin, 'makeup-ultra-fast')?.files).toEqual([]);
  });

  it('a jar address for a shader pack and a zip address for a mod are not file addresses', () => {
    const pack = withFile('makeup-ultra-fast', {
      urls: ['https://cdn.modrinth.com/data/izsIPI7a/versions/x/pack.jar'],
    });
    expect(mod(pack, 'makeup-ultra-fast')?.files[0]?.urls).toEqual([]);
    const jar = withFile('sodium', {
      urls: ['https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.zip'],
    });
    expect(mod(jar, 'sodium')?.files[0]?.urls).toEqual([]);
  });

  it('two rows for one game version are both dropped, the other versions stay', () => {
    const body = fixture();
    const files = rawMod(body, 'sodium').files as Raw[];
    files.push({ ...firstFile(body, 'sodium'), version: 'mc1.21.11-0.8.1-fabric' });
    expect(mod(body, 'sodium')?.files.map((file) => file.minecraft)).toEqual(['26.2']);
  });

  it('a broken twin row still takes the good one down with it', () => {
    const body = fixture();
    const files = rawMod(body, 'sodium').files as Raw[];
    files.push({ minecraft: '1.21.11', loader: 'quilt' });
    expect(mod(body, 'sodium')?.files.map((file) => file.minecraft)).toEqual(['26.2']);
  });
});

describe('parseModCatalog addresses', () => {
  const MODRINTH = 'https://cdn.modrinth.com/data/AANobbMI/versions/abcdefgh/sodium.jar';
  const SHA = String(firstFile(fixture(), 'sodium').sha256);
  const MIRROR = `https://mc-mon.ru/storage/mods/${SHA}.jar`;

  function urlsOf(urls: unknown[]): string[] | undefined {
    return mod(withFile('sodium', { urls }), 'sodium')?.files[0]?.urls;
  }

  it('keeps the CDN path of this very mod and the copy on the API host', () => {
    expect(urlsOf([MODRINTH, MIRROR])).toEqual([MODRINTH, MIRROR]);
  });

  it.each([
    ['another project on Modrinth', 'https://cdn.modrinth.com/data/YL57xq9U/versions/x/iris.jar'],
    ['the project id in another case', 'https://cdn.modrinth.com/data/aanobbmi/versions/x/s.jar'],
    [
      'a path out of the project',
      'https://cdn.modrinth.com/data/AANobbMI/versions/../../YL57xq9U/x.jar',
    ],
    [
      'an encoded path out of the project',
      'https://cdn.modrinth.com/data/AANobbMI/versions/%2e%2e/%2e%2e/x/y.jar',
    ],
    ['a Modrinth page', 'https://modrinth.com/data/AANobbMI/versions/x/sodium.jar'],
    ['plain http', MODRINTH.replace('https:', 'http:')],
    ['credentials', 'https://user:pass@cdn.modrinth.com/data/AANobbMI/versions/x/s.jar'],
    ['a query', `${MODRINTH}?download=1`],
    ['a fragment', `${MODRINTH}#x`],
    ['a foreign host', 'https://evil.example/storage/mods/sodium.jar'],
    ['a look-alike host', 'https://mc-mon.ru.evil.example/storage/mods/sodium.jar'],
    ['the API host on another port', 'https://mc-mon.ru:8443/storage/mods/sodium.jar'],
    ['a file scheme', 'file:///C:/Windows/System32/sodium.jar'],
    ['javascript', 'javascript:alert(1)//.jar'],
    ['not a string', 42],
    ['a host by IP', 'https://127.0.0.1/storage/mods/sodium.jar'],
    ['another file on the API host', 'https://mc-mon.ru/storage/uploads/sodium.jar'],
    ['the copy of another hash', `https://mc-mon.ru/storage/mods/${'b'.repeat(64)}.jar`],
    ['the copy in another folder', `https://mc-mon.ru/storage/mods/x/${SHA}.jar`],
    ['the copy in upper case', `https://mc-mon.ru/storage/mods/${SHA.toUpperCase()}.jar`],
  ])('drops %s', (_name, url) => {
    expect(urlsOf([url, MIRROR])).toEqual([MIRROR]);
  });

  it('keeps each address once and at most eight of them', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      MODRINTH.replace('.jar', `-${String(index)}.jar`),
    );
    expect(urlsOf([MIRROR, MIRROR, ...many])).toHaveLength(8);
    expect(urlsOf([MIRROR, MIRROR])).toEqual([MIRROR]);
  });
});

describe('parseModCatalog options and shaders', () => {
  it.each([
    ['not an object', 'profile=low'],
    ['a list', [['profile', 'low']]],
    ['an empty object', {}],
    ['a key with a path', { '../profile': 'low' }],
    ['a value with a newline', { profile: 'low\nshaderPack=evil.zip' }],
    ['a value with an equals sign', { profile: 'a=b' }],
    ['a long value', { profile: 'a'.repeat(65) }],
    ['a number', { profile: 1 }],
    ['33 keys', Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${String(i)}`, 'v']))],
  ])('a shader pack with options as %s comes without a profile', (_name, options) => {
    const pack = mod(changed('makeup-ultra-fast', { options }), 'makeup-ultra-fast');
    expect(pack?.options).toBeNull();
    expect(pack?.files).toHaveLength(1);
  });

  it('options on a mod are ignored', () => {
    expect(mod(changed('sodium', { options: { profile: 'low' } }), 'sodium')?.options).toBeNull();
  });

  it('no shaders key or a shaders slug that is not a shader pack gives no switch', () => {
    const body = fixture();
    delete body.shaders;
    expect(parsed(body).shaders).toBeNull();
    const notPack = fixture();
    notPack.shaders = { light: 'sodium', beautiful: 'complementary-reimagined' };
    expect(parsed(notPack).shaders).toBeNull();
    const unknown = fixture();
    unknown.shaders = { light: 'makeup-ultra-fast', beautiful: 'bsl' };
    expect(parsed(unknown).shaders).toBeNull();
    const halfBroken = changed('makeup-ultra-fast', { kind: 'pack' });
    expect(parsed(halfBroken).shaders).toBeNull();
  });
});

function setup(route: (init: RequestInit) => Response): {
  client: SiteClient;
  fetch: ReturnType<typeof vi.fn>;
  tick: (ms: number) => void;
} {
  let now = 1_000_000;
  const fetch = vi.fn((_url: string, init: RequestInit): Promise<Response> =>
    Promise.resolve(route(init)),
  );
  const http = new SiteHttp({
    base: BASE,
    fetch,
    headers: (): Promise<Headers> => Promise.resolve({}),
    cache: new MemoryCache(),
    now: (): number => now,
    sleep: (): Promise<void> => Promise.resolve(),
    log: vi.fn(),
  });
  return {
    client: new SiteClient({
      http,
      log: vi.fn(),
      localIcon: (remote) => remote,
      skinHosts: apiHosts,
    }),
    fetch,
    tick: (ms): void => {
      now += ms;
    },
  };
}

const CACHED = { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60', ETag: '"m1"' };

function modsRoute(init: RequestInit): Response {
  const asked = (init.headers as Record<string, string>)['If-None-Match'];
  return asked === '"m1"'
    ? new Response(null, { status: 304, headers: CACHED })
    : new Response(JSON.stringify(modsBody), { status: 200, headers: CACHED });
}

describe('SiteClient.fetchMods', () => {
  it('asks /mods and keeps the catalog ten minutes whatever the site allows', async () => {
    const { client, fetch, tick } = setup(modsRoute);
    const first = await client.fetchMods();
    expect(first.ok && first.value.mods).toHaveLength(9);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${BASE}/mods`);
    tick(9 * MINUTE);
    await client.fetchMods();
    expect(fetch).toHaveBeenCalledTimes(1);
    tick(2 * MINUTE);
    const again = await client.fetchMods();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      'If-None-Match': '"m1"',
    });
    expect(again.ok && again.value.mods).toHaveLength(9);
  });

  it('an answer that is not a catalog is an invalid response', async () => {
    const { client } = setup(() => new Response(JSON.stringify({ mods: 'x' }), { status: 200 }));
    expect(await client.fetchMods()).toMatchObject({
      ok: false,
      error: { code: 'invalid-response' },
    });
  });
});
