// @vitest-environment happy-dom
import { flushPromises, type DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerInstanceInfo } from '@shared/instance';
import { compactCount, countOf, fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { topSlots, catalog, findServer, SERVER_IDS, votesTop } from '../mock/servers';
import {
  answer,
  byOnline,
  fullCatalog,
  liveSite,
  listCalls,
  listOf,
  mountScreen,
  ONLINE_TOTAL,
  openLive,
  openScreen as open,
  serverName,
  SITE_DOWN,
  topServer,
  unmountScreen,
} from '../screen-testing';
import { stubLauncher, TEST_NOW } from '../testing';

afterEach(unmountScreen);

describe('home screen', () => {
  it('greeting by Moscow time from context', async () => {
    const { app } = await open('/');
    expect(app.find('h1').text()).toBe(fill(ru.time.greetingDay, { name: 'Frostbyte' }));
  });

  it('without a game account the greeting has no comma and no name', async () => {
    const mounted = await mountScreen('/', { demo: false });
    expect(mounted.app.find('h1').text()).toBe(ru.time.greetingPlain.day);
  });

  it('continue, three favorites, a paid slot', async () => {
    const { app } = await open('/');
    expect(app.find('.hero').text()).toContain(serverName(SERVER_IDS.northernEdge));
    expect(app.find('.top-hero').exists()).toBe(false);
    expect(app.text()).toContain(ru.home.favorites);
    expect(app.text()).not.toContain(ru.home.popular);
    expect(app.findAll('.card')).toHaveLength(3);
    const topSlot = [...topSlots.diamond, ...topSlots.gold]
      .filter((server) => server.id !== SERVER_IDS.northernEdge)
      .toSorted((a, b) => a.online - b.online)[0];
    expect(app.find('.top-slot').text()).toContain(topSlot?.name);
  });

  it('in a favorites card — a single fact line, no news feed', async () => {
    const { app } = await open('/');
    const cards = app.findAll('.card');
    const emerald = cards.find((card) =>
      card.text().includes(serverName(SERVER_IDS.emeraldValley)),
    );
    expect(emerald?.find('[data-fact]').text()).toBe('Вайп через 2 дня');
    expect(emerald?.find('.tagline').text()).not.toContain('вайп');
    const others = cards.filter((card) => card !== emerald);
    expect(others.every((card) => !card.find('[data-fact]').exists())).toBe(true);
  });

  it("an on-disk instance older than the catalog — 'will update on join', a wipe outranks it", async () => {
    const stub = stubLauncher();
    const folder = (serverId: number, minecraft: string): ServerInstanceInfo => ({
      folderId: `server-${String(serverId)}`,
      serverId,
      sizeBytes: 0,
      lastPlayedAt: null,
      installed: { minecraft, loader: { kind: 'vanilla', version: null } },
    });
    stub.api.instances.list = (): ReturnType<typeof stub.api.instances.list> =>
      Promise.resolve({
        ok: true,
        value: [folder(SERVER_IDS.pixelCity, '26.1'), folder(SERVER_IDS.emeraldValley, '1.20')],
      });
    const { app } = await open('/', stub);
    const card = (id: number): DOMWrapper<Element> | undefined =>
      app.findAll('.card').find((item) => item.text().includes(serverName(id)));
    expect(card(SERVER_IDS.pixelCity)?.find('[data-fact]').text()).toBe(ru.home.factUpdate);
    expect(card(SERVER_IDS.emeraldValley)?.find('[data-fact]').text()).toBe('Вайп через 2 дня');
  });

  it('without history or favorites: top server, paid slot, popular', async () => {
    const { app } = await openLive();
    const hero = app.find('.top-hero');
    expect(hero.find('h2').text()).toBe(topServer?.name);
    expect(hero.text()).toContain(ru.home.topEyebrow);
    expect(hero.find('.landscape').attributes('data-scene')).toBe(
      `${String(topServer?.cover.scene)}-${String(topServer?.cover.time)}`,
    );
    expect(hero.find('.landscape').attributes('data-motion')).toBe('parallax');
    expect(hero.find('[data-launch]').exists()).toBe(true);
    expect(app.findAll('[data-motion="parallax"]')).toHaveLength(1);
    const topSlot = [...topSlots.diamond, ...topSlots.gold]
      .filter((server) => server.id !== topServer?.id)
      .toSorted((a, b) => a.online - b.online)[0];
    expect(app.find('.top-slot').text()).toContain(topSlot?.name);
    const popular = votesTop
      .filter((server) => server.id !== topServer?.id && server.id !== topSlot?.id)
      .slice(0, 3);
    const cards = app.findAll('.card h3').map((title) => title.text());
    expect(cards).toEqual(popular.map((server) => server.name));
    expect(app.findAll('.card .score .score-value').map((line) => line.text())).toEqual(
      popular.map((server) => compactCount(server.points + server.votes_month)),
    );
    expect(app.text()).toContain(ru.home.popular);
    expect(app.text()).not.toContain(ru.home.favorites);
  });

  it('without favorites under the greeting — catalog servers and players', async () => {
    const { app } = await openLive();
    expect(app.find('.greeting .summary').text()).toBe(
      fill(ru.home.catalogOnline, {
        servers: countOf(catalog.meta.total, ru.plural.servers),
        players: countOf(ONLINE_TOTAL, ru.plural.players),
      }),
    );
    expect(app.text()).not.toContain(fill(ru.home.favoritesOnline, { count: '' }).trim());
    expect(app.find('.greeting .landscape').exists()).toBe(false);
  });

  it('with favorites and no history: a favorites section, a line about favorites', async () => {
    const favorite = byOnline[5];
    if (favorite === undefined) {
      throw new Error('mock server missing');
    }
    localStorage.setItem('mcmonitor.favorites', JSON.stringify([favorite.id]));
    const { app } = await openLive();
    expect(app.find('.top-hero h2').text()).toBe(topServer?.name);
    expect(app.text()).toContain(ru.home.favorites);
    expect(app.text()).not.toContain(ru.home.popular);
    expect(app.findAll('.card h3').map((title) => title.text())).toEqual([favorite.name]);
    expect(app.find('.greeting .lx-sub').text()).toBe(
      fill(ru.home.favoritesOnline, { count: countOf(favorite.online, ru.plural.players) }),
    );
  });

  it("no connection to the site — a banner with the cached copy's time", async () => {
    const { app } = await openLive(liveSite(true));
    expect(app.find('.stale-note[role="status"] .text').text()).toBe(
      fill(ru.state.stale, { time: '15:00' }),
    );
    expect(app.find('.top-hero').exists()).toBe(true);
  });

  it('the site is unavailable — an error with retry, without a hero or cards', async () => {
    const stub = stubLauncher();
    const { app } = await openLive(stub);
    const alert = app.find('[role="alert"]');
    expect(alert.text()).toContain(ru.state.offlineTitle);
    expect(app.find('.top-hero').exists()).toBe(false);
    expect(app.findAll('.card')).toHaveLength(0);
    const before = listCalls(stub).length;
    await alert.find('button').trigger('click');
    expect(listCalls(stub)).toHaveLength(before + 1);
  });

  it('popular by votes: a separate sort=votes request, order is not by online count', async () => {
    const stub = liveSite();
    const { app } = await openLive(stub);
    expect(vi.mocked(stub.api.site.servers)).toHaveBeenCalledWith({
      sort: 'votes',
      page: 1,
      per_page: 6,
    });
    const cards = app.findAll('.card h3').map((title) => title.text());
    const byVotes = votesTop.map((server) => server.name);
    expect(cards).toEqual(byVotes.filter((name) => cards.includes(name)));
    expect(cards).not.toEqual(byOnline.map((server) => server.name).slice(1, 4));
  });

  it('the popular request failed — no block, the rest of the home screen is in place', async () => {
    const stub = liveSite(false, (query) => (query.sort === 'votes' ? SITE_DOWN : undefined));
    const { app } = await openLive(stub);
    expect(app.find('.top-hero h2').text()).toBe(topServer?.name);
    expect(app.text()).not.toContain(ru.home.popular);
    expect(app.findAll('.card')).toHaveLength(0);
  });

  it("search on 'Servers' → home screen: loading until its own list arrives", async () => {
    const harbor = findServer(SERVER_IDS.quietHarbor);
    if (harbor === undefined) {
      throw new Error('mock server missing');
    }
    const pending: (() => void)[] = [];
    const stub = liveSite(false, (query) => {
      if (query.q !== undefined) {
        return answer(listOf([harbor]));
      }
      if (query.sort === 'online') {
        return new Promise((resolve) => {
          pending.push(() => {
            resolve({
              ok: true,
              value: fullCatalog,
              stale: false,
              fetchedAt: TEST_NOW.toISOString(),
            });
          });
        });
      }
      return undefined;
    });
    const mounted = await mountScreen('/servers?q=Гавань', { stub, demo: false });
    const { app, router } = mounted;
    expect(app.findAll('.srow:not(.is-top-slot)').map((row) => row.find('.name').text())).toEqual([
      harbor.name,
    ]);
    await router.push('/');
    await flushPromises();
    expect(listCalls(stub).at(-1)).toEqual({ sort: 'online', page: 1, per_page: 50 });
    expect(app.find('.skeleton[role="status"]').attributes('aria-label')).toBe(ru.state.loading);
    expect(app.find('.top-hero').exists()).toBe(false);
    expect(app.text()).not.toContain(harbor.name);
    expect(app.text()).not.toContain(ru.home.popular);
    for (const release of pending) {
      release();
    }
    await flushPromises();
    expect(app.find('.skeleton').exists()).toBe(false);
    expect(app.find('.top-hero h2').text()).toBe(topServer?.name);
    expect(app.text()).toContain(ru.home.popular);
  });

  it("search on 'Servers' → home screen without a connection: an error, without a hero from search", async () => {
    const harbor = findServer(SERVER_IDS.quietHarbor);
    const stub = liveSite(false, (query) => {
      if (query.q !== undefined) {
        return answer(listOf(harbor === undefined ? [] : [harbor]));
      }
      return query.sort === 'online' ? SITE_DOWN : undefined;
    });
    const mounted = await mountScreen('/servers?q=Гавань', { stub, demo: false });
    await mounted.router.push('/');
    await flushPromises();
    const { app } = mounted;
    expect(app.find('[role="alert"]').text()).toContain(ru.state.offlineTitle);
    expect(app.find('.top-hero').exists()).toBe(false);
    expect(app.find('.top-slot').exists()).toBe(false);
    expect(app.text()).not.toContain(harbor?.name);
  });

  it("home screen: without 'Pulse', only the hero's cover is alive", async () => {
    const { app } = await open('/');
    expect(app.find('.hero .landscape').attributes('data-motion')).toBe('parallax');
  });
});
