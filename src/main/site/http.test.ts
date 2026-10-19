import { describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryCache } from './cache';
import {
  debugSlowMs,
  maxAgeMs,
  retryAfterSeconds,
  SiteHttp,
  slowFetch,
  type Headers,
} from './http';

const BASE = 'https://mc-mon.ru/api/launcher/v1';
const INSTALL = '6f1c3b9e-1111-4222-8333-444455556666';

type Reply = Response | Error;

function json(body: unknown, status = 200, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

interface Built {
  http: SiteHttp;
  fetch: Mock<(url: string, init: RequestInit) => Promise<Response>>;
  cache: MemoryCache;
  sleep: Mock<() => Promise<void>>;
  advance: (ms: number) => void;
}

function setup(replies: Reply[], start = 1_000_000): Built {
  let now = start;
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => {
    const next = replies.shift();
    if (next === undefined) {
      return Promise.reject(new TypeError('no more replies'));
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const cache = new MemoryCache();
  const sleep = vi.fn(() => Promise.resolve());
  const http = new SiteHttp({
    base: BASE,
    fetch,
    headers: (): Promise<Headers> =>
      Promise.resolve({
        'User-Agent': 'MCMonitorLauncher/0.1.0 (Windows x64)',
        'X-Launcher-Install': INSTALL,
      }),
    cache,
    now: (): number => now,
    sleep,
    log: vi.fn(),
  });
  return {
    http,
    fetch,
    cache,
    sleep,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

const parse = (body: unknown): { n: number } | null =>
  typeof body === 'object' && body !== null && typeof (body as { n?: unknown }).n === 'number'
    ? { n: (body as { n: number }).n }
    : null;

const get = { parse, fallbackTtlMs: 5000 };

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return init?.headers as Record<string, string>;
}

describe('headers and cache', () => {
  it('sends User-Agent and X-Launcher-Install, without Authorization', async () => {
    const { http, fetch } = setup([json({ n: 1 }, 200, { 'Cache-Control': 'max-age=20, public' })]);
    await http.get('/meta', undefined, get);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/meta`);
    expect(headersOf(init)).toMatchObject({
      'User-Agent': 'MCMonitorLauncher/0.1.0 (Windows x64)',
      'X-Launcher-Install': INSTALL,
      Accept: 'application/json',
    });
    expect(headersOf(init)).not.toHaveProperty('Authorization');
    expect(init?.redirect).toBe('error');
  });

  it('fresh cache by max-age skips the network', async () => {
    const { http, fetch, advance } = setup([
      json({ n: 1 }, 200, { 'Cache-Control': 'max-age=20, public' }),
      json({ n: 2 }),
    ]);
    expect(await http.get('/servers', undefined, get)).toMatchObject({ value: { n: 1 } });
    advance(19_000);
    expect(await http.get('/servers', undefined, get)).toMatchObject({
      value: { n: 1 },
      stale: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(2000);
    expect(await http.get('/servers', undefined, get)).toMatchObject({ value: { n: 2 } });
  });

  it('ETag: If-None-Match and 304 extend the cache', async () => {
    const { http, fetch, advance } = setup([
      json({ n: 1 }, 200, { ETag: '"v1"', 'Cache-Control': 'max-age=1' }),
      new Response(null, { status: 304, headers: { 'Cache-Control': 'max-age=60' } }),
    ]);
    await http.get('/scenes', undefined, get);
    advance(2000);
    const second = await http.get('/scenes', undefined, get);
    expect(headersOf(fetch.mock.calls[1]?.[1])['If-None-Match']).toBe('"v1"');
    expect(second).toMatchObject({ ok: true, value: { n: 1 }, stale: false });
  });

  it('without network returns the last cache with stale: true', async () => {
    const { http, advance, sleep } = setup([
      json({ n: 1 }, 200, { 'Cache-Control': 'max-age=1' }),
      new TypeError('net::ERR_INTERNET_DISCONNECTED'),
      new TypeError('net::ERR_INTERNET_DISCONNECTED'),
      new TypeError('net::ERR_INTERNET_DISCONNECTED'),
    ]);
    const first = await http.get('/servers', undefined, get);
    advance(5000);
    const second = await http.get('/servers', undefined, get);
    expect(second).toEqual({
      ok: true,
      value: { n: 1 },
      stale: true,
      fetchedAt: first.ok ? first.fetchedAt : 0,
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('without network a cache older than 30 days is not returned', async () => {
    const offline = (): Error => new TypeError('net::ERR_INTERNET_DISCONNECTED');
    const { http, advance } = setup([
      json({ n: 1 }, 200, { 'Cache-Control': 'max-age=1' }),
      ...Array.from({ length: 6 }, offline),
    ]);
    await http.get('/servers', undefined, get);
    advance(30 * 24 * 3_600_000);
    expect(await http.get('/servers', undefined, get)).toMatchObject({ ok: true, stale: true });
    advance(1);
    expect(await http.get('/servers', undefined, get)).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
  });

  it('without network and without cache — offline error after retries', async () => {
    const { http, fetch } = setup([new TypeError('x'), new TypeError('x'), new TypeError('x')]);
    expect(await http.get('/servers', undefined, get)).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('timeout — timeout code', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError');
    const { http } = setup([timeout, timeout, timeout]);
    expect(await http.get('/servers', undefined, get)).toEqual({
      ok: false,
      error: { code: 'timeout' },
    });
  });

  it('a malformed response does not get cached', async () => {
    const { http, cache } = setup([json({ wrong: true })]);
    expect(await http.get('/meta', undefined, get)).toMatchObject({
      ok: false,
      error: { code: 'invalid-response' },
    });
    expect(cache.entries.size).toBe(0);
  });
});

describe('site errors', () => {
  it('404 and 422 with {error} body — no retries', async () => {
    const { http, fetch } = setup([
      json({ error: { code: 'server_not_found', message: 'нет' } }, 404),
      json({ error: { code: 'invalid_request', message: 'per page' } }, 422),
    ]);
    expect(await http.get('/servers/9', undefined, get)).toEqual({
      ok: false,
      error: { code: 'not-found', status: 404, siteCode: 'server_not_found' },
    });
    expect(await http.get('/servers', new URLSearchParams({ per_page: '100' }), get)).toEqual({
      ok: false,
      error: { code: 'invalid-request', status: 422, siteCode: 'invalid_request' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('413 body too large — invalid-request without retries', async () => {
    const { http, fetch } = setup([
      json({ error: { code: 'payload_too_large', message: '' } }, 413),
    ]);
    expect(await http.get('/telemetry', undefined, get)).toEqual({
      ok: false,
      error: { code: 'invalid-request', status: 413, siteCode: 'payload_too_large' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('409 conflict (server_offline on vote) — invalid-request with site code, no retries', async () => {
    const { http, fetch } = setup([json({ error: { code: 'server_offline', message: '' } }, 409)]);
    expect(await http.get('/servers/9/votes', undefined, get)).toEqual({
      ok: false,
      error: { code: 'invalid-request', status: 409, siteCode: 'server_offline' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('500 retries, then succeeds', async () => {
    const { http, fetch } = setup([json({}, 502), json({ n: 7 })]);
    expect(await http.get('/meta', undefined, get)).toMatchObject({ ok: true, value: { n: 7 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('429 with Retry-After: error with a pause and silence until it ends', async () => {
    const { http, fetch, advance } = setup([
      json({ error: { code: 'too_many_requests', message: '' } }, 429, { 'Retry-After': '30' }),
      json({ n: 1 }),
    ]);
    expect(await http.get('/servers', undefined, get)).toEqual({
      ok: false,
      error: { code: 'rate-limited', status: 429, retryAfterS: 30, siteCode: 'too_many_requests' },
    });
    advance(10_000);
    expect(await http.get('/servers', undefined, get)).toEqual({
      ok: false,
      error: { code: 'rate-limited', retryAfterS: 20 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(21_000);
    expect(await http.get('/servers', undefined, get)).toMatchObject({ ok: true });
  });

  it('POST does not retry itself', async () => {
    const { http, fetch } = setup([new TypeError('x'), json({ ok: true })]);
    expect(await http.post('/telemetry', { a: 1 })).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await http.post('/telemetry', { a: 1 })).toEqual({ ok: true });
    expect(headersOf(fetch.mock.calls[1]?.[1])['Content-Type']).toBe('application/json');
  });
});

describe('download', () => {
  const PNG = 'https://mc-mon.ru/storage/scenes/pulse/day/0.png';

  function png(size: number): Response {
    return new Response(new Uint8Array(size));
  }

  it('image within the limit, request with Accept: image/png', async () => {
    const { http, fetch } = setup([png(10)]);
    const result = await http.download(PNG, 10);
    expect(result.ok && result.bytes.byteLength).toBe(10);
    expect(headersOf(fetch.mock.calls[0]?.[1])).toMatchObject({ Accept: 'image/png' });
  });
});

describe('response headers', () => {
  it('Cache-Control', () => {
    expect(maxAgeMs('max-age=20, public')).toBe(20_000);
    expect(maxAgeMs('no-cache, private')).toBe(0);
    expect(maxAgeMs('public')).toBeNull();
    expect(maxAgeMs(null)).toBeNull();
  });

  it('Retry-After as seconds, as a date, and as garbage', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(retryAfterSeconds('120', now)).toBe(120);
    expect(retryAfterSeconds('Sat, 03 Oct 2026 12:01:00 GMT', now)).toBe(60);
    expect(retryAfterSeconds('потом', now)).toBe(60);
    expect(retryAfterSeconds('999999', now)).toBe(3600);
    expect(retryAfterSeconds(null, now)).toBe(60);
  });
});

describe('debug response delay', () => {
  it('is taken from the environment only in an unpackaged app', () => {
    const env = { MCMONITOR_DEBUG_SLOW_MS: '4000' };
    expect(debugSlowMs(false, env)).toBe(4000);
    expect(debugSlowMs(true, env)).toBe(0);
    expect(debugSlowMs(false, {})).toBe(0);
    expect(debugSlowMs(false, { MCMONITOR_DEBUG_SLOW_MS: 'abc' })).toBe(0);
    expect(debugSlowMs(false, { MCMONITOR_DEBUG_SLOW_MS: '-5' })).toBe(0);
  });

  it('delays every response by the given time', async () => {
    const fetch = vi.fn(() => Promise.resolve(json({ n: 1 })));
    const sleep = vi.fn(() => Promise.resolve());
    const slow = slowFetch(fetch, 4000, sleep);
    const response = await slow(`${BASE}/meta`, { method: 'GET' });
    expect(await response.json()).toEqual({ n: 1 });
    expect(sleep).toHaveBeenCalledWith(4000);
  });
});

describe('SiteHttp: one request for the same address', () => {
  it('simultaneous reads share a single request', async () => {
    const { http, fetch } = setup([json({ n: 1 })]);
    const answers = await Promise.all([
      http.get('/servers', undefined, get),
      http.get('/servers', undefined, get),
      http.get('/servers', undefined, get),
    ]);
    expect(answers.map((answer) => answer.ok && answer.value.n)).toEqual([1, 1, 1]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('after a 429 nothing is asked before Retry-After and the kept answer is given', async () => {
    const { http, fetch, advance } = setup([
      json({ n: 1 }),
      json({ error: { code: 'rate_limited' } }, 429, { 'Retry-After': '30' }),
      json({ n: 2 }),
    ]);
    await http.get('/servers', undefined, get);
    advance(6000);
    expect(await http.get('/servers', undefined, get)).toMatchObject({ ok: true, stale: true });
    advance(20_000);
    expect(await http.get('/servers', undefined, get)).toMatchObject({
      ok: true,
      value: { n: 1 },
      stale: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    advance(11_000);
    expect(await http.get('/servers', undefined, get)).toMatchObject({ value: { n: 2 } });
  });

  it('the kept reader answers from the cache alone, marks an expired answer and never asks', async () => {
    const { http, fetch, advance } = setup([json({ n: 1 })]);
    const kept = http.kept();
    expect(await kept.get('/servers', undefined, get)).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    await http.get('/servers', undefined, get);
    expect(await kept.get('/servers', undefined, get)).toMatchObject({ ok: true, stale: false });
    advance(3_600_000);
    expect(await kept.get('/servers', undefined, get)).toMatchObject({
      ok: true,
      value: { n: 1 },
      stale: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('requests with a token are not shared: each read gets its own answer', async () => {
    let now = 0;
    const fetch = vi.fn(() => Promise.resolve(json({ n: (now += 1) })));
    const http = new SiteHttp({
      base: BASE,
      fetch,
      headers: (): Promise<Headers> => Promise.resolve({}),
      cache: new MemoryCache(),
      now: (): number => 1_000_000,
      sleep: (): Promise<void> => Promise.resolve(),
      log: vi.fn(),
      auth: { token: (): string => 'token', reject: vi.fn() },
    });
    const personal = { ...get, auth: 'optional' as const };
    const answers = await Promise.all([
      http.get('/servers/7', undefined, personal),
      http.get('/servers/7', undefined, personal),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(answers.map((answer) => answer.ok && answer.value.n)).toEqual([1, 2]);
  });
});
