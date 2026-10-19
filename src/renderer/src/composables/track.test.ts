// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { ru } from '@shared/i18n/ru';
import type { TrackedEvent } from '@shared/telemetry';
import { SERVER_IDS, serverCard } from '../mock/servers';
import { createAppRouter } from '../router';
import { failedEvent, liveSite, mountScreen, unmountScreen } from '../screen-testing';
import { contextOf, stubLauncher, TEST_NOW, testCard, withCard, type Stub } from '../testing';
import { ARM_DELAY_MS } from './useDeepLink';
import { createTrack, trackScreens } from './useTrack';

afterEach(() => {
  unmountScreen();
  vi.useRealTimers();
});

function signedLive(): Stub {
  const stub = liveSite();
  stub.players.stored = {
    nicks: [{ id: 'nick-steve', nick: 'Steve' }],
    active: { kind: 'nick', id: 'nick-steve' },
  };
  return stub;
}

function cardOf(id: number): ReturnType<typeof testCard> {
  const card = serverCard(id, TEST_NOW.getTime());
  if (card === undefined) {
    throw new Error('card missing');
  }
  return card;
}

function sources(stub: Stub): string[] {
  return actions(stub, 'play').map((event) =>
    event.type === 'action' && event.name === 'play' ? event.source : '',
  );
}

function tracked(stub: Stub): TrackedEvent[] {
  return vi.mocked(stub.api.telemetry.track).mock.calls.map(([event]) => event);
}

function actions(stub: Stub, name: string): TrackedEvent[] {
  return tracked(stub).filter((event) => event.type === 'action' && event.name === name);
}

describe('screen.viewed', () => {
  it('is sent on every router transition, without repeating the same screen in a row', async () => {
    const router = createAppRouter(createMemoryHistory());
    const seen: TrackedEvent[] = [];
    trackScreens(router, (event) => seen.push(event));
    for (const path of [
      '/',
      '/servers',
      '/servers?q=sky',
      '/server/7',
      '/server/7?join=1',
      '/server/9',
      '/launch/9',
      '/my-servers/9',
      '/licenses',
      '/crash/server-9',
    ]) {
      await router.push(path);
    }
    expect(seen).toEqual([
      { type: 'screen.viewed', screen: 'home', server_id: null },
      { type: 'screen.viewed', screen: 'servers', server_id: null },
      { type: 'screen.viewed', screen: 'server', server_id: 7 },
      { type: 'screen.viewed', screen: 'server', server_id: 9 },
      { type: 'screen.viewed', screen: 'launch', server_id: null },
      { type: 'screen.viewed', screen: 'my_servers', server_id: null },
      { type: 'screen.viewed', screen: 'other', server_id: null },
      { type: 'screen.viewed', screen: 'crash', server_id: null },
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/sky/);
  });

  it('the blank screen behind the game is not a view, the return from it is', async () => {
    const router = createAppRouter(createMemoryHistory());
    const seen: TrackedEvent[] = [];
    trackScreens(router, (event) => seen.push(event));
    await router.push('/library');
    await router.push('/idle');
    await router.push('/library');
    expect(seen.map((event) => (event.type === 'screen.viewed' ? event.screen : ''))).toEqual([
      'library',
      'library',
    ]);
  });
});

describe('track', () => {
  it('sends nothing in demo mode and swallows a failing bridge', () => {
    const stub = stubLauncher();
    const event: TrackedEvent = { type: 'screen.viewed', screen: 'home', server_id: null };
    createTrack({ ...contextOf(stub), demo: true })(event);
    expect(stub.api.telemetry.track).not.toHaveBeenCalled();
    stub.api.telemetry.track = vi.fn(() => {
      throw new Error('bridge');
    });
    expect(() => {
      createTrack(contextOf(stub))(event);
    }).not.toThrow();
  });
});

describe('action play', () => {
  it('from the catalog: source catalog, and the same launch_id goes to the launch', async () => {
    const stub = signedLive();
    const { app } = await mountScreen('/servers', { stub, demo: false });
    await app.find('.rows:not(.top-slots) [data-launch="direct"]').trigger('click');
    await flushPromises();
    const [play] = actions(stub, 'play');
    expect(play).toMatchObject({ type: 'action', name: 'play', source: 'catalog' });
    const launchId = play?.type === 'action' && play.name === 'play' ? play.launch_id : '';
    expect(launchId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(stub.api.launch.launch).toHaveBeenCalledWith(expect.objectContaining({ launchId }));
  });

  it('from the server page: source server_page with the id of that server', async () => {
    const stub = signedLive();
    withCard(stub, testCard({ access: { license: true, nick: true } }));
    const path = `/server/${String(SERVER_IDS.wasteland)}`;
    const { app } = await mountScreen(path, { stub, demo: false });
    await app.find('.head-actions [data-launch="direct"]').trigger('click');
    await flushPromises();
    expect(actions(stub, 'play')).toEqual([
      {
        type: 'action',
        name: 'play',
        server_id: SERVER_IDS.wasteland,
        source: 'server_page',
        launch_id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      },
    ]);
  });
});

describe('action play from the site and from a link', () => {
  const launchId = '3f0c2a52-6f0e-4c1e-9a55-0d3a4d1b7c21';

  it('a request of the site: its launch_id and source go to the action and to the launch', async () => {
    const stub = signedLive();
    withCard(stub, testCard({ access: { license: true, nick: true } }));
    await mountScreen('/', { stub, demo: false });
    stub.emitDeepLink({
      kind: 'play',
      serverId: SERVER_IDS.wasteland,
      launchId,
      source: 'top_slot',
      via: 'site',
    });
    await flushPromises();
    expect(actions(stub, 'play')).toEqual([
      {
        type: 'action',
        name: 'play',
        server_id: SERVER_IDS.wasteland,
        source: 'top_slot',
        launch_id: launchId,
      },
    ]);
    expect(stub.api.launch.launch).toHaveBeenCalledWith(expect.objectContaining({ launchId }));
  });

  it('a link with parameters: the same after the confirmation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = signedLive();
    withCard(stub, testCard({ access: { license: true, nick: true } }));
    const { app } = await mountScreen('/', { stub, demo: false });
    stub.emitDeepLink({
      kind: 'play',
      serverId: SERVER_IDS.wasteland,
      launchId,
      source: 'favorites',
    });
    await flushPromises();
    expect(actions(stub, 'play')).toEqual([]);
    await vi.advanceTimersByTimeAsync(ARM_DELAY_MS);
    await app
      .find('[role="alertdialog"]')
      .findAll('button')
      .find((item) => item.text() === ru.deepLink.confirm)
      ?.trigger('click');
    await flushPromises();
    expect(actions(stub, 'play')).toMatchObject([{ source: 'favorites', launch_id: launchId }]);
    expect(stub.api.launch.launch).toHaveBeenCalledWith(expect.objectContaining({ launchId }));
  });
});

describe('action play: sources', () => {
  it('the hero of the home screen: home_hero', async () => {
    const stub = signedLive();
    const { app } = await mountScreen('/', { stub, demo: false });
    await app.find('.hero [data-launch="direct"]').trigger('click');
    await flushPromises();
    expect(sources(stub)).toEqual(['home_hero']);
  });

  it('a place above the rating in the catalog: top_slot', async () => {
    const stub = signedLive();
    const { app } = await mountScreen('/servers', { stub, demo: false });
    await app.find('.top-slots [data-launch="direct"]').trigger('click');
    await flushPromises();
    expect(sources(stub)).toEqual(['top_slot']);
  });

  it('the favorites tab of the catalog: favorites', async () => {
    localStorage.setItem('mcmonitor.favorites', JSON.stringify([SERVER_IDS.cubeIsland]));
    const stub = signedLive();
    const { app } = await mountScreen('/servers', { stub, demo: false });
    const tab = app
      .findAll('[role="tab"]')
      .find((item) => item.text().includes(ru.catalog.tabFavorites));
    await tab?.trigger('click');
    await flushPromises();
    await app.find('.rows:not(.top-slots) [data-launch="direct"]').trigger('click');
    await flushPromises();
    expect(sources(stub)).toEqual(['favorites']);
    expect(actions(stub, 'play')[0]).toMatchObject({ server_id: SERVER_IDS.cubeIsland });
  });
});

describe('action play: only an accepted click', () => {
  it('a click while another launch is busy sends nothing', async () => {
    const stub = signedLive();
    const { app, router } = await mountScreen('/servers', { stub, demo: false });
    await app.find('.rows:not(.top-slots) [data-launch="direct"]').trigger('click');
    await flushPromises();
    expect(actions(stub, 'play')).toHaveLength(1);
    await router.push('/servers');
    await flushPromises();
    const buttons = app.findAll('.rows:not(.top-slots) [data-launch="direct"]');
    await buttons.at(-1)?.trigger('click');
    await flushPromises();
    expect(actions(stub, 'play')).toHaveLength(1);
    expect(stub.api.launch.launch).toHaveBeenCalledOnce();
  });

  it('without an account the click is not an action', async () => {
    const stub = liveSite();
    const { app } = await mountScreen('/servers', { stub, demo: false });
    await app.find('.rows:not(.top-slots) [data-launch="direct"]').trigger('click');
    await flushPromises();
    expect(actions(stub, 'play')).toEqual([]);
    expect(stub.api.launch.launch).not.toHaveBeenCalled();
  });

  it('a retry from the launch screen launches again without a new action or launch_id', async () => {
    const stub = signedLive();
    const { app, emit } = await mountScreen('/servers', { stub, demo: false });
    await app.find('.rows:not(.top-slots) [data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(failedEvent({ code: 'join-unsupported', minecraft: '1.5.2' }));
    await flushPromises();
    const retry = app
      .findAll('.notice[role="alert"] button')
      .find((item) => item.text() === ru.launchError['join-unsupported'].action);
    await retry?.trigger('click');
    await flushPromises();
    expect(stub.api.launch.launch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(stub.api.launch.launch).mock.calls[1]?.[0]).not.toHaveProperty('launchId');
    expect(actions(stub, 'play')).toHaveLength(1);
  });
});

describe('server page actions', () => {
  const page = `/server/${String(SERVER_IDS.wasteland)}`;

  function openPage(stub: Stub, path = page): ReturnType<typeof mountScreen> {
    return mountScreen(path, { stub, demo: false });
  }

  it('the star: favorite_add, then favorite_remove', async () => {
    const stub = liveSite();
    withCard(stub, testCard());
    const { app } = await openPage(stub);
    const star = app.find('.head-actions [aria-pressed]');
    await star.trigger('click');
    await star.trigger('click');
    const names = tracked(stub).flatMap((event) => (event.type === 'action' ? [event.name] : []));
    expect(names).toEqual(['favorite_add', 'favorite_remove']);
    expect(actions(stub, 'favorite_remove')[0]).toMatchObject({ server_id: SERVER_IDS.wasteland });
  });

  it('copy_address only after the clipboard took the text', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const stub = liveSite();
    withCard(stub, testCard());
    const { app } = await openPage(stub);
    await app.find('.head-meta .copy').trigger('click');
    await flushPromises();
    expect(actions(stub, 'copy_address')).toEqual([
      { type: 'action', name: 'copy_address', server_id: SERVER_IDS.wasteland },
    ]);
    writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    await app.find('.head-meta .copy').trigger('click');
    await flushPromises();
    expect(actions(stub, 'copy_address')).toHaveLength(1);
    expect(JSON.stringify(tracked(stub))).not.toContain('example');
  });

  it('a guest vote opens the site: vote_open_site', async () => {
    const stub = liveSite();
    withCard(stub, testCard());
    const { app } = await openPage(stub);
    await app.find('.vote-action').trigger('click');
    expect(actions(stub, 'vote_open_site')).toEqual([
      { type: 'action', name: 'vote_open_site', server_id: SERVER_IDS.wasteland },
    ]);
    expect(stub.api.openExternal).toHaveBeenCalled();
  });

  it('a server link: link_open with its kind and without the address', async () => {
    const stub = liveSite();
    withCard(stub, testCard());
    const { app } = await openPage(stub);
    await app.find('.links a').trigger('click');
    expect(actions(stub, 'link_open')).toEqual([
      { type: 'action', name: 'link_open', server_id: SERVER_IDS.wasteland, kind: 'discord' },
    ]);
  });

  it("the server's own site: link_open with kind site", async () => {
    const stub = liveSite();
    withCard(stub, testCard());
    const { app } = await openPage(stub);
    await app.find('.own-site a').trigger('click');
    expect(actions(stub, 'link_open')).toEqual([
      { type: 'action', name: 'link_open', server_id: SERVER_IDS.wasteland, kind: 'site' },
    ]);
    expect(stub.api.openExternal).toHaveBeenCalled();
  });

  it("the server's own launcher: own_launcher_open", async () => {
    const stub = liveSite();
    withCard(stub, cardOf(SERVER_IDS.technograd));
    const { app } = await openPage(stub, `/server/${String(SERVER_IDS.technograd)}`);
    await app.find('a[data-launch="own_launcher"]').trigger('click');
    expect(actions(stub, 'own_launcher_open')).toEqual([
      { type: 'action', name: 'own_launcher_open', server_id: SERVER_IDS.technograd },
    ]);
  });
});

describe('catalog actions', () => {
  it('a tab switch and a search after the delay: length and count, never the text', async () => {
    const stub = liveSite();
    const { app } = await mountScreen('/servers', { stub, demo: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tab = app.findAll('[role="tab"]').find((item) => item.text() === ru.catalog.tabOnline);
    await tab?.trigger('click');
    expect(actions(stub, 'tab')).toEqual([
      { type: 'action', name: 'tab', server_id: null, tab: 'online' },
    ]);
    const input = app.find('.toolbar input[type="search"]');
    await input.setValue('sk');
    await input.setValue('skyblock');
    expect(actions(stub, 'search')).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    const searches = actions(stub, 'search');
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({ server_id: null, length: 8 });
    expect(JSON.stringify(tracked(stub))).not.toContain('skyblock');
  });
});
