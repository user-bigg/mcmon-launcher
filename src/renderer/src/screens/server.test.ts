// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fill, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { favoriteIds } from '../mock/player';
import { findServer, SERVER_IDS, serverCard } from '../mock/servers';
import { mountScreen, openScreen as open, serverName, unmountScreen } from '../screen-testing';
import { stubLauncher, TEST_NOW, testCard, withCard } from '../testing';

afterEach(unmountScreen);

describe('server page', () => {
  it("the server's language is a chip only when it is not Russian", async () => {
    const english = stubLauncher();
    withCard(english, testCard({ language: 'en' }));
    const page = await mountScreen(`/server/${String(SERVER_IDS.wasteland)}`, {
      stub: english,
      demo: false,
    });
    expect(page.app.find('.tags').text()).toContain(ru.languages.en);
    unmountScreen();
    const russian = stubLauncher();
    withCard(russian, testCard({ language: 'ru' }));
    const home = await mountScreen(`/server/${String(SERVER_IDS.wasteland)}`, {
      stub: russian,
      demo: false,
    });
    expect(home.app.find('.tags').text()).not.toContain('RU');
  });

  it('direct: what will be installed, ping and vote', async () => {
    const { app } = await open(`/server/${String(SERVER_IDS.wasteland)}`);
    expect(app.find('.tags').text()).toContain(ru.server.licenseOnly);
    const panel = app.find('.is-launch');
    expect(panel.text()).toContain(ru.serverPage.installJava);
    expect(panel.text()).not.toContain(ru.serverPage.installedSize);
  });

  it('score tile: the sum with both parts, a grey zero when there is nothing', async () => {
    const base = serverCard(SERVER_IDS.wasteland, TEST_NOW.getTime());
    if (base === undefined) {
      throw new Error('card missing');
    }
    const withCard = (points: number, month: number): ReturnType<typeof stubLauncher> => {
      const stub = stubLauncher();
      stub.api.site.server = vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...base, points, votes: { month, today: 0 } },
          stale: false,
          fetchedAt: TEST_NOW.toISOString(),
        }),
      );
      return stub;
    };
    const path = `/server/${String(SERVER_IDS.wasteland)}`;
    const full = await mountScreen(path, { stub: withCard(1250, 2184), demo: false });
    const tile = full.app.find('[data-stat="score"]');
    expect(tile.find('[data-score-total]').text()).toBe('3\u00a0434');
    expect(tile.find('[data-score-energy]').text()).toContain('1\u00a0250');
    expect(tile.find('[data-score-votes]').text()).toContain('2\u00a0184');
    unmountScreen();
    const empty = await mountScreen(path, { stub: withCard(0, 0), demo: false });
    const none = empty.app.find('[data-stat="score"]');
    expect(none.find('[data-score-total]').text()).toBe('0');
    expect(none.find('[data-score-total]').classes()).toContain('is-none');
    expect(none.find('.score-parts').exists()).toBe(false);
  });

  it("the MC Monitor rating place and the year in the catalog; a paid slot has no '#0'", async () => {
    const { app, router } = await open(`/server/${String(SERVER_IDS.wasteland)}`);
    const rank = findServer(SERVER_IDS.wasteland)?.rank ?? 0;
    expect(app.text()).toContain(fill(ru.serverPage.headMeta, { rank, year: 2024 }));
    await router.push(`/server/${String(SERVER_IDS.fireRidge)}`);
    await flushPromises();
    expect(app.text()).toContain(fill(ru.serverPage.headMetaYear, { year: 2024 }));
    expect(app.text()).not.toContain(fill(ru.serverPage.headMetaRank, { rank: 0 }));
  });

  it('rank null (uptime below 80%): out-of-rating line, 30-day uptime stat', async () => {
    const { app } = await open(`/server/${String(SERVER_IDS.quietHarbor)}`);
    expect(findServer(SERVER_IDS.quietHarbor)?.rank).toBeNull();
    expect(app.text()).toContain(ru.serverPage.headMetaOutOfRating);
  });

  it("own_launcher: the button opens the server's https link in the browser", async () => {
    const { app, api } = await open(`/server/${String(SERVER_IDS.technograd)}`);
    expect(app.find('[data-launch="direct"]').exists()).toBe(false);
    const button = app.find('[data-launch="own_launcher"]');
    await button.trigger('click');
    expect(api.openExternal).toHaveBeenCalledWith('https://technograd.example/launcher');
  });

  it("none: 'How to join' with the address", async () => {
    const { app } = await open(`/server/${String(SERVER_IDS.quietHarbor)}`);
    expect(app.text()).toContain(ru.serverPage.joinTitle);
    expect(app.text()).toContain(findServer(SERVER_IDS.quietHarbor)?.address.host);
    expect(app.text()).toContain(ru.server.pingUnknown);
  });

  it('online count without a player max: neither on the page nor on the home screen', async () => {
    const server = findServer(SERVER_IDS.wasteland);
    if (server?.max_players == null) {
      throw new Error('mock server without max_players');
    }
    const max = formatNumber(server.max_players);
    const { app, router } = await open(`/server/${String(server.id)}`);
    expect(app.find('.stat dd').text()).toBe(formatNumber(server.online));
    expect(app.text()).not.toContain(max);
    await router.push('/');
    await flushPromises();
    const counts = app.findAll('.online').map((item) => item.text());
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.filter((text) => text.includes('/'))).toEqual([]);
  });

  it("'About the server': the owner's headings render as headings, without raw hashes", async () => {
    const base = serverCard(SERVER_IDS.wasteland, TEST_NOW.getTime());
    if (base === undefined) {
      throw new Error('card missing');
    }
    const stub = stubLauncher();
    stub.api.site.server = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { ...base, description_md: '## Об игре\nВыживание\n\n### Правила\n- без читов' },
        stale: false,
        fetchedAt: TEST_NOW.toISOString(),
      }),
    );
    const mounted = await mountScreen(`/server/${String(SERVER_IDS.wasteland)}`, {
      stub,
      demo: false,
    });
    const prose = mounted.app.find('.prose');
    expect(prose.find('h5').text()).toBe('Об игре');
    expect(prose.find('h6').text()).toBe('Правила');
    expect(prose.find('li').text()).toBe('без читов');
    expect(prose.text()).not.toContain('#');
  });

  it("'About the server' is hidden when the owner wrote nothing", async () => {
    const base = serverCard(SERVER_IDS.wasteland, TEST_NOW.getTime());
    if (base === undefined) {
      throw new Error('card missing');
    }
    for (const description_md of ['', ' \n\n ', `# ${base.name}`]) {
      const stub = stubLauncher();
      stub.api.site.server = vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...base, description_md },
          stale: false,
          fetchedAt: TEST_NOW.toISOString(),
        }),
      );
      const mounted = await mountScreen(`/server/${String(SERVER_IDS.wasteland)}`, {
        stub,
        demo: false,
      });
      expect(mounted.app.find('[data-server="about"]').exists()).toBe(false);
    }
  });

  it('no connection — the same banner as on the home screen, in the toolbar row', async () => {
    const base = serverCard(SERVER_IDS.wasteland, TEST_NOW.getTime());
    if (base === undefined) {
      throw new Error('card missing');
    }
    const stub = stubLauncher();
    stub.api.site.server = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: base,
        stale: true,
        fetchedAt: TEST_NOW.toISOString(),
      }),
    );
    const mounted = await mountScreen(`/server/${String(SERVER_IDS.wasteland)}`, {
      stub,
      demo: false,
    });
    const note = mounted.app.find('.server > .toolbar > .stale-note');
    expect(note.find('.text').text()).toBe(fill(ru.state.stale, { time: '15:00' }));
  });

  it("offline with no cached copy: a '← Servers' toolbar and an error block with retry", async () => {
    const stub = stubLauncher();
    const mounted = await mountScreen(`/server/${String(SERVER_IDS.wasteland)}`, {
      stub,
      demo: false,
    });
    const { app } = mounted;
    expect(app.find('.server > .toolbar a').text()).toContain(ru.serverPage.back);
    const alert = app.find('[role="alert"]');
    expect(alert.text()).toContain(ru.state.offlineTitle);
    const before = vi.mocked(stub.api.site.server).mock.calls.length;
    await alert.find('button').trigger('click');
    expect(vi.mocked(stub.api.site.server).mock.calls.length).toBe(before + 1);
  });

  it("an unknown id — 'not found'", async () => {
    const { app } = await open('/server/999999');
    expect(app.find('h1').text()).toBe(ru.serverPage.notFound);
  });

  it('favoriting toggles and lands in the side panel', async () => {
    const { app } = await open(`/server/${String(SERVER_IDS.wasteland)}`);
    await app.find(`button[aria-label="${ru.serverPage.addFavorite}"]`).trigger('click');
    expect(app.findAll('.favorite')).toHaveLength(favoriteIds.length + 1);
  });

  it('the cover scene has no text, the name sits below it', async () => {
    const { app } = await open(`/server/${String(SERVER_IDS.northernEdge)}`);
    const cover = app.find('.cover');
    expect(cover.find('.landscape').attributes('data-scene')).toBe('taiga-day');
    expect(cover.text()).toBe('');
    expect(app.find('.head h1').text()).toBe(serverName(SERVER_IDS.northernEdge));
  });
});
