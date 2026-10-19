// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountResult, AccountState } from '@shared/account';
import type { ServerCard, ServerList } from '@shared/catalog';
import { ru } from '@shared/i18n/ru';
import type { SiteResult } from '@shared/site';
import { mountScreen, unmountScreen } from '../screen-testing';
import {
  signedOutState,
  stubLauncher,
  testCard,
  TEST_USER,
  type Mounted,
  type Stub,
} from '../testing';

afterEach(unmountScreen);

interface Held<T> {
  answer: Promise<T>;
  release: (value: T) => void;
}

function held<T>(): Held<T> {
  let release: (value: T) => void = () => undefined;
  const answer = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

const SIGNED_IN: AccountState = { ...signedOutState, seq: 1, user: TEST_USER };

function cardAnswer(id: number): SiteResult<ServerCard> {
  return {
    ok: true,
    value: testCard({ id, name: `Server ${String(id)}` }),
    stale: false,
    fetchedAt: '2026-10-03T12:00:00Z',
  };
}

const EMPTY_LIST: SiteResult<ServerList> = {
  ok: true,
  value: {
    data: [],
    topSlots: { diamond: [], gold: [] },
    topSlotsFree: { diamond: 0, gold: 0 },
    meta: { page: 1, per_page: 50, total: 0 },
  },
  stale: false,
  fetchedAt: '2026-10-03T12:00:00Z',
};

function signedIn(favorites: () => Promise<AccountResult<number[]>>): Stub {
  const stub = stubLauncher();
  stub.api.account.state = vi.fn(() => Promise.resolve(SIGNED_IN));
  stub.api.site.favorites = vi.fn(favorites);
  stub.api.site.server = vi.fn((id: number) => Promise.resolve(cardAnswer(id)));
  return stub;
}

function open(stub: Stub, path = '/'): Promise<Mounted> {
  return mountScreen(path, { stub, demo: false });
}

function favoritesBox(app: Mounted['app']): {
  state: string | undefined;
  ghosts: number;
  rows: string[];
  text: string;
} {
  const list = app.find('.sidebar ul.favorites');
  return {
    state: list.attributes('data-favorites'),
    ghosts: list.findAll('li.ghost').length,
    rows: list.findAll('a.favorite .name').map((row) => row.text()),
    text: app.find('.sidebar').text(),
  };
}

describe('favorites in the sidebar', () => {
  it('shows a skeleton, not the empty text, until the site has answered', async () => {
    const wait = held<AccountResult<number[]>>();
    const { app } = await open(signedIn(() => wait.answer));
    const before = favoritesBox(app);
    expect(before.state).toBe('loading');
    expect(before.ghosts).toBe(TEST_USER.favoritesCount);
    expect(before.text).not.toContain(ru.nav.favoritesEmpty);
    expect(app.find('.sidebar ul.favorites').attributes('aria-busy')).toBe('true');
  });

  it.each([
    [9, 9],
    [40, 12],
    [0, 0],
    [null, 3],
  ])('remembered count %j gives %i skeleton rows', async (favoritesCount, rows) => {
    const wait = held<AccountResult<number[]>>();
    const stub = signedIn(() => wait.answer);
    stub.api.account.state = vi.fn(() =>
      Promise.resolve({ ...SIGNED_IN, user: { ...TEST_USER, favoritesCount } }),
    );
    const { app } = await open(stub);
    expect(favoritesBox(app).ghosts).toBe(rows);
    expect(favoritesBox(app).text).not.toContain(ru.nav.favoritesEmpty);
  });

  it('says it is empty only after the site answered with an empty list', async () => {
    const wait = held<AccountResult<number[]>>();
    const { app } = await open(signedIn(() => wait.answer));
    wait.release({ ok: true, value: [] });
    await flushPromises();
    const after = favoritesBox(app);
    expect(after.state).toBe('ready');
    expect(after.ghosts).toBe(0);
    expect(after.text).toContain(ru.nav.favoritesEmpty);
  });

  it('answered at once from the cache, shows the rows straight away', async () => {
    const { app } = await open(signedIn(() => Promise.resolve({ ok: true, value: [3, 17] })));
    const shown = favoritesBox(app);
    expect(shown.rows).toEqual(['Server 3', 'Server 17']);
    expect(shown.ghosts).toBe(0);
    expect(shown.text).not.toContain(ru.nav.favoritesEmpty);
  });

  it('shows only ghosts while some cards are on the way, then all the servers at once', async () => {
    const slow = held<SiteResult<ServerCard>>();
    const stub = signedIn(() => Promise.resolve({ ok: true, value: [3, 17] }));
    stub.api.site.server = vi.fn((id: number) =>
      id === 17 ? slow.answer : Promise.resolve(cardAnswer(id)),
    );
    const { app } = await open(stub);
    expect(favoritesBox(app)).toMatchObject({ rows: [], ghosts: 2, state: 'loading' });
    slow.release(cardAnswer(17));
    await flushPromises();
    expect(favoritesBox(app)).toMatchObject({ rows: ['Server 3', 'Server 17'], ghosts: 0 });
  });

  it('a card that takes too long does not hold the servers that have come', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const slow = held<SiteResult<ServerCard>>();
    const stub = signedIn(() => Promise.resolve({ ok: true, value: [3, 17] }));
    stub.api.site.server = vi.fn((id: number) =>
      id === 17 ? slow.answer : Promise.resolve(cardAnswer(id)),
    );
    const { app } = await open(stub);
    expect(favoritesBox(app)).toMatchObject({ rows: [], ghosts: 2 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(favoritesBox(app)).toMatchObject({ rows: ['Server 3'], ghosts: 0 });
    vi.useRealTimers();
  });

  it('a failure is its own state with a retry, not the empty text', async () => {
    const stub = signedIn(() => Promise.resolve({ ok: false, error: { code: 'offline' } }));
    const { app } = await open(stub);
    const failed = app.find('[data-favorites="error"]');
    expect(failed.text()).toContain(ru.nav.favoritesFailed);
    expect(favoritesBox(app).text).not.toContain(ru.nav.favoritesEmpty);
    stub.api.site.favorites = vi.fn(() => Promise.resolve({ ok: true as const, value: [3] }));
    await failed.find('button').trigger('click');
    await flushPromises();
    expect(favoritesBox(app).rows).toEqual(['Server 3']);
    expect(app.find('[data-favorites="error"]').exists()).toBe(false);
  });

  it('a guest with no stars sees the empty text once the account state is known', async () => {
    const state = held<AccountState>();
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => state.answer);
    const { app } = await open(stub);
    expect(favoritesBox(app).text).not.toContain(ru.nav.favoritesEmpty);
    expect(app.find('[data-account="loading"]').exists()).toBe(true);
    state.release(signedOutState);
    await flushPromises();
    expect(favoritesBox(app).text).toContain(ru.nav.favoritesEmpty);
    expect(app.find('[data-account="loading"]').exists()).toBe(false);
  });

  it('reads the list again when the main process announces a fresh one', async () => {
    const stub = signedIn(() => Promise.resolve({ ok: true, value: [3] }));
    const { app } = await open(stub);
    stub.api.site.favorites = vi.fn(() => Promise.resolve({ ok: true as const, value: [3, 17] }));
    stub.emitSite({ topic: 'favorites' });
    await flushPromises();
    expect(favoritesBox(app).rows).toEqual(['Server 3', 'Server 17']);
  });
});

describe('favorites: how many rows the skeleton holds', () => {
  it('three rows when nothing is known about the list yet', async () => {
    const wait = held<AccountResult<number[]>>();
    const stub = signedIn(() => wait.answer);
    stub.api.account.state = vi.fn(() =>
      Promise.resolve({ ...SIGNED_IN, user: { ...TEST_USER, favoritesCount: null } }),
    );
    localStorage.setItem('mcmonitor.favorites', JSON.stringify([1, 2, 3, 4, 5]));
    const { app } = await open(stub);
    expect(favoritesBox(app).ghosts).toBe(3);
  });

  it('a guest gets a row for every star kept on this computer', async () => {
    const slow = held<SiteResult<ServerCard>>();
    const stub = stubLauncher();
    stub.api.site.server = vi.fn(() => slow.answer);
    localStorage.setItem('mcmonitor.favorites', JSON.stringify([3, 17, 42, 51]));
    const { app } = await open(stub);
    expect(favoritesBox(app)).toMatchObject({ ghosts: 4, state: 'loading' });
  });
});

describe('favorites: a change against a list on its way', () => {
  it('a list that arrives while a star is being removed does not bring the server back', async () => {
    const stub = signedIn(() => Promise.resolve({ ok: true, value: [3, 17] }));
    const removal = held<AccountResult<boolean>>();
    stub.api.site.setFavorite = vi.fn(() => removal.answer);
    const { app } = await open(stub, '/server/3');
    await app.find('.head-actions button.is-favorite').trigger('click');
    stub.emitSite({ topic: 'favorites' });
    await flushPromises();
    removal.release({ ok: true, value: false });
    await flushPromises();
    expect(favoritesBox(app).rows).toEqual(['Server 17']);
  });
});

describe('a hidden window', () => {
  function hide(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'hidden');
  });

  it('asks the site nothing on its timers and reads once when it is shown again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const stub = signedIn(() => Promise.resolve({ ok: true, value: [3] }));
    await open(stub);
    const live = vi.mocked(stub.api.site.live);
    const pauses = vi.mocked(stub.api.site.votePauses);
    hide(true);
    const before = live.mock.calls.length;
    const pausesBefore = pauses.mock.calls.length;
    vi.advanceTimersByTime(30 * 60_000);
    await flushPromises();
    expect(live).toHaveBeenCalledTimes(before);
    expect(pauses).toHaveBeenCalledTimes(pausesBefore);
    hide(false);
    await flushPromises();
    expect(live).toHaveBeenCalledTimes(before + 1);
    vi.advanceTimersByTime(20_000);
    await flushPromises();
    expect(live).toHaveBeenCalledTimes(before + 2);
  });
});

describe('other places while loading', () => {
  it('the favorites tab of the catalog shows rows of skeleton, not the empty notice', async () => {
    const wait = held<AccountResult<number[]>>();
    const stub = signedIn(() => wait.answer);
    stub.api.site.servers = vi.fn(() => Promise.resolve(EMPTY_LIST));
    const { app } = await open(stub, '/servers?tab=favorites');
    const tab = app.findAll('[role="tab"]').find((item) => item.text().includes(ru.nav.favorites));
    await tab?.trigger('click');
    await flushPromises();
    expect(app.find('[data-loading]').exists()).toBe(true);
    expect(app.text()).not.toContain(ru.catalog.emptyFavorites);
    wait.release({ ok: true, value: [] });
    await flushPromises();
    expect(app.find('[data-loading]').exists()).toBe(false);
    expect(app.text()).toContain(ru.catalog.emptyFavorites);
  });

  it('the catalog reads its first page again when a fresh one is announced', async () => {
    const stub = stubLauncher();
    stub.api.site.servers = vi.fn(() => Promise.resolve(EMPTY_LIST));
    await open(stub, '/servers');
    const servers = vi.mocked(stub.api.site.servers);
    const shown = servers.mock.calls.at(-1)?.[0] ?? {};
    const before = servers.mock.calls.length;
    stub.emitSite({ topic: 'servers', query: { ...shown, page: 2 } });
    stub.emitSite({ topic: 'servers', query: { ...shown, q: 'other' } });
    await flushPromises();
    expect(servers).toHaveBeenCalledTimes(before);
    stub.emitSite({ topic: 'servers', query: shown });
    await flushPromises();
    expect(servers).toHaveBeenCalledTimes(before + 1);
  });

  it('the account screen shows a skeleton until the account state is known', async () => {
    const state = held<AccountState>();
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => state.answer);
    const { app } = await open(stub, '/accounts');
    expect(app.find('[data-mc="loading"]').exists()).toBe(true);
    expect(app.find('[data-mc="signed-out"]').exists()).toBe(false);
    state.release(signedOutState);
    await flushPromises();
    expect(app.find('[data-mc="loading"]').exists()).toBe(false);
    expect(app.find('[data-mc="signed-out"]').exists()).toBe(true);
  });
});
