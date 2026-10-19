import { describe, expect, it, vi, type Mock } from 'vitest';
import type { AccountEvent, AccountResult, VoteResult } from '@shared/account';
import type { SiteChange, SiteService } from '@shared/site';
import type { TelemetryEvent } from '@shared/telemetry';
import { MemoryCache } from './cache';
import { SiteClient } from './client';
import { SiteHttp, type Headers } from './http';
import { createSiteService, PingTargets, type SiteParts } from './service';

const NOW = Date.parse('2026-10-12T09:00:00.000Z');
const BASE = 'https://mc-mon.ru/api/launcher/v1';
const MINUTE = 60_000;

function serviceWith(result: AccountResult<VoteResult>): {
  vote: () => Promise<AccountResult<VoteResult>>;
  pushed: TelemetryEvent[];
} {
  const pushed: TelemetryEvent[] = [];
  const service = createSiteService({
    telemetry: {
      push: (event: TelemetryEvent): void => {
        pushed.push(event);
      },
    },
    account: { vote: vi.fn(() => Promise.resolve(result)), onEvent: vi.fn(), token: () => null },
    now: () => NOW,
  } as unknown as SiteParts);
  return { vote: () => service.vote(7, 'Steve'), pushed };
}

describe('site service: vote.finished', () => {
  it.each([
    [{ ok: true, value: { nextVoteAt: '2026-10-13T09:00:00Z', weight: 2 } }, 'ok'],
    [{ ok: false, error: { code: 'vote_paused' } }, 'paused'],
    [{ ok: false, error: { code: 'captcha_required' } }, 'captcha_required'],
    [{ ok: false, error: { code: 'offline' } }, 'error'],
  ] as const)('%j is reported as %s, the result is returned untouched', async (result, outcome) => {
    const { vote, pushed } = serviceWith(result);
    expect(await vote()).toBe(result);
    expect(pushed).toEqual([
      { type: 'vote.finished', at: '2026-10-12T09:00:00.000Z', server_id: 7, outcome },
    ]);
    expect(JSON.stringify(pushed)).not.toContain('Steve');
  });
});

type Route = (path: string, init: RequestInit) => Response;
type Account = SiteParts['account'];

interface Built {
  service: SiteService;
  fetch: Mock<(url: string, init: RequestInit) => Promise<Response>>;
  account: { [K in keyof Account]: Mock<Account[K]> };
  changes: SiteChange[];
  tick: (ms: number) => void;
  signal: (change: AccountEvent['change']) => void;
  signIn: (token: string | null) => void;
  asked: () => string[];
}

function json(body: unknown, status = 200, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const LIST = {
  data: [],
  top_slots: { diamond: [], gold: [] },
  meta: { page: 1, per_page: 50, total: 0 },
};

function siteRoute(path: string): Response {
  if (path.startsWith('/servers')) {
    return json(LIST, 200, { 'Cache-Control': 'public, max-age=20' });
  }
  if (path === '/meta') {
    return json({ links: {}, report_reasons: [] }, 200, { 'Cache-Control': 'max-age=300' });
  }
  return json([], 200);
}

function build(route: Route = siteRoute, cache = new MemoryCache()): Built {
  let now = NOW;
  let listener: (event: AccountEvent) => void = () => undefined;
  let session: string | null = null;
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>((url, init) =>
    Promise.resolve(route(url.slice(BASE.length), init)),
  );
  const http = new SiteHttp({
    base: BASE,
    fetch,
    headers: (): Promise<Headers> => Promise.resolve({}),
    cache,
    now: (): number => now,
    sleep: (): Promise<void> => Promise.resolve(),
    log: vi.fn(),
    retryDelaysMs: [],
    auth: { token: (): string | null => session, reject: vi.fn() },
  });
  const options = { log: vi.fn(), localIcon: (remote: string | null): string | null => remote };
  const empty = <T>(value: T): Mock<() => Promise<{ ok: true; value: T }>> =>
    vi.fn(() => Promise.resolve({ ok: true as const, value }));
  const account = {
    favorites: empty([3, 17]),
    setFavorite: vi.fn((_id: number, favorite: boolean) =>
      Promise.resolve({ ok: true as const, value: favorite }),
    ),
    vote: empty({ nextVoteAt: '2026-10-13T09:00:00Z', weight: 1 as const }),
    report: empty({ at: '2026-10-12T09:00:00Z' }),
    alerts: empty({ items: [], unread: 0, next: null }),
    readAlerts: empty(true as const),
    clearAlerts: empty(true as const),
    setWatch: empty(true),
    alertSettings: empty({ favorite_wipe: true, watched_up: true, server_removed: true }),
    setAlertSettings: vi.fn((settings: unknown) =>
      Promise.resolve({ ok: true as const, value: settings }),
    ),
    ownedServers: empty([]),
    ownedServer: empty({}),
    votePauses: empty([]),
    token: vi.fn(() => session),
    onEvent: vi.fn((next: (event: AccountEvent) => void) => {
      listener = next;
      return (): void => undefined;
    }),
  } as unknown as Built['account'];
  const changes: SiteChange[] = [];
  const service = createSiteService({
    client: new SiteClient({ ...options, http }),
    kept: new SiteClient({ ...options, http: http.kept() }),
    telemetry: { push: vi.fn() },
    account,
    now: () => now,
  } as unknown as SiteParts);
  service.onChanged((change) => {
    changes.push(change);
  });
  return {
    service,
    fetch,
    account,
    changes,
    tick: (ms): void => {
      now += ms;
    },
    signal: (change): void => {
      listener({ change } as AccountEvent);
    },
    signIn: (token): void => {
      session = token;
    },
    asked: () => fetch.mock.calls.map(([url]) => url.slice(BASE.length)),
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function windowStart(service: SiteService): Promise<void> {
  await Promise.all([
    service.meta(),
    service.servers({ sort: 'rating', page: 1, per_page: 50 }),
    service.scenes(),
    service.skinMod(),
    service.favorites(),
    service.alerts(),
    service.votePauses(),
    service.ownedServers(),
    service.alertSettings(),
  ]);
  await flush();
}

function accountCalls(account: Built['account']): number {
  return (
    account.favorites.mock.calls.length +
    account.alerts.mock.calls.length +
    account.votePauses.mock.calls.length +
    account.ownedServers.mock.calls.length +
    account.alertSettings.mock.calls.length
  );
}

describe('site service: a window reload', () => {
  it('asks the site nothing new while the answers are fresh', async () => {
    const { service, fetch, account, tick } = build();
    await windowStart(service);
    const requests = fetch.mock.calls.length;
    const personal = accountCalls(account);
    for (let reload = 0; reload < 20; reload += 1) {
      tick(500);
      await windowStart(service);
    }
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(accountCalls(account)).toBe(personal);
  });

  it('twenty windows starting at once are one request per address', async () => {
    const { service, asked, account } = build();
    await Promise.all(Array.from({ length: 20 }, () => windowStart(service)));
    expect(asked().toSorted()).toEqual([...new Set(asked())].toSorted());
    expect(account.favorites).toHaveBeenCalledTimes(1);
  });

  it('past the term shows the old list at once, asks once and announces the change', async () => {
    let total = 0;
    const { service, changes, tick, asked } = build((path) =>
      path.startsWith('/servers')
        ? json({ ...LIST, meta: { ...LIST.meta, total: (total += 1) } }, 200, {
            'Cache-Control': 'max-age=20',
          })
        : siteRoute(path),
    );
    const query = { sort: 'rating' as const, page: 1, per_page: 50 };
    const first = await service.servers(query);
    tick(21_000);
    const [again, twice] = await Promise.all([service.servers(query), service.servers(query)]);
    expect(again).toEqual(first);
    expect(twice).toEqual(first);
    await flush();
    expect(asked()).toHaveLength(2);
    expect(changes).toEqual([{ topic: 'servers', query }]);
    const fresh = await service.servers(query);
    expect(fresh.ok && fresh.value.meta.total).toBe(2);
  });

  it('the next start shows what the disk kept before the site answers', async () => {
    const disk = new MemoryCache();
    const query = { sort: 'rating' as const, page: 1, per_page: 50 };
    const before = build(siteRoute, disk);
    await before.service.servers(query);
    const down = build(() => {
      throw new TypeError('offline');
    }, disk);
    down.tick(3_600_000);
    const shown = await down.service.servers(query);
    expect(shown).toMatchObject({ ok: true, stale: true, refreshing: true });
    await flush();
    expect(down.changes).toEqual([{ topic: 'servers', query }]);
    const after = await down.service.servers(query);
    expect(after).toMatchObject({ ok: true, stale: true });
    expect(after.ok && after.refreshing).toBeUndefined();
  });

  it('a signed-in player is not shown the guest card kept on disk', async () => {
    const card = (path: string): Response =>
      path === '/servers/7' ? json({}, 404) : siteRoute(path);
    const guestDisk = new MemoryCache();
    const guestReads = vi.spyOn(guestDisk, 'read');
    await build(card, guestDisk).service.server(7);
    expect(guestReads).toHaveBeenCalledTimes(2);
    const playerDisk = new MemoryCache();
    const playerReads = vi.spyOn(playerDisk, 'read');
    const player = build(card, playerDisk);
    player.signIn('token');
    await player.service.server(7);
    expect(playerReads).toHaveBeenCalledTimes(1);
    expect(player.asked()).toEqual(['/servers/7']);
  });

  it('a further page waits for the site instead of showing an old one', async () => {
    const { service, tick, asked } = build();
    const query = { sort: 'rating' as const, page: 2, per_page: 50 };
    await service.servers(query);
    tick(21_000);
    await service.servers(query);
    expect(asked()).toHaveLength(2);
  });
});

describe('site service: personal answers', () => {
  it('a favorite change rewrites the kept list from the answer of the site', async () => {
    const { service, account } = build();
    await service.favorites();
    await service.setFavorite(42, true);
    await service.setFavorite(3, false);
    expect(await service.favorites()).toEqual({ ok: true, value: [17, 42] });
    expect(account.favorites).toHaveBeenCalledTimes(1);
  });

  it('a refused favorite change leaves the kept list alone', async () => {
    const { service, account } = build();
    await service.favorites();
    account.setFavorite.mockResolvedValueOnce({ ok: false, error: { code: 'offline' } });
    await service.setFavorite(42, true);
    expect(await service.favorites()).toEqual({ ok: true, value: [3, 17] });
  });

  it('a vote makes the pauses and the card be asked again', async () => {
    const { service, account, asked } = build((path) =>
      path === '/servers/7' ? json({}, 404) : siteRoute(path),
    );
    await service.votePauses();
    await service.server(7);
    await service.vote(7, 'Steve');
    await service.votePauses();
    await service.server(7);
    expect(account.votePauses).toHaveBeenCalledTimes(2);
    expect(asked().filter((path) => path === '/servers/7')).toHaveLength(2);
  });

  it('saved alert settings are kept as answered', async () => {
    const { service, account } = build();
    const saved = { favorite_wipe: false, watched_up: true, server_removed: false };
    await service.alertSettings();
    await service.setAlertSettings(saved);
    expect(await service.alertSettings()).toEqual({ ok: true, value: saved });
    expect(account.alertSettings).toHaveBeenCalledTimes(1);
  });

  it('marking alerts read drops the kept feed', async () => {
    const { service, account } = build();
    await service.alerts();
    await service.readAlerts();
    await service.alerts();
    expect(account.alerts).toHaveBeenCalledTimes(2);
  });

  it('refreshes favorites behind the old list after a minute and announces the change', async () => {
    const { service, account, changes, tick } = build();
    await service.favorites();
    account.favorites.mockResolvedValue({ ok: true, value: [3] });
    tick(MINUTE + 1);
    expect(await service.favorites()).toEqual({ ok: true, value: [3, 17] });
    await flush();
    expect(changes).toEqual([{ topic: 'favorites' }]);
    expect(await service.favorites()).toEqual({ ok: true, value: [3] });
  });

  it.each(['signed-out', 'expired', 'signed-in'] as const)(
    '%s forgets everything personal and keeps the catalog',
    async (change) => {
      const { service, account, fetch, signal } = build();
      await windowStart(service);
      const requests = fetch.mock.calls.length;
      signal(change);
      await windowStart(service);
      expect(account.favorites).toHaveBeenCalledTimes(2);
      expect(account.alerts).toHaveBeenCalledTimes(2);
      expect(account.votePauses).toHaveBeenCalledTimes(2);
      expect(account.ownedServers).toHaveBeenCalledTimes(2);
      expect(account.alertSettings).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(requests);
    },
  );

  it('a profile refresh alone forgets nothing', async () => {
    const { service, account, signal } = build();
    await service.favorites();
    signal('changed');
    await service.favorites();
    expect(account.favorites).toHaveBeenCalledTimes(1);
  });

  it('a list read that left before a star was removed does not bring the server back', async () => {
    const { service, account, changes, tick } = build();
    await service.favorites();
    tick(MINUTE + 1);
    let land: (value: { ok: true; value: number[] }) => void = () => undefined;
    account.favorites.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );
    expect(await service.favorites()).toEqual({ ok: true, value: [3, 17] });
    await service.setFavorite(3, false);
    land({ ok: true, value: [3, 17] });
    await flush();
    expect(await service.favorites()).toEqual({ ok: true, value: [17] });
    expect(changes).toEqual([]);
  });

  it('a star set while the very first list is on its way makes the list be asked again', async () => {
    const { service, account } = build();
    let land: (value: { ok: true; value: number[] }) => void = () => undefined;
    account.favorites.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );
    const first = service.favorites();
    await flush();
    await service.setFavorite(42, true);
    land({ ok: true, value: [3, 17] });
    await first;
    account.favorites.mockResolvedValue({ ok: true, value: [3, 17, 42] });
    expect(await service.favorites()).toEqual({ ok: true, value: [3, 17, 42] });
    expect(account.favorites).toHaveBeenCalledTimes(2);
  });

  it('settings read before a save do not replace the saved ones', async () => {
    const { service, account, tick } = build();
    const saved = { favorite_wipe: false, watched_up: false, server_removed: false };
    const old = { favorite_wipe: true, watched_up: true, server_removed: true };
    await service.alertSettings();
    tick(10 * MINUTE);
    let land: (value: { ok: true; value: typeof old }) => void = () => undefined;
    account.alertSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );
    await service.alertSettings();
    await service.setAlertSettings(saved);
    land({ ok: true, value: old });
    await flush();
    expect(await service.alertSettings()).toEqual({ ok: true, value: saved });
  });

  it('a feed read while alerts are being marked read is not kept as the fresh one', async () => {
    const { service, account } = build();
    let done: (value: { ok: true; value: true }) => void = () => undefined;
    account.readAlerts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    await service.alerts();
    const marking = service.readAlerts();
    await service.alerts();
    done({ ok: true, value: true });
    await marking;
    await service.alerts();
    expect(account.alerts).toHaveBeenCalledTimes(3);
  });
});

describe('the last checks of catalog addresses', () => {
  const target = { ip: '203.0.113.5', port: 25570, checkedAt: '2026-10-14T09:00:00Z' };
  type Row = Parameters<PingTargets['remember']>[0][number];
  const rowAt = (host: string, port: number | null, pingTarget: typeof target | null): Row =>
    ({ address: { host, port }, pingTarget }) as Row;

  it('are found by the address as entered, and a row without a check forgets the old one', () => {
    const targets = new PingTargets();
    targets.remember([rowAt('srv.example.ru', null, target)]);
    expect(targets.of('srv.example.ru')).toEqual(target);
    expect(targets.of('srv.example.ru:25565')).toBeNull();
    targets.remember([rowAt('srv.example.ru', null, null)]);
    expect(targets.of('srv.example.ru')).toBeNull();
  });
});
