// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerList, ServerRow } from '@shared/catalog';
import type { Scene } from '@shared/scenes';
import type { SiteResult, SiteService } from '@shared/site';
import { contextOf, stubLauncher } from '../testing';
import type { LauncherContext } from './context';
import { createCatalog } from './useCatalog';
import { BUILTIN_SCENE, STAND_IN_AFTER_MS } from '../lib/builtin-scene';
import { createScenes } from './useScenes';
import { createSite } from './useSite';

const AT = '2026-10-03T12:00:00Z';

function row(id: number, patch: Partial<ServerRow> = {}): ServerRow {
  return {
    id,
    slug: `s${String(id)}`,
    name: `Сервер ${String(id)}`,
    address: { host: `play${String(id)}.example.ru`, port: null },
    edition: 'java',
    description: '',
    tags: [],
    versions: null,
    status: 'online',
    online: 10,
    max_players: null,
    rank: id,
    points: 0,
    unstable: false,
    weekly_trend: 0,
    votes_month: 0,
    icon_url: null,
    cover: { scene: 'taiga', time: 'auto' },
    access: { license: true, nick: true },
    is_verified: false,
    wipe_label: null,
    topSlot: null,
    launch: { kind: 'direct', minecraft: '1.21.11' },
    site_url: '',
    ...patch,
  };
}

function ok<T>(value: T, stale = false): Promise<SiteResult<T>> {
  return Promise.resolve({ ok: true, value, stale, fetchedAt: AT });
}

function list(rows: ServerRow[], page = 1, total = rows.length): ServerList {
  return {
    data: rows,
    topSlots: { diamond: [], gold: [] },
    topSlotsFree: { diamond: 0, gold: 0 },
    meta: { page, per_page: 50, total, online_total: 1000, updated_at: AT },
  };
}

function context(site: Partial<SiteService>): LauncherContext {
  const stub = stubLauncher();
  Object.assign(stub.api.site, site);
  return contextOf(stub, () => new Date(AT));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('catalog from the site', () => {
  it('loading, online count and time from meta, pages get appended', async () => {
    const servers = vi.fn((query: { page?: number }) =>
      ok(query.page === 2 ? list([row(3)], 2, 3) : list([row(1), row(2)], 1, 3)),
    );
    const catalog = createCatalog(context({ servers }));
    expect(catalog.status.value).toBe('loading');
    await catalog.load();
    expect(catalog.status.value).toBe('ready');
    expect(catalog.online.value).toBe(1000);
    expect(catalog.hasMore.value).toBe(true);
    await catalog.more();
    expect(catalog.servers.value.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(servers).toHaveBeenLastCalledWith({ sort: 'rating', page: 2, per_page: 50 });
  });

  it('stale and error are distinguished', async () => {
    const stale = createCatalog(context({ servers: () => ok(list([row(1)]), true) }));
    await stale.load();
    expect(stale.stale.value).toBe(true);
    expect(stale.fetchedAt.value).toBe(AT);
    const failed = createCatalog(context({}));
    await failed.load();
    expect(failed.status.value).toBe('error');
    expect(failed.error.value).toEqual({ code: 'offline' });
  });

  it('search and sort are sent to the site', async () => {
    const servers = vi.fn(() => ok(list([row(1)])));
    const catalog = createCatalog(context({ servers }));
    await catalog.setQuery({ q: 'sky', sort: 'growth' });
    expect(servers).toHaveBeenLastCalledWith({ sort: 'growth', page: 1, per_page: 50, q: 'sky' });
  });

  it("'Show more' during a new request does not append it to the old list", async () => {
    let release: () => void = () => undefined;
    const servers = vi.fn((query: { q?: string; page?: number }) => {
      if (query.q === undefined) {
        return ok(list([row(1), row(2)], 1, 3));
      }
      return new Promise<SiteResult<ServerList>>((resolve) => {
        release = (): void => {
          resolve({ ok: true, value: list([row(7)], 1, 2), stale: false, fetchedAt: AT });
        };
      });
    });
    const catalog = createCatalog(context({ servers }));
    await catalog.load();
    const searching = catalog.setQuery({ q: 'sky' });
    await catalog.more();
    expect(servers).toHaveBeenCalledTimes(2);
    release();
    await searching;
    expect(catalog.servers.value.map((item) => item.id)).toEqual([7]);
    expect(catalog.listQuery.value).toEqual({ q: 'sky', sort: 'rating' });
  });

  it("popular: a repeat request's error does not remove the previous response", async () => {
    let up = true;
    const servers = vi.fn(() =>
      up
        ? ok(list([row(4), row(5)]))
        : Promise.resolve({ ok: false as const, error: { code: 'offline' as const } }),
    );
    const catalog = createCatalog(context({ servers }));
    await catalog.loadPopular();
    up = false;
    await catalog.loadPopular();
    expect(catalog.popular.value.map((item) => item.id)).toEqual([4, 5]);
  });

  it('card: not on the site and no network — different states', async () => {
    const missing = createCatalog(
      context({ server: () => Promise.resolve({ ok: false, error: { code: 'not-found' } }) }),
    );
    expect(await missing.loadCard(9)).toEqual({ status: 'missing' });
    const offline = createCatalog(context({}));
    expect(await offline.loadCard(9)).toMatchObject({ status: 'error' });
  });

  it('live updates the online count of known servers', async () => {
    const catalog = createCatalog(
      context({
        servers: () => ok(list([row(1)])),
        live: () => ok([{ id: 1, online: 77, max: 100, up: false, at: AT }]),
      }),
    );
    await catalog.load();
    await catalog.refreshLive([1, 999]);
    expect(catalog.server(1)).toMatchObject({ online: 77, max_players: 100, status: 'offline' });
  });

  it("ping from the player's computer via main, no more than once every 20 s", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.parse(AT);
    vi.setSystemTime(start);
    const ping = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { ms: 35, online: 1, max: 2 },
      }),
    );
    const catalog = createCatalog(context({ servers: () => ok(list([row(1)])), ping }));
    await catalog.load();
    expect(catalog.ping(1)).toEqual({ ms: null });
    await flushPromises();
    expect(catalog.ping(1)).toEqual({ ms: 35 });
    expect(ping).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledWith('play1.example.ru');
    vi.setSystemTime(start + 19_999);
    catalog.ping(1);
    expect(ping).toHaveBeenCalledTimes(1);
    vi.setSystemTime(start + 20_000);
    catalog.ping(1);
    expect(ping).toHaveBeenCalledTimes(2);
  });
});

describe('scenes from the site', () => {
  const taiga: Scene = {
    key: 'taiga',
    name: 'Тайга',
    pack: 'nature',
    purpose: 'library',
    focus: 0.5,
    skies: { day: '#4f86cc', sunset: '#22265e', night: '#01030c' },
    layers: {
      day: [{ name: 'sky', depth: 0 }],
      sunset: [{ name: 'sky', depth: 0 }],
      night: [{ name: 'sky', depth: 0 }],
    },
  };

  it('while a layer is not downloaded — an empty address (sky color), then app:// from the cache', async () => {
    const ensureScene = vi.fn(() =>
      ok({ layers: { sky: 'app://launcher/cache/landscapes/taiga-day/sky.png' }, thumb: null }),
    );
    const scenes = createScenes(context({ scenes: () => ok([taiga]), ensureScene }));
    await scenes.load();
    expect(scenes.scene('taiga')?.key).toBe('taiga');
    const base = scenes.base as (ref: { scene: string; time: 'day'; layer: string }) => string;
    expect(base({ scene: 'taiga', time: 'day', layer: 'sky' })).toBe('');
    await flushPromises();
    expect(base({ scene: 'taiga', time: 'day', layer: 'sky' })).toBe(
      'app://launcher/cache/landscapes/taiga-day/sky.png',
    );
    expect(ensureScene).toHaveBeenCalledTimes(1);
  });

  it('a layer after a failure: not on every render, with a pause of at least 30 s and by online count', async () => {
    vi.useFakeTimers();
    let online = false;
    const layers = { sky: 'app://launcher/cache/landscapes/taiga-day/sky.png' };
    const ensureScene = vi.fn(() =>
      online
        ? ok({ layers, thumb: null })
        : Promise.resolve({ ok: false as const, error: { code: 'offline' as const } }),
    );
    const scenes = createScenes(context({ scenes: () => ok([taiga]), ensureScene }));
    await scenes.load();
    const sky = { scene: 'taiga', time: 'day' as const, layer: 'sky' };
    const base = scenes.base as (ref: typeof sky) => string;
    base(sky);
    await flushPromises();
    expect(ensureScene).toHaveBeenCalledTimes(1);
    base(sky);
    base(sky);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(ensureScene).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ensureScene).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ensureScene).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ensureScene).toHaveBeenCalledTimes(3);
    online = true;
    window.dispatchEvent(new Event('online'));
    await flushPromises();
    expect(ensureScene).toHaveBeenCalledTimes(4);
    expect(base(sky)).toBe(layers.sky);
  });

  it('without network it retries loading scenes until it succeeds', async () => {
    vi.useFakeTimers();
    let online = false;
    const scenesCall = vi.fn(() =>
      Promise.resolve(online ? ok([taiga]) : ({ ok: false, error: { code: 'offline' } } as const)),
    );
    const scenes = createScenes(context({ scenes: scenesCall }));
    await scenes.load();
    expect(scenes.status.value).toBe('error');
    online = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scenesCall).toHaveBeenCalledTimes(2);
    expect(scenes.status.value).toBe('ready');
    expect(scenes.scene('taiga')?.key).toBe('taiga');
  });

  const silent = (): Promise<SiteResult<Scene[]>> => new Promise(() => undefined);
  const sky = { scene: 'builtin', time: 'day' as const, layer: 'sky' };

  it('no scenes and a silent site: the built-in scene stands in after a short wait', async () => {
    vi.useFakeTimers();
    const scenes = createScenes(context({ scenes: silent }));
    void scenes.load();
    expect(scenes.sceneFor('welcome')).toBeUndefined();
    expect(scenes.scene('taiga')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(STAND_IN_AFTER_MS - 1);
    expect(scenes.sceneFor('pulse')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(scenes.sceneFor('pulse')).toEqual({ scene: BUILTIN_SCENE, time: 'day', holiday: false });
    expect(scenes.sceneFor('waiting')?.scene.key).toBe('builtin');
    expect(scenes.scene('taiga')).toBe(BUILTIN_SCENE);
    const base = scenes.base as (ref: typeof sky) => string;
    expect(base(sky)).toMatch(/sky.*\.png$/);
    expect(
      BUILTIN_SCENE.layers.day.every((layer) => base({ ...sky, layer: layer.name }) !== ''),
    ).toBe(true);
    scenes.dispose();
  });

  it('a failed request brings the built-in scene at once, and the real one replaces it later', async () => {
    vi.useFakeTimers();
    let online = false;
    const scenesCall = vi.fn(() =>
      Promise.resolve(online ? ok([taiga]) : ({ ok: false, error: { code: 'offline' } } as const)),
    );
    const scenes = createScenes(context({ scenes: scenesCall }));
    await scenes.load();
    expect(scenes.scene('taiga')).toBe(BUILTIN_SCENE);
    online = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scenes.scene('taiga')).toBe(taiga);
    expect(scenes.scene('unknown')).toBeUndefined();
    expect(scenes.sceneFor('pulse')).toBeUndefined();
  });

  it('scenes that come in time never give way to the built-in one', async () => {
    vi.useFakeTimers();
    const scenes = createScenes(context({ scenes: () => ok([taiga]) }));
    const seen: (string | undefined)[] = [scenes.scene('taiga')?.key];
    await scenes.load();
    seen.push(scenes.scene('taiga')?.key);
    await vi.advanceTimersByTimeAsync(60_000);
    seen.push(scenes.scene('taiga')?.key, scenes.scene('other')?.key);
    expect(seen).toEqual([undefined, 'taiga', 'taiga', undefined]);
  });

  it('dispose clears pending retries', async () => {
    vi.useFakeTimers();
    const scenesCall = vi.fn(() =>
      Promise.resolve({ ok: false, error: { code: 'offline' } } as const),
    );
    const scenes = createScenes(context({ scenes: scenesCall }));
    await scenes.load();
    expect(vi.getTimerCount()).toBe(1);
    scenes.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scenesCall).toHaveBeenCalledTimes(1);
    await scenes.load();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('site links', () => {
  it('from /meta, with fallbacks to the official domain', async () => {
    const site = createSite(
      context({
        meta: () =>
          ok({
            links: { terms: 'https://mc-mon.ru/legal/terms' },
            connect: null,
            reportReasons: [{ code: 'other', label: 'Другое' }],
          }),
      }),
    );
    expect(site.links.value.terms).toBe('https://mc-mon.ru/terms');
    expect(site.links.value.logins).toBe('https://mc-mon.ru/settings/logins');
    expect(site.reportReasons.value).toEqual([]);
    expect(await site.load()).toBeNull();
    expect(site.links.value.terms).toBe('https://mc-mon.ru/legal/terms');
    expect(site.links.value.privacy).toBe('https://mc-mon.ru/privacy');
    expect(site.reportReasons.value).toEqual([{ code: 'other', label: 'Другое' }]);
  });

  it('load reports an error and can re-ask /meta bypassing the cache', async () => {
    const meta = vi.fn((revalidate?: boolean) =>
      revalidate === true
        ? ok({
            links: { logins: 'https://mc-mon.ru/account/logins' },
            connect: null,
            reportReasons: [],
          })
        : Promise.resolve({ ok: false as const, error: { code: 'timeout' as const } }),
    );
    const site = createSite(context({ meta }));
    expect(await site.load()).toEqual({ code: 'timeout' });
    expect(site.links.value.logins).toBe('https://mc-mon.ru/settings/logins');
    expect(await site.load(true)).toBeNull();
    expect(meta).toHaveBeenLastCalledWith(true);
    expect(site.links.value.logins).toBe('https://mc-mon.ru/account/logins');
  });
});
