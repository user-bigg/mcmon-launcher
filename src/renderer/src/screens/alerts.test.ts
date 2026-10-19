// @vitest-environment happy-dom
import { flushPromises, type DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountErrorCode, AccountResult, AccountState, AccountUser } from '@shared/account';
import { ALERT_POLL_MS, type AlertFeed, type AlertItem, type AlertSettings } from '@shared/alerts';
import { countOf, fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { SITE_LINKS } from '@shared/links';
import { createStores } from '../composables/stores';
import { accountErrorText } from '../lib/account';
import { SERVER_IDS } from '../mock/servers';
import { unmountScreen } from '../screen-testing';
import {
  contextOf,
  mountAt,
  stubLauncher,
  TEST_NOW,
  TEST_USER,
  testCard,
  withCard,
  type Mounted,
  type Stub,
} from '../testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.app.unmount();
  mounted = undefined;
  unmountScreen();
  vi.useRealTimers();
});

function ok<T>(value: T): Promise<AccountResult<T>> {
  return Promise.resolve({ ok: true, value });
}

function failed<T>(code: AccountErrorCode = 'offline'): Promise<AccountResult<T>> {
  return Promise.resolve({ ok: false, error: { code } });
}

interface Deferred<T> {
  promise: Promise<AccountResult<T>>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let release: (result: AccountResult<T>) => void = () => undefined;
  const promise = new Promise<AccountResult<T>>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    resolve: (value): void => {
      release({ ok: true, value });
    },
  };
}

function signedState(user: Partial<AccountUser> = {}): AccountState {
  return {
    seq: 1,
    encryptionAvailable: true,
    user: { ...TEST_USER, ...user },
    connect: null,
    error: null,
  };
}

function signedIn(user: Partial<AccountUser> = {}): Stub {
  const stub = stubLauncher();
  stub.api.account.state = vi.fn(() => Promise.resolve(signedState(user)));
  return stub;
}

function alert(id: number, patch: Partial<AlertItem> = {}): AlertItem {
  return {
    id,
    kind: 'favorite_wipe',
    server: { id: SERVER_IDS.wasteland, name: `Server ${String(id)}` },
    at: '2026-10-03T09:00:00Z',
    read: false,
    title: `Title ${String(id)}`,
    ...patch,
  };
}

function feedOf(items: AlertItem[], next: string | null = null): AlertFeed {
  return { items, unread: items.filter((item) => !item.read).length, next };
}

function withFeed(stub: Stub, feed: AlertFeed): void {
  stub.api.site.alerts = vi.fn(() => ok(feed));
}

async function open(path: string, stub: Stub, demo = false): Promise<Mounted> {
  mounted = await mountAt(path, { stub, demo });
  return mounted;
}

function bell(app: Mounted['app']): DOMWrapper<Element> {
  return app.find('[data-alerts-button]');
}

async function openPanel(app: Mounted['app']): Promise<DOMWrapper<Element>> {
  await bell(app).trigger('click');
  await flushPromises();
  return app.find('#titlebar-alerts');
}

describe('bell: guest', () => {
  it('invites to sign in, shows no dot and sends no requests', async () => {
    const stub = stubLauncher();
    const { app, router } = await open('/', stub);
    expect(bell(app).classes()).not.toContain('has-dot');
    expect(bell(app).attributes('aria-label')).toBe(ru.titlebar.notifications);
    expect(bell(app).attributes('aria-expanded')).toBe('false');
    const panel = await openPanel(app);
    expect(bell(app).attributes('aria-expanded')).toBe('true');
    expect(panel.find('[data-alerts-guest]').text()).toContain(ru.alerts.guest);
    expect(panel.find('[data-alerts-read]').exists()).toBe(false);
    expect(panel.find('[data-alerts-clear]').exists()).toBe(false);
    await panel.find('a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/accounts');
    expect(app.find('#titlebar-alerts').exists()).toBe(false);
    expect(stub.api.site.alerts).not.toHaveBeenCalled();
    expect(stub.api.site.readAlerts).not.toHaveBeenCalled();
  });
});

describe('bell: feed', () => {
  it('the dot comes from the account before the first feed arrives', async () => {
    const stub = signedIn({ unreadAlerts: 3 });
    stub.api.site.alerts = vi.fn(() => new Promise<never>(() => undefined));
    const { app } = await open('/', stub);
    expect(bell(app).classes()).toContain('has-dot');
    expect(bell(app).attributes('aria-label')).toBe(
      fill(ru.titlebar.notificationsNew, { count: countOf(3, ru.plural.fresh) }),
    );
    const panel = await openPanel(app);
    expect(panel.find('[data-alerts-loading]').exists()).toBe(true);
  });

  it('lists newest first, marks unread with text, shows an unknown kind by its title', async () => {
    const stub = signedIn();
    withFeed(
      stub,
      feedOf([
        alert(1, { at: '2026-10-01T09:00:00Z', read: true }),
        alert(3, { at: '2026-10-03T09:30:00Z', kind: 'brand_new_kind', title: 'Something new' }),
        alert(2, { at: '2026-10-02T09:00:00Z', server: null }),
      ]),
    );
    const { app } = await open('/', stub);
    expect(bell(app).attributes('aria-label')).toBe(
      fill(ru.titlebar.notificationsNew, { count: countOf(2, ru.plural.fresh) }),
    );
    const panel = await openPanel(app);
    const rows = panel.findAll('[data-alert]');
    expect(rows.map((row) => row.find('.title').text())).toEqual([
      'Something new',
      'Title 2',
      'Title 1',
    ]);
    expect(rows[0]?.find('.name').text()).toBe('Server 3');
    expect(rows[0]?.find('time').text()).toBe('12:30');
    expect(rows[2]?.find('time').text()).toContain('12:00');
    expect(rows[2]?.find('time').text()).toContain('1');
    expect(rows[0]?.text()).toContain(ru.alerts.unread);
    expect(rows[2]?.text()).not.toContain(ru.alerts.unread);
    expect(rows[1]?.element.tagName).toBe('DIV');
    expect(rows[0]?.element.tagName).toBe('BUTTON');
  });

  it('a title with HTML from the site stays plain text', async () => {
    const stub = signedIn();
    const hostile = '<img src=x onerror=alert(1)><b>bold</b>';
    withFeed(stub, feedOf([alert(1, { title: hostile, server: { id: 5, name: '<i>name</i>' } })]));
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    const row = panel.find('[data-alert]');
    expect(row.find('.title').text()).toBe(hostile);
    expect(row.find('.name').text()).toBe('<i>name</i>');
    expect(row.find('.title img, .title b, .name i').exists()).toBe(false);
  });

  it('an event opens its server page, closes the panel and returns focus to the bell', async () => {
    const stub = signedIn();
    withFeed(stub, feedOf([alert(1)]));
    const { app, router } = await open('/', stub);
    const panel = await openPanel(app);
    await panel.find('[data-alert]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/server/${String(SERVER_IDS.wasteland)}`);
    expect(app.find('#titlebar-alerts').exists()).toBe(false);
    expect(document.activeElement).toBe(bell(app).element);
  });

  it('opening an event marks only that event as read on the site', async () => {
    const stub = signedIn({ unreadAlerts: 2 });
    const items = [alert(1), alert(2)];
    withFeed(stub, feedOf(items));
    stub.api.site.readAlerts = vi.fn((ids?: number[]) => {
      withFeed(
        stub,
        feedOf(items.map((item) => ({ ...item, read: ids?.includes(item.id) === true }))),
      );
      return ok(true as const);
    });
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    await panel.findAll('[data-alert]')[0]?.trigger('click');
    await flushPromises();
    expect(stub.api.site.readAlerts).toHaveBeenCalledTimes(1);
    expect(vi.mocked(stub.api.site.readAlerts).mock.calls[0]?.[0]).toHaveLength(1);
    const reopened = await openPanel(app);
    expect(reopened.findAll('.is-unread')).toHaveLength(1);
    await reopened.find('li:not(.is-unread) [data-alert]').trigger('click');
    await flushPromises();
    expect(stub.api.site.readAlerts).toHaveBeenCalledTimes(1);
  });

  it('Escape and a click outside close the panel', async () => {
    const stub = signedIn();
    withFeed(stub, feedOf([alert(1)]));
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    expect(document.activeElement).toBe(panel.element);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(app.find('#titlebar-alerts').exists()).toBe(false);
    expect(document.activeElement).toBe(bell(app).element);
    await openPanel(app);
    app.find('.lx-main').element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(app.find('#titlebar-alerts').exists()).toBe(false);
  });

  it("'Mark as read' marks everything in memory after the site confirms", async () => {
    const stub = signedIn();
    withFeed(stub, feedOf([alert(2), alert(1)]));
    stub.api.site.readAlerts = vi.fn(() => ok<true>(true));
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    await panel.find('[data-alerts-read]').trigger('click');
    await flushPromises();
    expect(stub.api.site.readAlerts).toHaveBeenCalledTimes(1);
    expect(panel.text()).not.toContain(ru.alerts.unread);
    expect(panel.find('[data-alerts-read]').exists()).toBe(false);
    expect(panel.find('[data-alerts-clear]').exists()).toBe(true);
    expect(bell(app).classes()).not.toContain('has-dot');
  });

  it("a failed 'Mark as read' keeps the events unread and says so", async () => {
    const stub = signedIn();
    withFeed(stub, feedOf([alert(1)]));
    stub.api.site.readAlerts = vi.fn(() => failed<true>());
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    await panel.find('[data-alerts-read]').trigger('click');
    await flushPromises();
    expect(panel.find('[role="alert"]').text()).toBe(ru.alerts.actionFailed);
    expect(panel.text()).toContain(ru.alerts.unread);
    expect(bell(app).classes()).toContain('has-dot');
  });

  it("'Clear' empties the list", async () => {
    const stub = signedIn();
    withFeed(stub, feedOf([alert(2), alert(1, { read: true })]));
    stub.api.site.clearAlerts = vi.fn(() => ok<true>(true));
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    await panel.find('[data-alerts-clear]').trigger('click');
    await flushPromises();
    expect(stub.api.site.clearAlerts).toHaveBeenCalledTimes(1);
    expect(panel.find('[data-alerts-empty]').text()).toBe(ru.alerts.empty);
    expect(panel.find('[data-alerts-clear]').exists()).toBe(false);
    expect(bell(app).classes()).not.toContain('has-dot');
  });

  it("'Show more' loads the next page by the cursor", async () => {
    const stub = signedIn();
    stub.api.site.alerts = vi.fn((after?: string) =>
      ok(
        after === undefined
          ? feedOf([alert(2)], 'cursor-1')
          : feedOf([alert(1, { at: '2026-10-01T09:00:00Z' })]),
      ),
    );
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    await panel.find('[data-alerts-more]').trigger('click');
    await flushPromises();
    expect(stub.api.site.alerts).toHaveBeenLastCalledWith('cursor-1');
    expect(panel.findAll('[data-alert]')).toHaveLength(2);
    expect(panel.find('[data-alerts-more]').exists()).toBe(false);
  });

  it('a network error shows a quiet state, and retry loads the feed', async () => {
    const stub = signedIn();
    const alerts = vi.fn(() => failed<AlertFeed>());
    stub.api.site.alerts = alerts;
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    expect(panel.find('[data-alerts-error]').text()).toContain(ru.alerts.failed);
    alerts.mockImplementation(() => ok(feedOf([alert(1)])));
    await panel.find('[data-alerts-error] button').trigger('click');
    await flushPromises();
    expect(panel.find('[data-alerts-error]').exists()).toBe(false);
    expect(panel.findAll('[data-alert]')).toHaveLength(1);
  });

  it('a method the site has not shipped yet looks like an empty feed', async () => {
    const stub = signedIn({ unreadAlerts: null });
    stub.api.site.alerts = vi.fn(() => failed<AlertFeed>('unavailable'));
    const { app } = await open('/', stub);
    expect(bell(app).classes()).not.toContain('has-dot');
    const panel = await openPanel(app);
    expect(panel.find('[data-alerts-empty]').text()).toBe(ru.alerts.empty);
    expect(panel.find('[data-alerts-error]').exists()).toBe(false);
    expect(panel.find('button').exists()).toBe(false);
  });

  it('a rejected session shows the quiet error and then the guest invitation', async () => {
    const stub = signedIn();
    stub.api.site.alerts = vi.fn(() => failed<AlertFeed>('unauthenticated'));
    const { app, emitAccount } = await open('/', stub);
    const panel = await openPanel(app);
    expect(panel.find('[data-alerts-error]').text()).toContain(ru.alerts.failed);
    expect(panel.find('[data-alert]').exists()).toBe(false);
    emitAccount({ change: 'expired', state: { ...signedState(), seq: 2, user: null } });
    await flushPromises();
    expect(panel.find('[data-alerts-guest]').exists()).toBe(true);
    expect(bell(app).classes()).not.toContain('has-dot');
  });

  it("a feed asked before 'Mark as read' does not bring the unread marks back", async () => {
    const stub = signedIn();
    const fresh = feedOf([alert(2), alert(1)]);
    const late = deferred<AlertFeed>();
    const answers = [ok(fresh), late.promise];
    const alerts = vi.fn(
      () => answers.shift() ?? ok(feedOf([alert(2, { read: true }), alert(1, { read: true })])),
    );
    stub.api.site.alerts = alerts;
    stub.api.site.readAlerts = vi.fn(() => ok<true>(true));
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    expect(alerts).toHaveBeenCalledTimes(2);
    await panel.find('[data-alerts-read]').trigger('click');
    await flushPromises();
    late.resolve(fresh);
    await flushPromises();
    expect(alerts).toHaveBeenCalledTimes(3);
    expect(panel.findAll('[data-alert]')).toHaveLength(2);
    expect(panel.text()).not.toContain(ru.alerts.unread);
    expect(bell(app).classes()).not.toContain('has-dot');
  });

  it("a feed asked before 'Clear' does not bring the events back", async () => {
    const stub = signedIn();
    const late = deferred<AlertFeed>();
    const answers = [ok(feedOf([alert(1)])), late.promise];
    stub.api.site.alerts = vi.fn(() => answers.shift() ?? ok(feedOf([])));
    stub.api.site.clearAlerts = vi.fn(() => ok<true>(true));
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    await panel.find('[data-alerts-clear]').trigger('click');
    await flushPromises();
    late.resolve(feedOf([alert(1)]));
    await flushPromises();
    expect(panel.find('[data-alerts-empty]').exists()).toBe(true);
    expect(bell(app).classes()).not.toContain('has-dot');
  });

  it("after 'Clear' the focus stays in the panel", async () => {
    const stub = signedIn();
    withFeed(stub, feedOf([alert(1)]));
    stub.api.site.clearAlerts = vi.fn(() => ok<true>(true));
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    const clear = panel.find<HTMLButtonElement>('[data-alerts-clear]');
    clear.element.focus();
    await clear.trigger('click');
    await flushPromises();
    expect(panel.find('[data-alerts-clear]').exists()).toBe(false);
    expect(document.activeElement).toBe(panel.element);
  });

  it('signing out drops the feed and the dot', async () => {
    const stub = signedIn();
    withFeed(stub, feedOf([alert(1)]));
    const { app, emitAccount } = await open('/', stub);
    expect(bell(app).classes()).toContain('has-dot');
    emitAccount({ change: 'signed-out', state: { ...signedState(), seq: 2, user: null } });
    await flushPromises();
    expect(bell(app).classes()).not.toContain('has-dot');
    const panel = await openPanel(app);
    expect(panel.find('[data-alerts-guest]').exists()).toBe(true);
    expect(panel.find('[data-alert]').exists()).toBe(false);
  });

  it('the demo build shows made-up events without requests', async () => {
    const stub = stubLauncher();
    const { app } = await open('/', stub, true);
    expect(bell(app).classes()).toContain('has-dot');
    const panel = await openPanel(app);
    expect(panel.findAll('[data-alert]').length).toBeGreaterThan(1);
    expect(stub.api.site.alerts).not.toHaveBeenCalled();
  });
});

describe('bell: polling', () => {
  it('asks on sign-in and on opening, in the background no more often than the interval', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = signedIn();
    withFeed(stub, feedOf([]));
    const { app } = await open('/', stub);
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(ALERT_POLL_MS - 1);
    await flushPromises();
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    await openPanel(app);
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(ALERT_POLL_MS - 1);
    await flushPromises();
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(4);
  });

  it('keeps polling while the site has not shipped the feed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = signedIn();
    stub.api.site.alerts = vi.fn(() => failed<AlertFeed>('unavailable'));
    await open('/', stub);
    vi.advanceTimersByTime(ALERT_POLL_MS);
    await flushPromises();
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(2);
  });

  it('a background poll keeps the pages loaded by Show more and adds new events on top', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = signedIn();
    const old = alert(1, { at: '2026-10-01T09:00:00Z', read: true });
    const first = [
      feedOf([alert(2)], 'cursor-1'),
      feedOf([alert(2)], 'cursor-1'),
      feedOf([alert(3), alert(2)], 'cursor-2'),
    ];
    const alerts = vi.fn((after?: string) =>
      ok(after === undefined ? (first.shift() ?? feedOf([])) : feedOf([old], 'cursor-9')),
    );
    stub.api.site.alerts = alerts;
    const { app } = await open('/', stub);
    const panel = await openPanel(app);
    await panel.find('[data-alerts-more]').trigger('click');
    await flushPromises();
    expect(panel.findAll('[data-alert] .title').map((row) => row.text())).toEqual([
      'Title 2',
      'Title 1',
    ]);
    vi.advanceTimersByTime(ALERT_POLL_MS);
    await flushPromises();
    expect(panel.findAll('[data-alert] .title').map((row) => row.text())).toEqual([
      'Title 3',
      'Title 2',
      'Title 1',
    ]);
    await panel.find('[data-alerts-more]').trigger('click');
    await flushPromises();
    expect(alerts).toHaveBeenLastCalledWith('cursor-9');
  });

  it('a newer unread count from the account asks the feed again within a minute', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = signedIn();
    const answers = [feedOf([])];
    stub.api.site.alerts = vi.fn(() => ok(answers.shift() ?? feedOf([alert(1)])));
    const { app, emitAccount } = await open('/', stub);
    expect(bell(app).classes()).not.toContain('has-dot');
    emitAccount({ change: 'changed', state: { ...signedState({ unreadAlerts: 1 }), seq: 2 } });
    await flushPromises();
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect(stub.api.site.alerts).toHaveBeenCalledTimes(2);
    expect(bell(app).classes()).toContain('has-dot');
  });

  it('a guest is never polled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stub = stubLauncher();
    await open('/', stub);
    vi.advanceTimersByTime(ALERT_POLL_MS * 3);
    await flushPromises();
    expect(stub.api.site.alerts).not.toHaveBeenCalled();
  });
});

describe("server page: 'Tell me when it is back'", () => {
  const path = `/server/${String(SERVER_IDS.wasteland)}`;

  function watchButton(app: Mounted['app']): DOMWrapper<Element> {
    return app.find('[data-watch] button');
  }

  it('a working server has no button', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'online', my_watch: false }));
    const { app } = await open(path, stub);
    expect(app.find('[data-watch]').exists()).toBe(false);
  });

  it('turns the watch on and off through the site', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'offline', my_watch: false }));
    stub.api.site.setWatch = vi.fn((_id: number, watch: boolean) => ok(watch));
    const { app } = await open(path, stub);
    expect(watchButton(app).text()).toBe(ru.alerts.watch);
    await watchButton(app).trigger('click');
    await flushPromises();
    expect(stub.api.site.setWatch).toHaveBeenLastCalledWith(SERVER_IDS.wasteland, true);
    expect(watchButton(app).text()).toBe(ru.alerts.watching);
    await watchButton(app).trigger('click');
    await flushPromises();
    expect(stub.api.site.setWatch).toHaveBeenLastCalledWith(SERVER_IDS.wasteland, false);
    expect(watchButton(app).text()).toBe(ru.alerts.watch);
  });

  it('warns when the watch is on but the kind is switched off in the settings', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'offline', my_watch: false }));
    stub.api.site.setWatch = vi.fn((_id: number, watch: boolean) => ok(watch));
    stub.api.site.alertSettings = vi.fn(() =>
      ok({ favorite_wipe: true, watched_up: false, server_removed: true }),
    );
    const { app } = await open(path, stub);
    expect(app.find('[data-watch-muted]').exists()).toBe(false);
    await watchButton(app).trigger('click');
    await flushPromises();
    expect(app.get('[data-watch-muted]').text()).toContain(ru.alerts.watchMutedSettings);
    await watchButton(app).trigger('click');
    await flushPromises();
    expect(app.find('[data-watch-muted]').exists()).toBe(false);
  });

  it('the state comes from my_watch', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'offline', my_watch: true }));
    const { app } = await open(path, stub);
    expect(watchButton(app).text()).toBe(ru.alerts.watching);
  });

  it('a failed request rolls the button back and explains', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'offline', my_watch: false }));
    let release: (result: AccountResult<boolean>) => void = () => undefined;
    stub.api.site.setWatch = vi.fn(
      () =>
        new Promise<AccountResult<boolean>>((resolve) => {
          release = resolve;
        }),
    );
    const { app } = await open(path, stub);
    await watchButton(app).trigger('click');
    expect(watchButton(app).text()).toBe(ru.alerts.watching);
    release({ ok: false, error: { code: 'offline' } });
    await flushPromises();
    expect(watchButton(app).text()).toBe(ru.alerts.watch);
    expect(app.find('[data-watch] [role="alert"]').text()).toBe(
      accountErrorText({ code: 'offline' }),
    );
  });

  it('a signed-in user has no button until the site sends my_watch', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'offline' }));
    const { app } = await open(path, stub);
    expect(app.find('[data-watch]').exists()).toBe(false);
  });

  it('a method the site has not shipped yet gives a neutral message', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'offline', my_watch: false }));
    stub.api.site.setWatch = vi.fn(() => failed<boolean>('unavailable'));
    const { app } = await open(path, stub);
    await watchButton(app).trigger('click');
    await flushPromises();
    expect(watchButton(app).text()).toBe(ru.alerts.watch);
    expect(app.find('[data-watch] [role="alert"]').text()).toBe(ru.alerts.actionFailed);
  });

  it.each(['watches_limit', 'server_dead', 'server_sleeping'] as const)(
    'the %s rejection explains itself and keeps the button',
    async (code) => {
      const stub = signedIn();
      withCard(stub, testCard({ status: 'offline', my_watch: false }));
      stub.api.site.setWatch = vi.fn(() => failed<boolean>(code));
      const { app } = await open(path, stub);
      await watchButton(app).trigger('click');
      await flushPromises();
      expect(app.find('[data-watch] [role="alert"]').text()).toBe(ru.account.errors[code]);
      expect(watchButton(app).text()).toBe(ru.alerts.watch);
    },
  );

  it('email_unverified explains and links to the sign-in methods on the site', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'offline', my_watch: false }));
    stub.api.site.setWatch = vi.fn(() => failed<boolean>('email_unverified'));
    const { app } = await open(path, stub);
    await watchButton(app).trigger('click');
    await flushPromises();
    const error = app.find('[data-watch] [role="alert"]');
    expect(error.text()).toContain(ru.account.errors.email_unverified);
    await error.find('a').trigger('click');
    expect(stub.api.openExternal).toHaveBeenCalledWith(SITE_LINKS.logins);
  });

  it('server_online says the server works, removes the button and refreshes the state', async () => {
    const stub = signedIn();
    withCard(stub, testCard({ status: 'offline', my_watch: false }));
    stub.api.site.setWatch = vi.fn(() => failed<boolean>('server_online'));
    const { app } = await open(path, stub);
    await watchButton(app).trigger('click');
    await flushPromises();
    expect(app.find('[data-watch] [role="alert"]').text()).toBe(ru.account.errors.server_online);
    expect(watchButton(app).exists()).toBe(false);
    expect(stub.api.site.live).toHaveBeenCalledWith([SERVER_IDS.wasteland]);
  });

  it('a guest gets an invitation to sign in instead of a request', async () => {
    const stub = stubLauncher();
    withCard(stub, testCard({ status: 'offline' }));
    const { app } = await open(path, stub);
    expect(watchButton(app).text()).toBe(ru.alerts.watch);
    expect(app.find('[data-watch-guest]').exists()).toBe(false);
    await watchButton(app).trigger('click');
    await flushPromises();
    const hint = app.find('[data-watch-guest]');
    expect(hint.text()).toContain(ru.alerts.watchGuestSignIn);
    expect(hint.find('a').attributes('href')).toBe('/accounts');
    expect(stub.api.site.setWatch).not.toHaveBeenCalled();
  });
});

describe('settings: alert kinds', () => {
  const stored: AlertSettings = { favorite_wipe: true, watched_up: false, server_removed: true };

  function toggle(app: Mounted['app'], kind: keyof AlertSettings): DOMWrapper<Element> {
    return app.find(`[data-alert-kind="${kind}"]`);
  }

  function checked(app: Mounted['app']): (string | undefined)[] {
    return app
      .findAll('[data-alert-settings] [role="switch"]')
      .map((item) => item.attributes('aria-checked'));
  }

  it('shows three switches with what the site stores', async () => {
    const stub = signedIn();
    stub.api.site.alertSettings = vi.fn(() => ok(stored));
    const { app } = await open('/settings', stub);
    const rows = app.find('[data-alert-settings]');
    for (const kind of ['favorite_wipe', 'watched_up', 'server_removed'] as const) {
      expect(rows.text()).toContain(ru.alerts.settings.kinds[kind].title);
      expect(rows.text()).toContain(ru.alerts.settings.kinds[kind].note);
      expect(toggle(app, kind).attributes('disabled')).toBeUndefined();
    }
    expect(checked(app)).toEqual(['true', 'false', 'true']);
    expect(app.find('[data-alerts-note]').exists()).toBe(false);
  });

  it('a change is sent to the site as the whole set', async () => {
    const stub = signedIn();
    stub.api.site.alertSettings = vi.fn(() => ok(stored));
    stub.api.site.setAlertSettings = vi.fn((settings: AlertSettings) => ok(settings));
    const { app } = await open('/settings', stub);
    await toggle(app, 'watched_up').trigger('click');
    await flushPromises();
    expect(stub.api.site.setAlertSettings).toHaveBeenCalledWith({ ...stored, watched_up: true });
    expect(checked(app)).toEqual(['true', 'true', 'true']);
  });

  it('a failed save rolls the switch back and says so', async () => {
    const stub = signedIn();
    stub.api.site.alertSettings = vi.fn(() => ok(stored));
    let release: (result: AccountResult<AlertSettings>) => void = () => undefined;
    stub.api.site.setAlertSettings = vi.fn(
      () =>
        new Promise<AccountResult<AlertSettings>>((resolve) => {
          release = resolve;
        }),
    );
    const { app } = await open('/settings', stub);
    await toggle(app, 'favorite_wipe').trigger('click');
    expect(checked(app)).toEqual(['false', 'false', 'true']);
    release({ ok: false, error: { code: 'offline' } });
    await flushPromises();
    expect(checked(app)).toEqual(['true', 'false', 'true']);
    expect(app.find('#settings-launcher [role="alert"]').text()).toBe(
      ru.alerts.settings.saveFailed,
    );
  });

  it('quick changes are sent one after another, each with the latest state', async () => {
    const stub = signedIn();
    stub.api.site.alertSettings = vi.fn(() => ok(stored));
    const pending: Deferred<AlertSettings>[] = [];
    const sent: AlertSettings[] = [];
    const save = vi.fn((settings: AlertSettings) => {
      const next = deferred<AlertSettings>();
      sent.push(settings);
      pending.push(next);
      return next.promise;
    });
    stub.api.site.setAlertSettings = save;
    const { app } = await open('/settings', stub);
    await toggle(app, 'favorite_wipe').trigger('click');
    await toggle(app, 'watched_up').trigger('click');
    await toggle(app, 'server_removed').trigger('click');
    expect(sent).toEqual([{ ...stored, favorite_wipe: false }]);
    pending[0]?.resolve({ ...stored, favorite_wipe: false });
    await flushPromises();
    expect(checked(app)).toEqual(['false', 'true', 'false']);
    expect(save).toHaveBeenCalledTimes(2);
    const latest = { favorite_wipe: false, watched_up: true, server_removed: false };
    expect(save).toHaveBeenLastCalledWith(latest);
    pending[1]?.resolve(latest);
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(2);
    expect(checked(app)).toEqual(['false', 'true', 'false']);
    expect(app.find('#settings-launcher [role="alert"]').exists()).toBe(false);
  });

  it('a failed save after a queued change rolls back to what the site last confirmed', async () => {
    const stub = signedIn();
    stub.api.site.alertSettings = vi.fn(() => ok(stored));
    const first = deferred<AlertSettings>();
    const answers = [first.promise];
    stub.api.site.setAlertSettings = vi.fn(() => answers.shift() ?? failed<AlertSettings>());
    const { app } = await open('/settings', stub);
    await toggle(app, 'favorite_wipe').trigger('click');
    await toggle(app, 'watched_up').trigger('click');
    first.resolve({ ...stored, favorite_wipe: false });
    await flushPromises();
    expect(stub.api.site.setAlertSettings).toHaveBeenCalledTimes(2);
    expect(checked(app)).toEqual(['false', 'false', 'true']);
    expect(app.find('#settings-launcher [role="alert"]').text()).toBe(
      ru.alerts.settings.saveFailed,
    );
  });

  it('the block is hidden while the site has not shipped the settings', async () => {
    const stub = signedIn();
    stub.api.site.alertSettings = vi.fn(() => failed<AlertSettings>('unavailable'));
    const { app } = await open('/settings', stub);
    expect(app.find('[data-alert-settings]').exists()).toBe(false);
    expect(app.find('[data-alerts-note]').exists()).toBe(false);
    expect(app.text()).not.toContain(ru.alerts.settings.title);
  });

  it('a guest sees disabled switches with a hint and no requests', async () => {
    const stub = stubLauncher();
    const { app } = await open('/settings', stub);
    expect(app.find('[data-alerts-note]').text()).toBe(ru.alerts.settings.guest);
    for (const item of app.findAll('[data-alert-settings] [role="switch"]')) {
      expect(item.attributes('disabled')).toBeDefined();
    }
    await toggle(app, 'favorite_wipe').trigger('click');
    expect(stub.api.site.alertSettings).not.toHaveBeenCalled();
    expect(stub.api.site.setAlertSettings).not.toHaveBeenCalled();
  });

  it('a load error leaves the switches disabled with an explanation', async () => {
    const stub = signedIn();
    stub.api.site.alertSettings = vi.fn(() => failed<AlertSettings>());
    const { app } = await open('/settings', stub);
    expect(app.find('[data-alerts-note]').text()).toBe(ru.alerts.settings.failed);
    for (const item of app.findAll('[data-alert-settings] [role="switch"]')) {
      expect(item.attributes('disabled')).toBeDefined();
    }
    stub.api.site.alertSettings = vi.fn(() => ok(stored));
    await app.find('[data-alerts-retry]').trigger('click');
    await flushPromises();
    expect(app.find('[data-alerts-note]').exists()).toBe(false);
    expect(app.find('[data-alerts-retry]').exists()).toBe(false);
    expect(checked(app)).toEqual(['true', 'false', 'true']);
  });
});

describe("the quiet 'vote is available again' mark", () => {
  const id = SERVER_IDS.wasteland;

  async function storesWith(
    stub: Stub,
    canVoteAt: string | null | undefined,
    now: () => Date = () => TEST_NOW,
  ): Promise<ReturnType<typeof createStores>> {
    withCard(
      stub,
      testCard(canVoteAt === undefined ? {} : { my_vote: { can_vote_at: canVoteAt } }),
    );
    const stores = createStores(contextOf(stub, now));
    await flushPromises();
    await stores.catalog.loadCard(id);
    return stores;
  }

  function dispose(stores: ReturnType<typeof createStores>): void {
    stores.favorites.dispose();
    stores.alerts.dispose();
    stores.votes.dispose();
    stores.accounts.dispose();
    stores.launch.dispose();
    stores.crashes.dispose();
    stores.deepLink.dispose();
    stores.settings.dispose();
    stores.library.dispose();
    stores.updates.dispose();
    stores.scenes.dispose();
  }

  it('is on when the site says the vote is free or its time has passed', async () => {
    const free = await storesWith(signedIn(), null);
    expect(free.feed.voteAvailable(id)).toBe(true);
    dispose(free);
    const passed = await storesWith(signedIn(), '2026-10-03T11:59:00Z');
    expect(passed.feed.voteAvailable(id)).toBe(true);
    dispose(passed);
  });

  it('is off while the pause lasts, for an unknown server and for a guest', async () => {
    const paused = await storesWith(signedIn(), '2026-10-03T12:30:00Z');
    expect(paused.feed.voteAvailable(id)).toBe(false);
    expect(paused.feed.voteAvailable(SERVER_IDS.technograd)).toBe(false);
    dispose(paused);
    const unknown = await storesWith(signedIn(), undefined);
    expect(unknown.feed.voteAvailable(id)).toBe(false);
    dispose(unknown);
    const guest = await storesWith(stubLauncher(), null);
    expect(guest.feed.voteAvailable(id)).toBe(false);
    dispose(guest);
  });

  it('turns on by itself when the pause ends and off after a new vote', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = TEST_NOW;
    const stores = await storesWith(signedIn(), '2026-10-03T12:00:20Z', () => now);
    expect(stores.feed.voteAvailable(id)).toBe(false);
    now = new Date(TEST_NOW.getTime() + 30_000);
    vi.advanceTimersByTime(30_000);
    expect(stores.feed.voteAvailable(id)).toBe(true);
    stores.votes.remember(id, '2026-10-04T12:00:00Z');
    expect(stores.feed.voteAvailable(id)).toBe(false);
    dispose(stores);
  });

  it('the list of pauses marks favourites that are not paused, and nothing else', async () => {
    const stub = signedIn();
    const paused = SERVER_IDS.technograd;
    stub.api.site.favorites = vi.fn(() => ok([id, paused]));
    stub.api.site.votePauses = vi.fn(() =>
      ok([{ serverId: paused, canVoteAt: '2026-10-03T12:30:00Z' }]),
    );
    const stores = createStores(contextOf(stub, () => TEST_NOW));
    await flushPromises();
    expect(stub.api.site.votePauses).toHaveBeenCalledTimes(1);
    expect(stores.feed.voteAvailable(id)).toBe(true);
    expect(stores.feed.voteAvailable(paused)).toBe(false);
    expect(stores.feed.voteAvailable(SERVER_IDS.emeraldValley)).toBe(false);
    dispose(stores);
  });

  it('without the list of pauses a favourite stays unmarked, a guest never asks', async () => {
    const stub = signedIn();
    stub.api.site.favorites = vi.fn(() => ok([id]));
    stub.api.site.votePauses = vi.fn(() => failed<never>('unavailable'));
    const stores = createStores(contextOf(stub, () => TEST_NOW));
    await flushPromises();
    expect(stores.feed.voteAvailable(id)).toBe(false);
    dispose(stores);
    const guest = stubLauncher();
    const guestStores = createStores(contextOf(guest, () => TEST_NOW));
    await flushPromises();
    expect(guest.api.site.votePauses).not.toHaveBeenCalled();
    dispose(guestStores);
  });

  it('a card asked before the account changed does not mark the vote for the new user', async () => {
    const stub = signedIn();
    const stores = createStores(contextOf(stub));
    await flushPromises();
    const free = testCard({ my_vote: { can_vote_at: null } });
    let release: () => void = () => undefined;
    stub.api.site.server = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<Stub['api']['site']['server']>>>((resolve) => {
          release = (): void => {
            resolve({ ok: true, value: free, stale: false, fetchedAt: TEST_NOW.toISOString() });
          };
        }),
    );
    const loading = stores.catalog.loadCard(id);
    stub.emitAccount({ change: 'signed-in', state: { ...signedState({ id: 8 }), seq: 2 } });
    release();
    await loading;
    expect(stores.feed.voteAvailable(id)).toBe(false);
    withCard(stub, free);
    await stores.catalog.loadCard(id);
    expect(stores.feed.voteAvailable(id)).toBe(true);
    dispose(stores);
  });

  it('a vote on the server page hides the mark', async () => {
    const stub = signedIn();
    stub.players.stored = {
      nicks: [{ id: 'nick-steve', nick: 'Steve' }],
      active: { kind: 'nick', id: 'nick-steve' },
    };
    withCard(stub, testCard({ status: 'online', my_vote: { can_vote_at: null } }));
    stub.api.site.vote = vi.fn(() =>
      ok({ nextVoteAt: '2026-10-04T12:00:00Z', weight: 1 as const }),
    );
    stub.api.site.servers = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          data: [testCard()],
          topSlots: { diamond: [], gold: [] },
          topSlotsFree: { diamond: 0, gold: 0 },
          meta: { page: 1, per_page: 50, total: 1 },
        },
        stale: false,
        fetchedAt: TEST_NOW.toISOString(),
      }),
    );
    const { app, router } = await open(`/server/${String(id)}`, stub);
    await app.find('[data-vote] button').trigger('click');
    await flushPromises();
    expect(stub.api.site.vote).toHaveBeenCalledTimes(1);
    await router.push('/servers');
    await flushPromises();
    expect(app.text()).not.toContain(ru.server.voteAvailable);
  });
});
