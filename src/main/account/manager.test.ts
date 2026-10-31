import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountEvent } from '@shared/account';
import type { TelemetryDevice } from '@shared/telemetry';
import { emptyDevice } from '../device/collect';
import { MemoryCache } from '../site/cache';
import { SiteHttp, type Headers } from '../site/http';
import { createAccountApi } from './api';
import reports from './fixtures/reports.json';
import type { CallbackOutcome, Loopback } from './loopback';
import { AccountManager, type FavoritesCountStore, type SessionStore } from './manager';
import { challengeOf, type Pkce } from './pkce';
import type { LoadedSession, StoredSession } from './token-store';

const BASE = 'https://mc-mon.ru/api/launcher/v1';
const INSTALL = '6f1c3b9e-1111-4222-8333-444455556666';
const TOKEN = '12|mcml_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CONNECT = 'https://mc-mon.ru/launcher/connect';
const USER = { id: 7, name: 'Игрок', avatar_url: null };
const ME = {
  ...USER,
  created_at: '2026-03-12T10:00:00Z',
  votes_month: 3,
  favorites_count: 2,
  hours_played: null,
  trusted: true,
};

type Route = (init: RequestInit) => Response;

function json(body: unknown, status = 200, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function siteError(code: string, status: number, extra: object = {}): Response {
  return json({ error: { code, message: code }, ...extra }, status);
}

class MemoryStore implements SessionStore {
  saved: StoredSession | null;
  encryption = true;
  constructor(initial: StoredSession | null = null) {
    this.saved = initial;
  }
  available(): boolean {
    return this.encryption;
  }
  load(): Promise<LoadedSession> {
    return Promise.resolve(
      this.saved === null ? { kind: 'none' } : { kind: 'session', session: this.saved },
    );
  }
  save(session: StoredSession): Promise<boolean> {
    if (!this.encryption) {
      return Promise.resolve(false);
    }
    this.saved = session;
    return Promise.resolve(true);
  }
  clear(): Promise<void> {
    this.saved = null;
    return Promise.resolve();
  }
}

interface FakeLoopback extends Loopback {
  deliver: (outcome: CallbackOutcome) => void;
  closed: boolean;
}

function fakeLoopback(): FakeLoopback {
  let deliver: (outcome: CallbackOutcome) => void = () => undefined;
  const result = new Promise<CallbackOutcome>((resolve) => {
    deliver = resolve;
  });
  const loopback: FakeLoopback = {
    port: 50555,
    result,
    closed: false,
    deliver: (outcome) => {
      deliver(outcome);
    },
    close: () => {
      loopback.closed = true;
      deliver({ kind: 'closed' });
    },
  };
  return loopback;
}

interface Setup {
  manager: AccountManager;
  store: MemoryStore;
  loopbacks: FakeLoopback[];
  opened: string[];
  events: AccountEvent[];
  calls: { key: string; init: RequestInit }[];
}

function setup(
  routes: Record<string, Route>,
  initial: StoredSession | null = null,
  favoritesCount?: FavoritesCountStore,
): Setup {
  const calls: { key: string; init: RequestInit }[] = [];
  const fetch = vi.fn((url: string, init: RequestInit): Promise<Response> => {
    const key = `${init.method ?? 'GET'} ${url.slice(BASE.length)}`;
    calls.push({ key, init });
    const route = routes[key];
    return route === undefined
      ? Promise.resolve(siteError('not_found', 404))
      : Promise.resolve(route(init));
  });
  let manager: AccountManager | null = null;
  const http = new SiteHttp({
    base: BASE,
    fetch,
    headers: (): Promise<Headers> => Promise.resolve({ 'X-Launcher-Install': INSTALL }),
    cache: new MemoryCache(),
    now: Date.now,
    sleep: (): Promise<void> => Promise.resolve(),
    log: vi.fn(),
    retryDelaysMs: [],
    auth: {
      token: (): string | null => manager?.token() ?? null,
      reject: (token, code): void => {
        manager?.reject(token, code);
      },
    },
  });
  const store = new MemoryStore(initial);
  const loopbacks: FakeLoopback[] = [];
  const opened: string[] = [];
  const events: AccountEvent[] = [];
  const created = new AccountManager({
    store,
    api: createAccountApi(http),
    connectPage: (): Promise<string> => Promise.resolve(CONNECT),
    openBrowser: (url): Promise<boolean> => {
      opened.push(url);
      return Promise.resolve(true);
    },
    listen: (): Promise<Loopback> => {
      const loopback = fakeLoopback();
      loopbacks.push(loopback);
      return Promise.resolve(loopback);
    },
    installId: (): Promise<string> => Promise.resolve(INSTALL),
    device: (): Promise<TelemetryDevice> => Promise.resolve(emptyDevice()),
    deviceLabel: 'Windows · DESKTOP-1',
    now: Date.now,
    log: vi.fn(),
    ...(favoritesCount === undefined ? {} : { favoritesCount }),
    pkce: (): Pkce => ({
      verifier: VERIFIER,
      challenge: challengeOf(VERIFIER),
      state: 'state-abc-123',
    }),
  });
  manager = created;
  created.onEvent((event) => events.push(event));
  return { manager: created, store, loopbacks, opened, events, calls };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

const issued = (): Response =>
  json({ token: TOKEN, expires_at: '2027-01-01T00:00:00Z', user: USER });

afterEach(() => {
  vi.useRealTimers();
});

describe('browser connect flow', () => {
  it('opens the connect page with challenge, state, port and device', async () => {
    const { manager, opened } = setup({});
    const result = await manager.connect();
    expect(result).toMatchObject({ ok: true, value: { connect: { phase: 'waiting' } } });
    const url = new URL(opened[0] ?? '');
    expect(url.origin + url.pathname).toBe(CONNECT);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      state: 'state-abc-123',
      port: '50555',
      device: 'Windows · DESKTOP-1',
    });
  });

  it('reopen opens the same page of the same attempt and keeps the loopback', async () => {
    const { manager, opened, loopbacks } = setup({});
    expect(await manager.reopen()).toMatchObject({ ok: false, error: { code: 'connect_expired' } });
    const first = await manager.connect();
    const again = await manager.reopen();
    expect(opened).toHaveLength(2);
    expect(opened[1]).toBe(opened[0]);
    expect(loopbacks).toHaveLength(1);
    expect(again).toMatchObject({ ok: true });
    expect(again.ok && first.ok && again.value.connect).toEqual(first.ok && first.value.connect);
  });

  it('trusted_reason from the site lands in state', async () => {
    const { manager, loopbacks } = setup({
      'POST /auth/token': issued,
      'GET /me': () => json({ ...ME, trusted: false, trusted_reason: 'Подтвердите почту' }),
    });
    await manager.connect();
    loopbacks[0]?.deliver({ kind: 'code', code: 'ABCDEF23' });
    await settle();
    expect((await manager.state()).user).toMatchObject({
      trusted: false,
      trustedReason: 'Подтвердите почту',
    });
  });

  it('accepts and saves a token with no expiry (expires_at: null)', async () => {
    const { manager, loopbacks, store, events } = setup({
      'POST /auth/token': () => json({ token: TOKEN, expires_at: null, user: USER }),
      'GET /me': () => json(ME),
    });
    await manager.connect();
    loopbacks[0]?.deliver({ kind: 'code', code: 'ABCDEF23' });
    await settle();
    expect(store.saved).toEqual({
      token: TOKEN,
      user: { id: 7, name: 'Игрок', avatarUrl: null },
      nick: null,
    });
    expect(events.map((event) => event.change)).toContain('signed-in');
    expect((await manager.state()).user).toMatchObject({ name: 'Игрок' });
  });

  it('exchanges the loopback code for a token with verifier, install, device; token is stored', async () => {
    const { manager, loopbacks, calls, store, events } = setup({
      'POST /auth/token': issued,
      'GET /me': () => json(ME),
    });
    await manager.connect();
    loopbacks[0]?.deliver({ kind: 'code', code: 'ABCDEF23' });
    await settle();
    const exchange = calls.find((call) => call.key === 'POST /auth/token');
    expect(JSON.parse(exchange?.init.body as string)).toEqual({
      code: 'ABCDEF23',
      verifier: VERIFIER,
      install: INSTALL,
      device: emptyDevice(),
    });
    expect((exchange?.init.headers as Headers).Authorization).toBeUndefined();
    expect(store.saved).toEqual({
      token: TOKEN,
      user: { id: 7, name: 'Игрок', avatarUrl: null },
      nick: null,
    });
    expect(events.map((event) => event.change)).toContain('signed-in');
    const state = await manager.state();
    expect(state.connect).toBeNull();
    expect(state.user).toMatchObject({ name: 'Игрок', trusted: true, votesMonth: 3 });
    expect(JSON.stringify(state)).not.toContain('mcml_');
    expect(loopbacks[0]?.closed).toBe(true);
    const me = calls.find((call) => call.key === 'GET /me');
    expect((me?.init.headers as Headers).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('exchange errors return site API codes; sign-in waits for a manual code', async () => {
    const replies = [
      siteError('invalid_code', 400),
      siteError('code_expired', 400),
      siteError('challenge_mismatch', 400),
      json({ error: { code: 'too_many_attempts', message: '' } }, 429, { 'Retry-After': '60' }),
    ];
    const { manager } = setup({ 'POST /auth/token': () => replies.shift() ?? issued() });
    await manager.connect();
    for (const code of ['invalid_code', 'code_expired', 'challenge_mismatch']) {
      expect(await manager.submitCode('ABCD-EF23')).toEqual({ ok: false, error: { code } });
    }
    expect(await manager.submitCode('abcd ef23')).toMatchObject({
      ok: false,
      error: { code: 'too_many_attempts' },
    });
    expect((await manager.state()).connect).toMatchObject({ phase: 'waiting' });
    expect(await manager.submitCode('ABCDEF23')).toMatchObject({ ok: true });
  });

  it('manual code: malformed format and submitting without a pending connect', async () => {
    const { manager, calls } = setup({ 'POST /auth/token': issued });
    expect(await manager.submitCode('12')).toEqual({
      ok: false,
      error: { code: 'invalid_code_format' },
    });
    expect(await manager.submitCode('ABCD-EF23')).toEqual({
      ok: false,
      error: { code: 'connect_expired' },
    });
    expect(calls).toHaveLength(0);
  });

  it('5 minutes without a response — connect_timeout, loopback closed', async () => {
    vi.useFakeTimers();
    const { manager, loopbacks } = setup({});
    await manager.connect();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    const state = await manager.state();
    expect(state.connect).toBeNull();
    expect(state.error).toEqual({ code: 'connect_timeout' });
    expect(loopbacks[0]?.closed).toBe(true);
  });

  it('cancel closes the loopback; a late code does not sign in and the token is revoked', async () => {
    const { manager, loopbacks, calls } = setup({
      'POST /auth/token': () => issued(),
      'DELETE /auth/token': () => new Response(null, { status: 204 }),
    });
    await manager.connect();
    const pending = manager.submitCode('ABCDEF23');
    await manager.cancel();
    expect(loopbacks[0]?.closed).toBe(true);
    expect(await pending).toMatchObject({ ok: false });
    await settle();
    expect((await manager.state()).user).toBeNull();
    expect(calls.map((call) => call.key)).toContain('DELETE /auth/token');
  });

  it('without encryption, sign-in does not start and the browser does not open', async () => {
    const { manager, store, opened, loopbacks } = setup({});
    store.encryption = false;
    expect(await manager.connect()).toEqual({
      ok: false,
      error: { code: 'encryption_unavailable' },
    });
    expect(opened).toHaveLength(0);
    expect(loopbacks).toHaveLength(0);
    expect((await manager.state()).encryptionAvailable).toBe(false);
  });

  it('encryption becomes unavailable by the end of the exchange — token is not stored and is revoked', async () => {
    const { manager, store, calls } = setup({
      'POST /auth/token': issued,
      'DELETE /auth/token': () => new Response(null, { status: 204 }),
    });
    await manager.connect();
    store.encryption = false;
    expect(await manager.submitCode('ABCDEF23')).toEqual({
      ok: false,
      error: { code: 'encryption_unavailable' },
    });
    await settle();
    expect(store.saved).toBeNull();
    expect((await manager.state()).user).toBeNull();
    const revoke = calls.find((call) => call.key === 'DELETE /auth/token');
    expect((revoke?.init.headers as Headers).Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe('session', () => {
  const stored: StoredSession = {
    token: TOKEN,
    user: { id: 7, name: 'Игрок', avatarUrl: null },
    nick: null,
  };

  it('/me is cached: a repeat within a minute does not hit the site', async () => {
    const { manager, calls } = setup({ 'GET /me': () => json(ME) }, stored);
    await settle();
    await manager.refresh();
    await manager.refresh();
    expect(calls.filter((call) => call.key === 'GET /me')).toHaveLength(1);
    await manager.refresh(true);
    expect(calls.filter((call) => call.key === 'GET /me')).toHaveLength(2);
  });

  it('a stale profile is answered at once, refreshed by one request and announced', async () => {
    let votes = 1;
    const { manager, calls, events } = setup(
      {
        'GET /me': () => json({ ...ME, votes_month: (votes += 1) }),
        'PUT /me/favorites/3': () => json({ favorite: true }),
      },
      stored,
    );
    await settle();
    const before = (await manager.state()).user?.votesMonth;
    await manager.setFavorite(3, true);
    const seen = events.length;
    const answers = await Promise.all([manager.refresh(), manager.refresh(), manager.refresh()]);
    expect(answers.map((answer) => answer.ok && answer.value.user?.votesMonth)).toEqual([
      before,
      before,
      before,
    ]);
    await settle();
    expect(calls.filter((call) => call.key === 'GET /me')).toHaveLength(2);
    expect(events).toHaveLength(seen + 1);
    expect((await manager.state()).user?.votesMonth).not.toBe(before);
  });

  it('401 unauthenticated or install_mismatch — token is forgotten, expired event fires', async () => {
    for (const code of ['unauthenticated', 'install_mismatch']) {
      const { manager, store, events } = setup({ 'GET /me': () => siteError(code, 401) }, stored);
      await settle();
      expect(store.saved).toBeNull();
      expect(events.at(-1)).toMatchObject({
        change: 'expired',
        state: { user: null, error: { code } },
      });
      expect(await manager.favorites()).toEqual({ ok: false, error: { code: 'not_signed_in' } });
    }
  });

  it('403 forbidden does not forget the token', async () => {
    const { manager, store } = setup(
      { 'GET /me': () => json(ME), 'GET /me/favorites': () => siteError('forbidden', 403) },
      stored,
    );
    await settle();
    expect(await manager.favorites()).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(store.saved).not.toBeNull();
  });

  it('logout: DELETE /auth/token with the token, deletes the file', async () => {
    const { manager, store, calls, events } = setup(
      {
        'GET /me': () => json(ME),
        'DELETE /auth/token': () => new Response(null, { status: 204 }),
      },
      stored,
    );
    await settle();
    expect(await manager.logout()).toMatchObject({ ok: true, value: { user: null } });
    expect(store.saved).toBeNull();
    expect(calls.map((call) => call.key)).toContain('DELETE /auth/token');
    expect(events.at(-1)?.change).toBe('signed-out');
  });

  it('logout forgets the session even when the site fails to revoke the token', async () => {
    const { manager, store, events } = setup(
      {
        'GET /me': () => json(ME),
        'DELETE /auth/token': () => siteError('server_error', 500),
      },
      stored,
    );
    await settle();
    expect(await manager.logout()).toMatchObject({ ok: true, value: { user: null } });
    expect(store.saved).toBeNull();
    expect(manager.token()).toBeNull();
    expect(events.at(-1)?.change).toBe('signed-out');
  });

  it('alerts: feed, read, clear, watch and settings with the token', async () => {
    const feed = {
      items: [
        {
          id: 42,
          kind: 'favorite_wipe',
          server: { id: 3, name: 'Moonvale', icon: null },
          at: '2026-10-05T15:00:00Z',
          read: false,
          payload: { title: 'Сегодня вайп на Moonvale' },
        },
        { id: 43, kind: 'new_kind', server: null, at: '2026-10-05T16:00:00Z', payload: {} },
        { id: 'x', kind: 'watched_up', at: '2026-10-05T16:00:00Z', payload: { title: 'x' } },
      ],
      unread: 1,
      next: 'c2',
    };
    const settings = { favorite_wipe: true, watched_up: false, server_removed: true };
    const { manager, calls } = setup(
      {
        'GET /me': () => json({ ...ME, unread_alerts: 1 }),
        'GET /me/alerts': () => json(feed),
        'GET /me/alerts?after=c2': () => json({ items: [], unread: 0, next: null }),
        'POST /me/alerts/read': () => new Response(null, { status: 204 }),
        'POST /me/alerts/clear': () => new Response(null, { status: 204 }),
        'PUT /me/watches/5': () => new Response(null, { status: 204 }),
        'DELETE /me/watches/5': () => json({ watch: false }),
        'GET /me/alert-settings': () => json(settings),
        'PUT /me/alert-settings': () => json(settings),
      },
      stored,
    );
    await settle();
    expect((await manager.state()).user?.unreadAlerts).toBe(1);
    expect(await manager.alerts(null)).toEqual({
      ok: true,
      value: {
        items: [
          {
            id: 42,
            kind: 'favorite_wipe',
            server: { id: 3, name: 'Moonvale' },
            at: '2026-10-05T15:00:00Z',
            read: false,
            title: 'Сегодня вайп на Moonvale',
          },
        ],
        unread: 1,
        next: 'c2',
      },
    });
    expect(await manager.alerts('c2')).toMatchObject({ ok: true, value: { items: [] } });
    expect(await manager.readAlerts(null)).toEqual({ ok: true, value: true });
    expect(await manager.readAlerts([42])).toEqual({ ok: true, value: true });
    expect(calls.at(-1)?.init.body).toBe(JSON.stringify({ ids: [42] }));
    expect(await manager.clearAlerts()).toEqual({ ok: true, value: true });
    expect(await manager.setWatch(5, true)).toEqual({ ok: true, value: true });
    expect(await manager.setWatch(5, false)).toEqual({ ok: true, value: false });
    expect(await manager.alertSettings()).toEqual({ ok: true, value: settings });
    expect(await manager.setAlertSettings(settings)).toEqual({ ok: true, value: settings });
  });

  it('alerts: a guest sends nothing, a missing endpoint is an error', async () => {
    const guest = setup({});
    expect(await guest.manager.alerts(null)).toEqual({
      ok: false,
      error: { code: 'not_signed_in' },
    });
    expect(guest.calls).toEqual([]);
    const { manager } = setup(
      { 'GET /me': () => json(ME), 'GET /me/alerts': () => siteError('not_found', 404) },
      stored,
    );
    await settle();
    expect(await manager.alerts(null)).toMatchObject({ ok: false });
  });

  it('404 from a method the site has not shipped yet is unavailable, not a missing server', async () => {
    const { manager } = setup({ 'GET /me': () => json(ME) }, stored);
    await settle();
    const settings = { favorite_wipe: true, watched_up: true, server_removed: true };
    const unavailable = { ok: false, error: { code: 'unavailable' } };
    expect(await manager.alerts(null)).toEqual(unavailable);
    expect(await manager.readAlerts(null)).toEqual(unavailable);
    expect(await manager.clearAlerts()).toEqual(unavailable);
    expect(await manager.setWatch(5, true)).toEqual(unavailable);
    expect(await manager.alertSettings()).toEqual(unavailable);
    expect(await manager.setAlertSettings(settings)).toEqual(unavailable);
    expect(await manager.ownedServers()).toEqual(unavailable);
    expect(await manager.ownedServer(5)).toEqual({
      ok: false,
      error: { code: 'server_not_found' },
    });
    expect(await manager.favorites()).toEqual({ ok: false, error: { code: 'server_not_found' } });
  });

  it('watch: a server missing from the catalog is not mistaken for a missing method', async () => {
    const { manager } = setup(
      {
        'GET /me': () => json(ME),
        'PUT /me/watches/5': () => siteError('server_not_found', 404),
      },
      stored,
    );
    await settle();
    expect(await manager.setWatch(5, true)).toEqual({
      ok: false,
      error: { code: 'server_not_found' },
    });
  });

  it('watch: rejection codes of the site reach the caller as they are', async () => {
    const codes = [
      'email_unverified',
      'watches_limit',
      'server_online',
      'server_dead',
      'server_sleeping',
    ] as const;
    let index = 0;
    const { manager } = setup(
      {
        'GET /me': () => json(ME),
        'PUT /me/watches/5': () => siteError(codes[index] ?? '', 422),
        'DELETE /me/watches/5': () => siteError('rate_limited', 429, { retry_after: 30 }),
      },
      stored,
    );
    await settle();
    for (const code of codes) {
      expect(await manager.setWatch(5, true)).toEqual({ ok: false, error: { code } });
      index += 1;
    }
    expect(await manager.setWatch(5, false)).toMatchObject({
      ok: false,
      error: { code: 'rate_limited' },
    });
  });

  it('owned servers: profile list, table and details', async () => {
    const row = {
      id: 9,
      name: 'ТехноГрад',
      status: 'down',
      down_since: '2026-10-05T15:40:00Z',
      online: 0,
      slots: 1500,
      version: '1.20.1',
      checked_at: '2026-10-05T15:52:00Z',
      rank: 4,
      rank_week_ago: 3,
      votes_month: 2184,
      points: 1250,
      points_expire_at: '2026-10-08T00:00:00Z',
      top_slot: { tier: 'gold', ends_at: '2026-10-12T00:00:00Z', price: 1 },
      uptime_30d: 0.987,
      attention: {
        kind: 'down',
        at: '2026-10-05T15:40:00Z',
        payload: { title: '«ТехноГрад»: не отвечает', short: 'Не отвечает' },
      },
    };
    const details = {
      ...row,
      online_avg_day: 742.4,
      online_peak_day: { online: 1412, at: '2026-10-04T18:00:00Z' },
      votes_month_change: 12,
      sources_7d: { launcher_launches: 4218, address_copies: 2906 },
      votifier: { ok: true, last_error_at: null },
      reviews: { total: 132, new: 3 },
      events: [
        {
          id: 1,
          kind: 'down',
          at: '2026-10-05T15:40:00Z',
          payload: { title: '«ТехноГрад»: не отвечает', short: 'Не отвечает' },
        },
        { id: 2, kind: 'up', at: '2026-10-05T15:50:00Z', payload: { title: 'Снова работает' } },
        {
          id: 3,
          kind: 'top_slot_expire',
          at: '2026-10-05T15:51:00Z',
          payload: { title: 'Место закончится', tier: 'diamond', ends_at: 1760000000 },
        },
        {
          id: 4,
          kind: 'top_slot_expire',
          at: '2026-10-05T15:52:00Z',
          payload: { title: 'Место закончится', tier: 'ruby' },
        },
      ],
    };
    const { manager } = setup(
      {
        'GET /me': () =>
          json({
            ...ME,
            owned_servers: [
              { id: 9, name: 'ТехноГрад', status: 'down' },
              { id: 10, name: 'Кубоград', status: 'sleeping' },
              { id: 11, status: 'up' },
            ],
          }),
        'GET /me/servers': () =>
          json({
            items: [
              row,
              { id: 'x' },
              { ...row, id: 12, top_slot: { tier: 'ruby', ends_at: '2026-10-12T00:00:00Z' } },
              { ...row, id: 13, top_slot: { tier: 'gold', ends_at: 'soon' } },
              { ...row, id: 14, top_slot: 'gold' },
              { ...row, id: 15, top_slot: undefined },
            ],
          }),
        'GET /me/servers/9': () => json(details),
        'GET /me/servers/11': () => siteError('forbidden', 403),
      },
      stored,
    );
    await settle();
    expect((await manager.state()).user?.ownedServers).toEqual([
      { id: 9, name: 'ТехноГрад', status: 'down' },
      { id: 10, name: 'Кубоград', status: 'down' },
    ]);
    const table = await manager.ownedServers();
    expect(table).toMatchObject({
      ok: true,
      value: [
        {
          id: 9,
          rank: 4,
          rankWeekAgo: 3,
          uptime30d: 0.987,
          attention: { kind: 'down', title: 'Не отвечает' },
          topSlot: { tier: 'gold', endsAt: '2026-10-12T00:00:00Z' },
        },
        { id: 12, topSlot: null },
        { id: 13, topSlot: null },
        { id: 14, topSlot: null },
        { id: 15, topSlot: null },
      ],
    });
    expect(await manager.ownedServer(9)).toMatchObject({
      ok: true,
      value: {
        onlineAvgDay: 742,
        onlineAvgPrevDay: null,
        onlinePeakDay: { value: 1412 },
        sources7d: {
          launcherLaunches: 4218,
          addressCopies: 2906,
          siteClicks: 0,
          widgetVotes: null,
        },
        reviews: { total: 132, fresh: 3 },
        complaints: null,
        events: [
          { id: 1, kind: 'down', server: null, read: false, title: 'Не отвечает' },
          { id: 2, kind: 'up', title: 'Снова работает' },
          { id: 3, kind: 'top_slot_expire', tier: 'diamond' },
          { id: 4, kind: 'top_slot_expire' },
        ],
      },
    });
    expect(await manager.ownedServer(11)).toEqual({ ok: false, error: { code: 'forbidden' } });
  });

  it('vote pauses: list with the token, a missing endpoint is unavailable', async () => {
    const { manager } = setup(
      {
        'GET /me': () => json(ME),
        'GET /me/votes': () =>
          json({
            items: [
              { server_id: 3, can_vote_at: '2026-10-06T10:00:00Z' },
              { server_id: 4, can_vote_at: 'soon' },
              { server_id: 'x', can_vote_at: '2026-10-06T10:00:00Z' },
            ],
          }),
      },
      stored,
    );
    await settle();
    expect(await manager.votePauses()).toEqual({
      ok: true,
      value: [{ serverId: 3, canVoteAt: '2026-10-06T10:00:00Z' }],
    });
    const missing = setup(
      { 'GET /me': () => json(ME), 'GET /me/votes': () => siteError('not_found', 404) },
      stored,
    );
    await settle();
    expect(await missing.manager.votePauses()).toEqual({
      ok: false,
      error: { code: 'unavailable' },
    });
  });

  it('favorites: list, PUT and DELETE with the token', async () => {
    const { manager } = setup(
      {
        'GET /me': () => json(ME),
        'GET /me/favorites': () => json({ ids: [3, 3, 'x', 17] }),
        'PUT /me/favorites/5': () => json({ favorite: true }),
        'DELETE /me/favorites/5': () => json({ favorite: false }),
      },
      stored,
    );
    await settle();
    expect(await manager.favorites()).toEqual({ ok: true, value: [3, 17] });
    expect(await manager.setFavorite(5, true)).toEqual({ ok: true, value: true });
    expect(await manager.setFavorite(5, false)).toEqual({ ok: true, value: false });
  });

  it('the number of favorites is remembered for the next start and forgotten on sign-out', async () => {
    let remembered: number | null = 4;
    const { manager } = setup(
      {
        'GET /me/favorites': () => json({ ids: [3, 17] }),
        'PUT /me/favorites/5': () => json({ favorite: true }),
        'DELETE /me/favorites/3': () => json({ favorite: false }),
        'PUT /me/favorites/9': () => siteError('server_not_found', 404),
      },
      stored,
      {
        get: () => remembered,
        set: (count) => {
          remembered = count;
        },
      },
    );
    await settle();
    expect((await manager.state()).user?.favoritesCount).toBe(4);
    await manager.setFavorite(5, true);
    expect(remembered).toBe(4);
    await manager.favorites();
    expect(remembered).toBe(2);
    await manager.setFavorite(5, true);
    expect(remembered).toBe(3);
    await manager.setFavorite(5, true);
    await manager.setFavorite(9, true);
    expect(remembered).toBe(3);
    await manager.setFavorite(3, false);
    expect(remembered).toBe(2);
    await manager.logout();
    expect(remembered).toBeNull();
  });

  it('vote: weight, vote_paused with next_vote_at, vote_busy, invalid_nick, captcha_required', async () => {
    const replies = [
      json({ ok: true, next_vote_at: '2026-10-04T12:00:00Z', weight: 2 }),
      json(
        { error: { code: 'vote_paused', message: '' }, next_vote_at: '2026-10-04T12:00:00Z' },
        429,
        { 'Retry-After': '86000' },
      ),
      siteError('vote_busy', 503),
      siteError('invalid_nick', 422),
      siteError('captcha_required', 403),
    ];
    const { manager, calls } = setup(
      {
        'GET /me': () => json(ME),
        'POST /servers/3/votes': () => replies.shift() ?? siteError('server_error', 500),
      },
      stored,
    );
    await settle();
    expect(await manager.vote(3, 'Steve')).toEqual({
      ok: true,
      value: { nextVoteAt: '2026-10-04T12:00:00Z', weight: 2 },
    });
    const vote = calls.find((call) => call.key === 'POST /servers/3/votes');
    expect(JSON.parse(vote?.init.body as string)).toEqual({ nick: 'Steve' });
    expect(await manager.vote(3, 'Steve')).toEqual({
      ok: false,
      error: { code: 'vote_paused', retryAfterS: 3600, nextVoteAt: '2026-10-04T12:00:00Z' },
    });
    expect(await manager.vote(3, 'Steve')).toMatchObject({
      ok: false,
      error: { code: 'vote_busy' },
    });
    expect(await manager.vote(3, 'Игрок')).toEqual({ ok: false, error: { code: 'invalid_nick' } });
    expect(await manager.vote(3, 'Steve')).toEqual({
      ok: false,
      error: { code: 'captcha_required' },
    });
    expect((await manager.state()).user).not.toBeNull();
  });

  it('report: body, token and install id; 201 → my_report', async () => {
    const { manager, calls } = setup(
      { 'GET /me': () => json(ME), 'POST /servers/3/reports': () => fixture('created') },
      stored,
    );
    await settle();
    expect(await manager.report(3, { reason: 'fake_stats', note: 'Онлайн 5000 ботов' })).toEqual({
      ok: true,
      value: { at: '2026-10-03T12:00:00Z' },
    });
    const report = calls.find((call) => call.key === 'POST /servers/3/reports');
    expect(JSON.parse(report?.init.body as string)).toEqual({
      reason: 'fake_stats',
      note: 'Онлайн 5000 ботов',
    });
    expect(report?.init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'X-Launcher-Install': INSTALL,
    });
  });

  it('report without being signed in does not reach the site', async () => {
    const { manager, calls } = setup({});
    await settle();
    expect(await manager.report(3, { reason: 'other', note: 'Адрес ведёт не туда' })).toEqual({
      ok: false,
      error: { code: 'not_signed_in' },
    });
    expect(calls.some((call) => call.key === 'POST /servers/3/reports')).toBe(false);
  });

  it('report: rejection codes and fields from the response root', async () => {
    const names = [
      'email_unverified',
      'own_server',
      'note_required',
      'already_reported',
      'invalid_request',
      'daily_limit',
      'too_frequent',
      'server_not_found',
    ] as const;
    const replies = names.map((name) => fixture(name));
    const { manager } = setup(
      {
        'GET /me': () => json(ME),
        'GET /me/favorites': () => json({ ids: [3] }),
        'POST /servers/3/reports': () => replies.shift() ?? siteError('server_error', 500),
      },
      stored,
    );
    await settle();
    const draft = { reason: 'fake_stats', note: '' };
    const results = [];
    while (results.length < names.length) {
      results.push(await manager.report(3, draft));
    }
    expect(results).toEqual([
      { ok: false, error: { code: 'email_unverified' } },
      { ok: false, error: { code: 'own_server' } },
      { ok: false, error: { code: 'note_required' } },
      { ok: false, error: { code: 'already_reported', reportedAt: '2026-10-01T09:30:00Z' } },
      { ok: false, error: { code: 'invalid_request' } },
      {
        ok: false,
        error: {
          code: 'daily_limit',
          retryAfterS: 3600,
          limit: 5,
          resetsAt: '2026-10-04T07:30:00Z',
        },
      },
      { ok: false, error: { code: 'too_frequent', retryAfterS: 2 } },
      { ok: false, error: { code: 'server_not_found' } },
    ]);
    expect(await manager.favorites()).toEqual({ ok: true, value: [3] });
  });
});

interface ReportFixture {
  status: number;
  headers?: Headers;
  body: unknown;
}

function fixture(name: keyof typeof reports): Response {
  const item: ReportFixture = reports[name];
  return json(item.body, item.status, item.headers ?? {});
}

describe('pinned nickname', () => {
  const CHANGE_AT = '2026-11-12T09:00:00Z';
  const session = (): StoredSession => ({
    token: TOKEN,
    user: { id: 7, name: 'Игрок', avatarUrl: null },
    nick: null,
  });
  const authorization = (call: { init: RequestInit } | undefined): string | undefined =>
    (call?.init.headers as Headers | undefined)?.Authorization;

  it('/me: a nickname, null and a site without the field are three different states', async () => {
    const pinned = setup(
      { 'GET /me': () => json({ ...ME, nick: 'Test_User', nick_change_at: CHANGE_AT }) },
      session(),
    );
    await settle();
    expect((await pinned.manager.state()).user?.nick).toEqual({
      name: 'Test_User',
      changeAt: CHANGE_AT,
    });
    expect(pinned.store.saved?.nick).toEqual({ name: 'Test_User', changeAt: CHANGE_AT });

    const unpicked = setup(
      { 'GET /me': () => json({ ...ME, nick: null, nick_change_at: null, skin: null }) },
      session(),
    );
    await settle();
    expect((await unpicked.manager.state()).user?.nick).toEqual({ name: null, changeAt: null });

    const oldSite = setup({ 'GET /me': () => json(ME) }, session());
    await settle();
    expect((await oldSite.manager.state()).user?.nick).toBeNull();
  });

  it('the stored nickname is shown before /me answers and survives a site failure', async () => {
    const { manager } = setup(
      { 'GET /me': () => siteError('server_error', 500) },
      { ...session(), nick: { name: 'Test_User', changeAt: null } },
    );
    await settle();
    expect((await manager.state()).user?.nick).toEqual({ name: 'Test_User', changeAt: null });
  });

  it('setNick: 200 pins the nickname and tells the renderer', async () => {
    const { manager, store, events, calls } = setup(
      {
        'GET /me': () => json({ ...ME, nick: null, nick_change_at: null }),
        'PUT /me/nick': () => json({ nick: 'Kotofey', nick_change_at: null }),
      },
      session(),
    );
    await settle();
    const result = await manager.setNick('Kotofey');
    expect(result).toMatchObject({
      ok: true,
      value: { user: { nick: { name: 'Kotofey', changeAt: null } } },
    });
    expect(store.saved?.nick).toEqual({ name: 'Kotofey', changeAt: null });
    expect(events.at(-1)?.state.user?.nick?.name).toBe('Kotofey');
    const put = calls.find((call) => call.key === 'PUT /me/nick');
    expect(JSON.parse(put?.init.body as string)).toEqual({ nick: 'Kotofey' });
    expect(authorization(put)).toBe(`Bearer ${TOKEN}`);
  });

  it('setNick: every refusal of the site has its own code', async () => {
    const refusals: [Response, object][] = [
      [siteError('nick_taken', 409), { code: 'nick_taken' }],
      [siteError('invalid_nick', 422), { code: 'invalid_nick' }],
      [
        siteError('nick_change_too_soon', 429, { nick_change_at: CHANGE_AT }),
        { code: 'nick_change_too_soon', changeAt: CHANGE_AT },
      ],
      [siteError('not_found', 404), { code: 'unsupported' }],
      [json({ message: 'Method Not Allowed' }, 405), { code: 'unsupported' }],
      [siteError('server_error', 500), { code: 'failed' }],
      [json({ message: 'The nick field is required.' }, 422), { code: 'failed' }],
    ];
    for (const [response, error] of refusals) {
      const { manager } = setup({ 'PUT /me/nick': () => response.clone() }, session());
      await settle();
      expect(await manager.setNick('Kotofey')).toEqual({ ok: false, error });
    }
  });

  it('setNick: no connection is told apart from a refusal of the site', async () => {
    const { manager } = setup(
      {
        'PUT /me/nick': () => {
          throw new TypeError('fetch failed');
        },
      },
      session(),
    );
    await settle();
    expect(await manager.setNick('Kotofey')).toEqual({ ok: false, error: { code: 'offline' } });
  });

  it('a too-early change remembers the date from the refusal', async () => {
    const { manager, store } = setup(
      {
        'GET /me': () => json({ ...ME, nick: 'Test_User', nick_change_at: null }),
        'PUT /me/nick': () => siteError('nick_change_too_soon', 429, { nick_change_at: CHANGE_AT }),
      },
      session(),
    );
    await settle();
    await manager.setNick('Kotofey');
    expect((await manager.state()).user?.nick).toEqual({ name: 'Test_User', changeAt: CHANGE_AT });
    expect(store.saved?.nick?.changeAt).toBe(CHANGE_AT);
  });

  it('a too-early change does not block the next account requests', async () => {
    const { manager } = setup(
      {
        'PUT /me/nick': () => siteError('nick_change_too_soon', 429, { nick_change_at: CHANGE_AT }),
        'GET /me/favorites': () => json({ ids: [5] }),
      },
      session(),
    );
    await settle();
    await manager.setNick('Kotofey');
    expect(await manager.favorites()).toEqual({ ok: true, value: [5] });
  });

  it('setNick without a session does not call the site', async () => {
    const { manager, calls } = setup({});
    expect(await manager.setNick('Kotofey')).toEqual({
      ok: false,
      error: { code: 'not_signed_in' },
    });
    expect(calls).toHaveLength(0);
  });

  it('playCheck: every answer of the site, and silence means the game may start', async () => {
    const answers: [Response, object][] = [
      [json({ ok: true }), { kind: 'ok' }],
      [siteError('nick_taken', 409), { kind: 'nick_taken' }],
      [
        siteError('nick_mismatch', 409, { nick: 'Test_User' }),
        { kind: 'nick_mismatch', nick: 'Test_User' },
      ],
      [siteError('nick_mismatch', 409), { kind: 'unchecked' }],
      [
        siteError('banned', 403, { reason: 'гриф спавна', until: '2026-10-20T21:00:00Z' }),
        {
          kind: 'banned',
          ban: { reason: 'гриф спавна', until: '2026-10-20T21:00:00Z', forever: false },
        },
      ],
      [
        siteError('banned', 403, { reason: null, until: null }),
        { kind: 'banned', ban: { reason: null, until: null, forever: true } },
      ],
      [siteError('server_error', 500), { kind: 'unchecked' }],
      [siteError('not_found', 404), { kind: 'unchecked' }],
      [json({ message: 'Method Not Allowed' }, 405), { kind: 'unchecked' }],
      [json({ ok: false }), { kind: 'unchecked' }],
    ];
    for (const [response, check] of answers) {
      const { manager } = setup({ 'POST /play/check': () => response.clone() });
      expect(await manager.playCheck({ serverId: 5, nick: 'Steve', auth: 'nick' })).toEqual(check);
    }
  });

  it('admitPlay: the play code comes with the answer, and the window never sees it', async () => {
    const code = 'Ab3'.padEnd(32, 'x');
    const answers: [Response, string | null][] = [
      [json({ ok: true, play_code: code }), code],
      [json({ ok: true, play_code: null }), null],
      [json({ ok: true }), null],
      [json({ ok: true, play_code: 'short' }), null],
      [json({ ok: true, play_code: `${code.slice(1)} ` }), null],
      [json({ ok: true, play_code: 42 }), null],
    ];
    for (const [response, expected] of answers) {
      const { manager } = setup({ 'POST /play/check': () => response.clone() });
      const query = { serverId: 5, nick: 'Steve', auth: 'nick' } as const;
      expect(await manager.admitPlay(query)).toEqual({ check: { kind: 'ok' }, code: expected });
      expect(await manager.playCheck(query)).toEqual({ kind: 'ok' });
    }
  });

  it('admitPlay: a nickname other than the pinned one is asked once and gets no code', async () => {
    const { manager, calls } = setup(
      {
        'GET /me': () => json(ME),
        'POST /play/check': () => siteError('nick_mismatch', 409, { nick: 'Test_User' }),
      },
      { token: TOKEN, user: { id: 7, name: 'Игрок', avatarUrl: null }, nick: null },
    );
    expect(await manager.admitPlay({ serverId: 68, nick: 'Steve', auth: 'nick' })).toEqual({
      check: { kind: 'nick_mismatch', nick: 'Test_User' },
      code: null,
    });
    expect(calls.filter((call) => call.key === 'POST /play/check')).toHaveLength(1);
  });

  it('playCheck: a guest sends no token and no server_id for a typed address', async () => {
    const { manager, calls } = setup({ 'POST /play/check': () => json({ ok: true }) });
    await manager.playCheck({ serverId: null, nick: 'Steve', auth: 'nick' });
    await manager.playCheck({ serverId: 5, nick: 'Steve', auth: 'microsoft' });
    const [typed, catalog] = calls.filter((call) => call.key === 'POST /play/check');
    expect(authorization(typed)).toBeUndefined();
    expect(JSON.parse(typed?.init.body as string)).toEqual({ nick: 'Steve', auth: 'nick' });
    expect(JSON.parse(catalog?.init.body as string)).toEqual({
      server_id: 5,
      nick: 'Steve',
      auth: 'microsoft',
    });
  });

  it('playCheck: the site does not answer — the game may start', async () => {
    const { manager } = setup({
      'POST /play/check': () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(await manager.playCheck({ serverId: 5, nick: 'Steve', auth: 'nick' })).toEqual({
      kind: 'unchecked',
    });
  });

  it('playCheck: nick_mismatch leaves the pinned nickname alone, the token goes along', async () => {
    const { manager, store, events, calls } = setup(
      {
        'GET /me': () => json(ME),
        'POST /play/check': () => siteError('nick_mismatch', 409, { nick: 'Test_User' }),
      },
      session(),
    );
    await settle();
    const saved = store.saved?.nick ?? null;
    await manager.playCheck({ serverId: 5, nick: 'Steve', auth: 'nick' });
    expect(store.saved?.nick ?? null).toEqual(saved);
    expect(events.every((event) => event.state.user?.nick?.name !== 'Test_User')).toBe(true);
    expect(authorization(calls.find((call) => call.key === 'POST /play/check'))).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it('playCheck: a revoked token is dropped and the nickname is checked again as a guest', async () => {
    const { manager, calls } = setup(
      {
        'GET /me': () => json(ME),
        'POST /play/check': (init) =>
          (init.headers as Headers).Authorization === undefined
            ? siteError('nick_taken', 409)
            : siteError('unauthenticated', 401),
      },
      session(),
    );
    await settle();
    expect(await manager.playCheck({ serverId: null, nick: 'Steve', auth: 'nick' })).toEqual({
      kind: 'nick_taken',
    });
    expect(calls.filter((call) => call.key === 'POST /play/check')).toHaveLength(2);
    expect((await manager.state()).user).toBeNull();
  });
});
