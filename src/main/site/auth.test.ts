import { describe, expect, it, vi, type Mock } from 'vitest';
import card from './fixtures/card.json';
import { MemoryCache } from './cache';
import { SiteClient } from './client';
import { SiteHttp, type Headers } from './http';

const BASE = 'https://mc-mon.ru/api/launcher/v1';
const TOKEN = '12|mcml_abcdefghijklmnopqrstuvwxyz0123456789ABCD';

function json(body: unknown, status = 200, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

interface Setup {
  http: SiteHttp;
  client: SiteClient;
  fetch: Mock<(url: string, init: RequestInit) => Promise<Response>>;
  reject: Mock<(rejected: string) => void>;
  cache: MemoryCache;
  signIn: (value: string) => void;
}

function setup(replies: Response[], token: string | null = TOKEN): Setup {
  let current = token;
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(replies.shift() ?? json({}, 500)),
  );
  const reject = vi.fn((rejected: string): void => {
    if (rejected === current) {
      current = null;
    }
  });
  const cache = new MemoryCache();
  const http = new SiteHttp({
    base: BASE,
    fetch,
    headers: (): Promise<Headers> => Promise.resolve({ 'X-Launcher-Install': 'install' }),
    cache,
    now: Date.now,
    sleep: (): Promise<void> => Promise.resolve(),
    log: vi.fn(),
    retryDelaysMs: [],
    auth: { token: (): string | null => current, reject },
  });
  const client = new SiteClient({
    http,
    log: vi.fn(),
    localIcon: (remote): string | null => remote,
  });
  const signIn = (value: string): void => {
    current = value;
  };
  return { http, client, fetch, reject, cache, signIn };
}

function authorization(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

const voted = { ...card, my_vote: { can_vote_at: '2026-10-04T09:00:00Z' } };

describe('token in requests', () => {
  it('card request with a token: sends Authorization, returns my_vote, caches without my_vote', async () => {
    const { client, fetch, cache } = setup([
      json(voted, 200, { 'Cache-Control': 'private, no-store' }),
    ]);
    const result = await client.server(card.id);
    expect(result).toMatchObject({ ok: true, value: { my_vote: voted.my_vote } });
    expect(authorization(fetch.mock.calls[0]?.[1])).toBe(`Bearer ${TOKEN}`);
    const stored = [...cache.entries.values()][0];
    expect(stored?.body).not.toHaveProperty('my_vote');
    expect(stored?.etag).toBeNull();
  });

  it('with a token, a fresh guest cache does not override the response carrying my_vote', async () => {
    const { client, fetch, signIn } = setup(
      [json(card, 200, { 'Cache-Control': 'public, max-age=20', ETag: '"v1"' }), json(voted)],
      null,
    );
    await client.server(card.id);
    signIn(TOKEN);
    const result = await client.server(card.id);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, value: { my_vote: voted.my_vote } });
    const headers = fetch.mock.calls[1]?.[1].headers as Record<string, string>;
    expect(headers['If-None-Match']).toBeUndefined();
  });

  it('a 401 on the card request forgets the token and retries as a guest without Authorization', async () => {
    const { client, fetch, reject } = setup([
      json({ error: { code: 'unauthenticated', message: '' } }, 401),
      json(card),
    ]);
    const result = await client.server(card.id);
    expect(result.ok).toBe(true);
    expect(reject).toHaveBeenCalledWith(TOKEN, 'unauthenticated');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(authorization(fetch.mock.calls[1]?.[1])).toBeUndefined();
    expect(result.ok && result.value.my_vote).toBeFalsy();
  });

  it('catalog, live, and scenes requests go without a token', async () => {
    const { client, fetch } = setup([
      json({
        data: [],
        top_slots: { diamond: [], gold: [] },
        meta: { page: 1, per_page: 1, total: 0 },
      }),
      json({ online: 1, max: 2, up: true, at: '2026-10-03T12:00:00Z' }),
      json([]),
    ]);
    await client.servers({});
    await client.live([3]);
    await client.scenes();
    for (const call of fetch.mock.calls) {
      expect(authorization(call[1])).toBeUndefined();
    }
  });

  it('telemetry with a token includes it on events, guest telemetry does not', async () => {
    const signedIn = setup([json({ accepted: 1 })], null);
    await signedIn.client.sendTelemetry({ install: 'x' } as never, TOKEN);
    expect(authorization(signedIn.fetch.mock.calls[0]?.[1])).toBe(`Bearer ${TOKEN}`);
    const guest = setup([json({ accepted: 1 })]);
    await guest.client.sendTelemetry({ install: 'x' } as never, null);
    expect(authorization(guest.fetch.mock.calls[0]?.[1])).toBeUndefined();
  });

  it('telemetry: a 401 with a token retries once as a guest, the token is not forgotten', async () => {
    const { client, fetch, reject } = setup([
      json({ error: { code: 'unauthenticated', message: '' } }, 401),
      json({ accepted: 1 }),
    ]);
    expect(await client.sendTelemetry({ install: 'x' } as never, TOKEN)).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(authorization(fetch.mock.calls[1]?.[1])).toBeUndefined();
    expect(reject).not.toHaveBeenCalled();
  });

  it('telemetry: a 401 as a guest too does not retry endlessly', async () => {
    const { client, fetch } = setup([
      json({ error: { code: 'unauthenticated', message: '' } }, 401),
      json({ error: { code: 'unauthenticated', message: '' } }, 401),
    ]);
    const sent = await client.sendTelemetry({ install: 'x' } as never, TOKEN);
    expect(sent).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a 429 on a behavior packet does not block packets with launches', async () => {
    const { client, fetch } = setup([
      json({ error: { code: 'rate_limited', message: '' } }, 429, { 'Retry-After': '3600' }),
      json({ accepted: 1 }),
    ]);
    expect(await client.sendTelemetry({ install: 'x' } as never, null, 'behavior')).toMatchObject({
      ok: false,
      error: { code: 'rate-limited' },
    });
    expect(await client.sendTelemetry({ install: 'x' } as never, null, 'launch')).toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await client.sendTelemetry({ install: 'x' } as never, null, 'behavior')).toMatchObject({
      ok: false,
      error: { code: 'rate-limited' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a 429 on telemetry does not block the catalog', async () => {
    const { client, fetch } = setup([
      json({ error: { code: 'rate_limited', message: '' } }, 429, { 'Retry-After': '3600' }),
      json({
        data: [],
        top_slots: { diamond: [], gold: [] },
        meta: { page: 1, per_page: 1, total: 0 },
      }),
    ]);
    await client.sendTelemetry({ install: 'x' } as never, null);
    expect((await client.servers({})).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await client.sendTelemetry({ install: 'x' } as never, null)).toMatchObject({
      ok: false,
      error: { code: 'rate-limited' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('account limits', () => {
  it('vote_paused does not silence the catalog and carries next_vote_at', async () => {
    const { http, client, fetch } = setup([
      json(
        { error: { code: 'vote_paused', message: '' }, next_vote_at: '2026-10-04T12:00:00Z' },
        429,
        { 'Retry-After': '80000' },
      ),
      json(card),
    ]);
    const vote = await http.send('/servers/3/votes', {
      method: 'POST',
      token: TOKEN,
      body: { nick: 'Steve' },
      parse: () => true,
      bucket: 'account',
    });
    expect(vote).toEqual({
      ok: false,
      error: {
        code: 'rate-limited',
        status: 429,
        retryAfterS: 3600,
        siteCode: 'vote_paused',
        nextVoteAt: '2026-10-04T12:00:00Z',
      },
    });
    expect((await client.server(card.id)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rate_limited on login silences only account requests', async () => {
    const { http, client } = setup([
      json({ error: { code: 'rate_limited', message: '' } }, 429, { 'Retry-After': '30' }),
      json(card),
    ]);
    const send = (): ReturnType<typeof http.send<true>> =>
      http.send('/auth/token', {
        method: 'POST',
        token: null,
        parse: () => true,
        bucket: 'account',
      });
    expect((await send()).ok).toBe(false);
    expect(await send()).toEqual({ ok: false, error: { code: 'rate-limited', retryAfterS: 30 } });
    expect((await client.server(card.id)).ok).toBe(true);
  });

  it('DELETE with 204 and an empty body is a success; account requests are not cached by the browser', async () => {
    const { http, fetch } = setup([new Response(null, { status: 204 })]);
    expect(
      await http.send('/auth/token', { method: 'DELETE', token: TOKEN, parse: () => true }),
    ).toEqual({ ok: true, value: true });
    expect(fetch.mock.calls[0]?.[1].cache).toBe('no-store');
  });

  it('re-requesting /meta bypasses the Chromium cache', async () => {
    const { client, fetch } = setup([json({ links: {} }), json({ links: {} })], null);
    await client.fetchMeta();
    await client.fetchMeta(true);
    expect(fetch.mock.calls[0]?.[1].cache).toBeUndefined();
    expect(fetch.mock.calls[1]?.[1].cache).toBe('no-cache');
  });
});
