import { describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryCache } from './cache';
import { SiteClient } from './client';
import { SiteHttp, type Headers } from './http';
import {
  lookError,
  parseCapeAnswer,
  parseCapePresets,
  parseSkinAnswer,
  parseSkinPresets,
  wornSkin,
} from './look';

const BASE = 'https://mc-mon.ru/api/launcher/v1';
const SKIN_URL = 'https://mc-mon.ru/storage/skins/8b4e12d7.png';
const CAPE_URL = 'https://mc-mon.ru/storage/capes/27756265.png';
const MINUTE = 60_000;

const local = (remote: string): string => `app://launcher/cache/${remote.split('/').pop() ?? ''}`;

function skin(change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'skeleton-tophat',
    title: 'Skeleton',
    url: SKIN_URL,
    model: 'classic',
    tags: ['Halloween'],
    released_at: '2026-10-13',
    is_new: true,
    ...change,
  };
}

function cape(change: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'cape-web', title: 'Web', url: CAPE_URL, tags: [], released_at: null, ...change };
}

describe('parseSkinPresets', () => {
  it('reads an item with a local texture address and keeps the order of the site', () => {
    const parsed = parseSkinPresets(
      { items: [skin(), skin({ id: 'plaid-shirt', model: 'slim', released_at: null })] },
      local,
    );
    expect(parsed).toEqual([
      {
        id: 'skeleton-tophat',
        title: 'Skeleton',
        url: 'app://launcher/cache/8b4e12d7.png',
        model: 'classic',
        tags: ['Halloween'],
        releasedAt: '2026-10-13',
        isNew: true,
      },
      {
        id: 'plaid-shirt',
        title: 'Skeleton',
        url: 'app://launcher/cache/8b4e12d7.png',
        model: 'slim',
        tags: ['Halloween'],
        releasedAt: null,
        isNew: true,
      },
    ]);
  });

  it('released_at is a calendar date or nothing', () => {
    const days = ['2026-10-13', null, '2026-10-13T09:00:00Z', '13.10.2026', '2026-02-31', 5];
    const parsed = parseSkinPresets(
      { items: days.map((day, index) => skin({ id: `s${String(index)}`, released_at: day })) },
      local,
    );
    expect(parsed?.map((item) => item.releasedAt)).toEqual([
      '2026-10-13',
      null,
      null,
      null,
      null,
      null,
    ]);
    const bare = { id: 'bare', title: 'Bare', url: SKIN_URL, model: 'slim' };
    expect(parseSkinPresets({ items: [bare] }, local)?.[0]).toMatchObject({
      tags: [],
      releasedAt: null,
      isNew: false,
    });
  });

  it('is_new is new only as a boolean true', () => {
    const marks = [true, false, 'true', 1, null];
    const parsed = parseSkinPresets(
      { items: marks.map((mark, index) => skin({ id: `s${String(index)}`, is_new: mark })) },
      local,
    );
    expect(parsed?.map((item) => item.isNew)).toEqual([true, false, false, false, false]);
  });

  it('skips items it cannot show and repeated ids', () => {
    const items = [
      skin({ id: 'Bad Id' }),
      skin({ id: 'no-title', title: ' ' }),
      skin({ id: 'plain-http', url: 'http://mc-mon.ru/a.png' }),
      skin({ id: 'odd-model', model: 'wide' }),
      'text',
      skin(),
      skin({ title: 'Twin' }),
    ];
    expect(parseSkinPresets({ items }, local)?.map((item) => item.title)).toEqual(['Skeleton']);
  });

  it('a texture on a host the launcher does not load is not offered', () => {
    expect(parseSkinPresets({ items: [skin()] }, () => null)).toEqual([]);
  });

  it('an empty list is a list, a body without items is not an answer', () => {
    expect(parseSkinPresets({ items: [] }, local)).toEqual([]);
    expect(parseSkinPresets({}, local)).toBeNull();
    expect(parseSkinPresets([skin()], local)).toBeNull();
  });

  it('keeps short clean tags without repeats', () => {
    const tags = ['A', 'A', ' B ', '', 7, 'x'.repeat(33), 'C', 'D', 'E', 'F'];
    expect(parseSkinPresets({ items: [skin({ tags })] }, local)?.[0]?.tags).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
  });
});

describe('parseCapePresets', () => {
  it('reads capes without a model', () => {
    expect(parseCapePresets({ items: [cape({ released_at: '2026-10-13' })] }, local)).toEqual([
      {
        id: 'cape-web',
        title: 'Web',
        url: 'app://launcher/cache/27756265.png',
        tags: [],
        releasedAt: '2026-10-13',
        isNew: false,
      },
    ]);
  });
});

describe('answers to a change', () => {
  it('a skin of /me has no id, an unknown model is the classic one', () => {
    expect(wornSkin({ url: SKIN_URL, model: 'slim' }, local)).toEqual({
      id: null,
      url: 'app://launcher/cache/8b4e12d7.png',
      model: 'slim',
    });
    expect(wornSkin({ url: SKIN_URL }, local)?.model).toBe('classic');
    expect(wornSkin({ model: 'slim' }, local)).toBeNull();
  });

  it('null means taken off, an unreadable answer means nothing', () => {
    expect(parseSkinAnswer({ skin: null }, local)).toEqual({ skin: null });
    expect(parseCapeAnswer({ cape: null }, local)).toEqual({ cape: null });
    expect(parseCapeAnswer({ cape: { id: 'cape-web', url: CAPE_URL } }, local)).toEqual({
      cape: { id: 'cape-web', url: 'app://launcher/cache/27756265.png' },
    });
    expect(parseSkinAnswer({}, local)).toBeNull();
    expect(parseSkinAnswer({ skin: { model: 'slim' } }, local)).toBeNull();
    expect(parseCapeAnswer({ cape: 'cape-web' }, local)).toBeNull();
    expect(parseCapeAnswer(null, local)).toBeNull();
  });
});

describe('lookError', () => {
  it('tells apart what the player can do about it', () => {
    expect(lookError({ code: 'offline' })).toEqual({ code: 'offline' });
    expect(lookError({ code: 'timeout' })).toEqual({ code: 'offline' });
    expect(lookError({ code: 'rate-limited', status: 429, retryAfterS: 60 })).toEqual({
      retryAfterS: 60,
      code: 'rate_limited',
    });
    expect(lookError({ code: 'unauthorized', status: 401, siteCode: 'unauthenticated' })).toEqual({
      code: 'not_signed_in',
    });
    expect(
      lookError({ code: 'invalid-request', status: 422, siteCode: 'invalid_skin', message: 'No' }),
    ).toEqual({ code: 'invalid_skin', message: 'No' });
    expect(lookError({ code: 'invalid-request', status: 422, siteCode: 'invalid_skin' })).toEqual({
      code: 'invalid_skin',
    });
    expect(lookError({ code: 'server-error', status: 500 })).toEqual({ code: 'failed' });
    expect(lookError({ code: 'unauthorized', status: 403 })).toEqual({ code: 'failed' });
  });
});

interface Setup {
  client: SiteClient;
  fetch: Mock<(url: string, init: RequestInit) => Promise<Response>>;
  tick: (ms: number) => void;
}

function json(body: unknown, status = 200, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function setup(route: (path: string, init: RequestInit) => Response): Setup {
  let now = Date.parse('2026-10-13T09:00:00Z');
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>((url, init) => {
    try {
      return Promise.resolve(route(url.slice(BASE.length), init));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('failed'));
    }
  });
  const http = new SiteHttp({
    base: BASE,
    fetch,
    headers: (): Promise<Headers> => Promise.resolve({}),
    cache: new MemoryCache(),
    now: (): number => now,
    sleep: (): Promise<void> => Promise.resolve(),
    log: vi.fn(),
    retryDelaysMs: [],
  });
  const client = new SiteClient({
    http,
    log: vi.fn(),
    localIcon: (remote): string | null => remote,
  });
  return {
    client,
    fetch,
    tick: (ms): void => {
      now += ms;
    },
  };
}

const CACHED: Headers = { 'Cache-Control': 'max-age=300, public', ETag: '"v1"' };

function presetsRoute(path: string, init: RequestInit): Response {
  const asked = (init.headers as Record<string, string>)['If-None-Match'];
  if (asked === '"v1"') {
    return new Response(null, { status: 304, headers: CACHED });
  }
  return path === '/skins/presets'
    ? json({ items: [skin()] }, 200, CACHED)
    : json({ items: [cape()] }, 200, CACHED);
}

describe('SiteClient.lookPresets', () => {
  it('asks for skins and capes and gives both lists', async () => {
    const { client, fetch } = setup(presetsRoute);
    const result = await client.lookPresets();
    expect(result).toMatchObject({ ok: true, stale: false });
    expect(result.ok && result.value.skins).toMatchObject([{ id: 'skeleton-tophat', isNew: true }]);
    expect(result.ok && result.value.capes.map((item) => item.id)).toEqual(['cape-web']);
    expect(fetch.mock.calls.map(([url]) => url.slice(BASE.length))).toEqual([
      '/skins/presets',
      '/capes/presets',
    ]);
  });

  it('keeps the lists for ten minutes whatever the site allows, then revalidates by ETag', async () => {
    const { client, fetch, tick } = setup(presetsRoute);
    await client.lookPresets();
    tick(9 * MINUTE);
    await client.lookPresets();
    expect(fetch).toHaveBeenCalledTimes(2);
    tick(2 * MINUTE);
    const again = await client.lookPresets();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(again.ok && again.value.skins).toHaveLength(1);
    expect(again.ok && again.stale).toBe(false);
    tick(MINUTE);
    await client.lookPresets();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('a site without capes still shows skins', async () => {
    const { client } = setup((path) =>
      path === '/skins/presets'
        ? json({ items: [skin()] })
        : json({ error: { code: 'not_found', message: '' } }, 404),
    );
    const result = await client.lookPresets();
    expect(result.ok && result.value).toMatchObject({ skins: [{ id: 'skeleton-tophat' }] });
    expect(result.ok && result.value.capes).toEqual([]);
  });

  it('no connection and no saved lists is an error to retry', async () => {
    const { client } = setup(() => {
      throw new TypeError('fetch failed');
    });
    expect(await client.lookPresets()).toEqual({ ok: false, error: { code: 'offline' } });
  });

  it('no connection after a load shows the saved lists as stale', async () => {
    let online = true;
    const { client, tick } = setup((path, init) => {
      if (!online) {
        throw new TypeError('fetch failed');
      }
      return presetsRoute(path, init);
    });
    await client.lookPresets();
    online = false;
    tick(10 * MINUTE);
    expect(await client.lookPresets()).toMatchObject({
      ok: true,
      stale: true,
      value: {
        skins: [{ id: 'skeleton-tophat', isNew: false }],
        capes: [{ id: 'cape-web', isNew: false }],
      },
    });
  });
});
