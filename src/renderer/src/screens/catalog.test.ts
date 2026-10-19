// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { favoriteIds, serverEntries } from '../mock/player';
import { topSlots, servers } from '../mock/servers';
import { mountScreen, openScreen as open, unmountScreen } from '../screen-testing';
import { stubLauncher } from '../testing';

afterEach(unmountScreen);

describe('catalog', () => {
  it('paid slots in a frame with a label and a link to the site', async () => {
    const { app, api } = await open('/servers');
    const block = app.find('.top-slots-block');
    expect(block.text()).toContain(ru.topSlots.block);
    expect(block.findAll('.srow.is-top-slot')).toHaveLength(
      topSlots.diamond.length + topSlots.gold.length,
    );
    await block.find('a').trigger('click');
    expect(api.openExternal).toHaveBeenCalledWith('https://mc-mon.ru/promote');
  });

  it("'License only' only on rows that reject nickname sign-in", async () => {
    const { app } = await open('/servers');
    const labelled = app
      .findAll('.rows .srow')
      .filter((row) => row.text().includes(ru.server.licenseOnly));
    expect(labelled.map((row) => row.find('.name').text())).toEqual(
      servers.filter((s) => !s.access.nick).map((s) => s.name),
    );
    expect(labelled.length).toBeGreaterThan(0);
  });

  it('an installed instance — a badge on the icon with a label, no text in chips', async () => {
    const { app } = await open('/servers');
    const installedIds = new Set(serverEntries.map((entry) => entry.serverId));
    const rows = app.findAll('.rows .srow');
    const badged = rows.filter((row) => row.find('.installed-badge').exists());
    expect(badged.map((row) => row.find('.name').text())).toEqual(
      servers.filter((s) => installedIds.has(s.id)).map((s) => s.name),
    );
    expect(badged[0]?.find('.installed-badge').attributes('title')).toBe(ru.server.installed);
    expect(badged[0]?.find('.sub').text()).not.toContain(ru.server.installed);
  });

  it("the # column — the site's rating on the 'Rating' tab, position on the others", async () => {
    const { app } = await open('/servers');
    const ranks = app.findAll('.srow:not(.is-top-slot) .rank').map((item) => item.text());
    expect(ranks).toEqual(
      servers.map((server) => (server.rank === null ? '' : String(server.rank))),
    );
    const online = app.findAll('[role="tab"]').find((tab) => tab.text() === ru.catalog.tabOnline);
    await online?.trigger('click');
    expect(app.find('.srow:not(.is-top-slot) .rank').text()).toBe('1');
  });

  it("an unstable server gets the neutral 'often down' tag in the row", async () => {
    const { app } = await open('/servers');
    const unstableServer = servers.find((server) => server.unstable);
    expect(unstableServer).not.toBeUndefined();
    const row = app
      .findAll('.rows .srow')
      .find((item) => item.find('.name').text() === unstableServer?.name);
    expect(row?.text()).toContain(ru.server.unstableTag);
    const rankless = servers.find((server) => server.rank === null);
    expect(rankless?.unstable).toBe(true);
    const rowRankless = app
      .findAll('.rows .srow')
      .find((item) => item.find('.name').text() === rankless?.name);
    expect(rowRankless?.find('.rank').text()).toBe('');
    expect(rowRankless?.text()).toContain(ru.server.unstableTag);
  });

  it('without a connection and without a cached copy — an error block instead of an empty table', async () => {
    const mounted = await mountScreen('/servers', { stub: stubLauncher(), demo: false });
    const { app } = mounted;
    expect(app.find('[role="alert"]').text()).toContain(ru.state.offlineTitle);
    expect(app.find('.table-head').exists()).toBe(false);
    expect(app.find('.footnote').exists()).toBe(false);
  });

  it('rows show the score instead of ping, the header sits above the paid slots', async () => {
    const { app } = await open('/servers');
    const rows = app.findAll('.srow');
    expect(rows.every((row) => row.find('.score').exists())).toBe(true);
    expect(app.find('.srow .ping').exists()).toBe(false);
    const head = app.find('.table-head');
    expect(head.text()).toContain(ru.catalog.columnScore);
    expect(head.element.compareDocumentPosition(app.find('.top-slots-block').element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('paid slots stay on the rating and online tabs only', async () => {
    const { app } = await open('/servers');
    const shown: Record<string, boolean> = {};
    for (const name of ['online', 'new', 'favorites', 'rating']) {
      await app.find(`[data-tab="${name}"]`).trigger('click');
      await flushPromises();
      shown[name] = app.find('.top-slots-block').exists();
    }
    expect(shown).toEqual({ online: true, new: false, favorites: false, rating: true });
  });

  it('a favorite server page highlights the favorite, not the servers section', async () => {
    const { app } = await open(`/server/${String(favoriteIds[0])}`);
    expect(app.find('.favorite.is-active').exists()).toBe(true);
    expect(app.find('.nav-link.is-active').exists()).toBe(false);
  });

  it("the 'Favorites' tab leaves only favorites", async () => {
    const { app } = await open('/servers');
    const tab = app
      .findAll('[role="tab"]')
      .find((item) => item.text().startsWith(ru.catalog.tabFavorites));
    await tab?.trigger('click');
    expect(app.findAll('.srow:not(.is-top-slot)')).toHaveLength(favoriteIds.length);
  });

  it("an empty result — what was not found, 'Reset filters' brings the list back", async () => {
    const { app, router } = await open('/servers');
    await router.push({ path: '/servers', query: { q: 'нет-такого-сервера' } });
    await flushPromises();
    expect(app.findAll('.srow:not(.is-top-slot)')).toHaveLength(0);
    expect(app.find('.state').text()).toContain(
      fill(ru.catalog.emptySearch, { query: 'нет-такого-сервера' }),
    );
    const reset = app.findAll('button').find((item) => item.text() === ru.catalog.resetFilters);
    expect(reset).toBeDefined();
    await reset?.trigger('click');
    await flushPromises();
    expect(app.find<HTMLInputElement>('.search input').element.value).toBe('');
    expect(app.findAll('.srow:not(.is-top-slot)')).toHaveLength(servers.length);
    expect(app.find('.footnote').exists()).toBe(true);
    expect(app.findAll('button').some((item) => item.text() === ru.catalog.resetFilters)).toBe(
      false,
    );
  });

  it('searching by name leaves the matching server', async () => {
    const { app, router } = await open('/servers');
    await router.push({ path: '/servers', query: { q: 'Пустошь' } });
    await flushPromises();
    expect(app.findAll('.srow:not(.is-top-slot)')).toHaveLength(1);
  });

  it('from an empty catalog a link leads to adding the server on the site', async () => {
    const { app, router } = await open('/servers');
    await router.push({ path: '/servers', query: { q: 'zzqqxx' } });
    await flushPromises();
    const link = app
      .find('.state')
      .findAll('a')
      .find((item) => item.text() === ru.catalog.emptyHint);
    expect(link?.attributes('href')).toBe('https://mc-mon.ru/add');
  });
});
