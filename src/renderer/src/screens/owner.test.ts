// @vitest-environment happy-dom
import { flushPromises, type DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountResult } from '@shared/account';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { SITE_LINKS } from '@shared/links';
import type { OwnedServerDetails, OwnedServerRef } from '@shared/owner';
import { OWNED_IDS } from '../mock/owner';
import { mountScreen, unmountScreen } from '../screen-testing';
import {
  signedOutState,
  stubLauncher,
  TEST_USER,
  testCard,
  withCard,
  type Mounted,
  type Stub,
} from '../testing';

afterEach(unmountScreen);

const FIRST = 11;
const SECOND = 12;

function owned(patch: Partial<OwnedServerDetails> = {}): OwnedServerDetails {
  return {
    id: FIRST,
    name: 'Alpha',
    status: 'up',
    downSince: null,
    online: 967,
    slots: 1500,
    version: '1.20.1',
    checkedAt: '2026-10-03T11:42:00Z',
    rank: 4,
    rankWeekAgo: 3,
    votesMonth: 2184,
    points: 1250,
    pointsExpireAt: '2026-10-08T09:00:00Z',
    uptime30d: 0.987,
    attention: null,
    topSlot: null,
    onlineAvgDay: 742,
    onlineAvgPrevDay: 698,
    onlinePeakDay: { value: 1412, at: '2026-10-02T18:00:00Z' },
    downtimes30d: 4,
    votesMonthChange: 12,
    sources7d: { launcherLaunches: 4218, addressCopies: 2906, siteClicks: 1140, widgetVotes: 388 },
    votifier: { ok: true, lastErrorAt: null },
    reviews: { total: 132, fresh: 3 },
    complaints: { total: 0, fresh: 0 },
    events: [
      {
        id: 1,
        kind: 'up',
        server: null,
        at: '2026-10-03T01:21:00Z',
        read: true,
        title: 'Back online',
      },
    ],
    ...patch,
  };
}

const down = owned({
  id: SECOND,
  name: 'Beta',
  status: 'down',
  downSince: '2026-10-03T09:40:00Z',
  online: null,
});

function refOf(server: OwnedServerDetails): OwnedServerRef {
  return { id: server.id, name: server.name, status: server.status };
}

function ok<T>(value: T): Promise<AccountResult<T>> {
  return Promise.resolve({ ok: true, value });
}

function ownerStub(servers: OwnedServerDetails[]): Stub {
  const stub = stubLauncher();
  stub.api.account.state = vi.fn(() =>
    Promise.resolve({
      ...signedOutState,
      seq: 1,
      user: { ...TEST_USER, ownedServers: servers.map(refOf) },
    }),
  );
  stub.api.site.ownedServers = vi.fn(() => ok(servers));
  stub.api.site.ownedServer = vi.fn((id: number) => {
    const found = servers.find((item) => item.id === id);
    return found === undefined
      ? Promise.resolve({ ok: false as const, error: { code: 'forbidden' as const } })
      : ok(found);
  });
  return stub;
}

function open(path: string, stub: Stub): Promise<Mounted> {
  return mountScreen(path, { stub, demo: false });
}

function navItem(mounted: Mounted): DOMWrapper<Element> | undefined {
  return mounted.app.findAll('.nav-link').find((link) => link.text().includes(ru.owner.nav));
}

describe('owner sections visibility', () => {
  it('a guest sees no menu item and no table, and nothing is requested', async () => {
    const mounted = await open('/', stubLauncher());
    expect(navItem(mounted)).toBeUndefined();
    expect(mounted.app.find('.owner-table').exists()).toBe(false);
    expect(mounted.api.site.ownedServers).not.toHaveBeenCalled();
    expect(mounted.api.site.ownedServer).not.toHaveBeenCalled();
  });

  it('a signed-in user without servers sees nothing and is sent home from the screen', async () => {
    const stub = ownerStub([]);
    const mounted = await open('/my-servers', stub);
    expect(mounted.router.currentRoute.value.path).toBe('/');
    expect(navItem(mounted)).toBeUndefined();
    expect(mounted.app.find('.owner-table').exists()).toBe(false);
    expect(stub.api.site.ownedServers).not.toHaveBeenCalled();
    expect(stub.api.site.ownedServer).not.toHaveBeenCalled();
  });

  it('signing out on the owner screen leads home and clears the sections', async () => {
    const mounted = await open('/my-servers', ownerStub([owned()]));
    expect(mounted.app.find('h1').text()).toBe('Alpha');
    mounted.emitAccount({ change: 'signed-out', state: { ...signedOutState, seq: 2 } });
    await flushPromises();
    expect(mounted.router.currentRoute.value.path).toBe('/');
    expect(navItem(mounted)).toBeUndefined();
    expect(mounted.app.find('.owner-table').exists()).toBe(false);
  });
});

describe('owner table on the home screen', () => {
  it('one working server: a row with state, figures and a link to its screen', async () => {
    const mounted = await open('/', ownerStub([owned()]));
    const rows = mounted.app.findAll('.owner-table a.row');
    expect(rows).toHaveLength(1);
    const text = rows[0]?.text() ?? '';
    expect(text).toContain('Alpha');
    expect(text).toContain(fill(ru.owner.upOnline, { online: '967' }));
    expect(text).toContain(fill(ru.owner.percent, { value: '98,7' }));
    expect(text).toContain(ru.owner.table.noEvents);
    expect(rows[0]?.attributes('href')).toContain(`/my-servers/${String(FIRST)}`);
    const item = navItem(mounted);
    expect(item?.find('.count').text()).toBe('1');
    expect(item?.find('[data-mark]').exists()).toBe(false);
  });

  it('a server above the rating: a gem with words instead of a rank number', async () => {
    const slot = { tier: 'diamond', endsAt: '2026-10-09T21:00:00Z' } as const;
    const mounted = await open('/', ownerStub([owned({ topSlot: slot, rank: null })]));
    const above = mounted.app.find('.owner-table .above');
    const words = fill(ru.owner.topSlot.aboveRankTier, { tier: ru.topSlots.diamond });
    expect(above.attributes('title')).toBe(words);
    expect(above.text()).toBe(words);
    expect(above.find('svg').attributes('aria-hidden')).toBe('true');
  });

  it('a server that does not respond: words, Moscow time and a mark on the menu item', async () => {
    const mounted = await open('/', ownerStub([owned(), down]));
    const rows = mounted.app.findAll('.owner-table a.row');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.find('.state').text()).toBe(fill(ru.owner.downSince, { since: '12:40' }));
    expect(rows[1]?.text()).toContain(ru.owner.table.noOtherEvents);
    const item = navItem(mounted);
    expect(item?.find('.count').text()).toBe('2');
    expect(item?.find('[data-mark]').text()).toBe(ru.owner.navAttention);
  });

  it('attention on a working server also marks the menu item', async () => {
    const attention = { kind: 'points_expire', at: '2026-10-03T07:00:00Z', title: 'Points expire' };
    const mounted = await open('/', ownerStub([owned({ attention, pointsExpireAt: null })]));
    expect(mounted.app.find('.owner-table .note').text()).toContain('Points expire');
    expect(mounted.app.find('.owner-table .note').classes()).toContain('is-gold');
    expect(navItem(mounted)?.find('[data-mark]').exists()).toBe(true);
  });

  it('energy running out: a short line with the date instead of the site title', async () => {
    const attention = { kind: 'points_expire', at: '2026-10-03T07:00:00Z', title: 'Points expire' };
    const mounted = await open(
      '/',
      ownerStub([owned({ attention, pointsExpireAt: '2026-10-15T09:00:00Z' })]),
    );
    expect(mounted.app.find('.owner-table .note-text').text()).toBe(
      fill(ru.owner.table.energyUntil, { date: '15 октября' }),
    );
  });

  it('null fields turn into dashes', async () => {
    const empty = owned({
      online: null,
      rank: null,
      votesMonth: null,
      points: null,
      uptime30d: null,
    });
    const mounted = await open('/', ownerStub([empty]));
    const figures = mounted.app.findAll('.owner-table a.row .fig');
    expect(figures.map((item) => item.text().split(':').at(-1)?.trim())).toEqual(
      Array.from({ length: 2 }, () => ru.owner.empty),
    );
    const split = mounted.app.find('.owner-table a.row [data-split]');
    expect(split.find('[data-split-energy]').text()).toBe(ru.owner.empty);
    expect(split.find('[data-split-votes]').text()).toBe(ru.owner.empty);
    expect(split.findAll('.split-part')).toHaveLength(0);
    expect(mounted.app.find('.owner-table .state').text()).toBe(ru.owner.up);
  });

  it('a network error shows a retry that loads the table', async () => {
    const stub = ownerStub([owned()]);
    const answer = stub.api.site.ownedServers;
    stub.api.site.ownedServers = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'offline' as const } }),
    );
    const mounted = await open('/', stub);
    const fail = mounted.app.find('.owner-table .fail');
    expect(fail.text()).toContain(ru.owner.table.error);
    stub.api.site.ownedServers = answer;
    await fail.find('button').trigger('click');
    await flushPromises();
    expect(mounted.app.findAll('.owner-table a.row')).toHaveLength(1);
  });

  it('a method the site has not shipped yet hides the table without an error or a mark', async () => {
    const stub = ownerStub([owned()]);
    stub.api.site.ownedServers = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'unavailable' as const } }),
    );
    const mounted = await open('/', stub);
    expect(mounted.app.find('.owner-table').exists()).toBe(false);
    expect(mounted.app.text()).not.toContain(ru.owner.table.error);
    const item = navItem(mounted);
    expect(item?.find('.count').text()).toBe('1');
    expect(item?.find('[data-mark]').exists()).toBe(false);
  });

  it('the cabinet link opens the site in the browser', async () => {
    const mounted = await open('/', ownerStub([owned()]));
    await mounted.app.find('.owner-table .cabinet').trigger('click');
    expect(mounted.api.openExternal).toHaveBeenCalledWith(SITE_LINKS.cabinet);
  });

  it('markup in the attention title stays text', async () => {
    const attention = {
      kind: 'other',
      at: '2026-10-03T07:00:00Z',
      title: '<img src=x><b>bold</b>',
    };
    const mounted = await open('/', ownerStub([owned({ attention })]));
    const note = mounted.app.find('.owner-table .note-text');
    expect(note.text()).toBe('<img src=x><b>bold</b>');
    expect(mounted.app.find('.owner-table img[src="x"]').exists()).toBe(false);
    expect(mounted.app.find('.owner-table b').exists()).toBe(false);
  });
});

describe('my servers screen', () => {
  it('top slot: tier, end date, time left and a link to extend', async () => {
    const stub = ownerStub([owned({ topSlot: { tier: 'gold', endsAt: '2026-10-04T21:00:00Z' } })]);
    const { app } = await open('/my-servers', stub);
    const panel = app.find('[aria-labelledby="owner-top-slot"]');
    expect(panel.find('.slot-tier').text()).toBe(ru.owner.topSlot.tiers.gold);
    expect(panel.find('.slot-until').text()).toBe(
      fill(ru.owner.topSlot.until, { date: '5 октября', time: '00:00' }),
    );
    expect(panel.find('.slot-left').classes()).toContain('is-soon');
    expect(panel.find('.slot-left b').text()).toBe('2\u00a0дня');
    expect(panel.find('.lx-panel-head').text()).toContain(ru.owner.topSlot.extend);
    await panel.find('.lx-panel-head a').trigger('click');
    expect(stub.api.telemetry.track).toHaveBeenCalledWith({
      type: 'action',
      name: 'top_slot_extend',
      server_id: FIRST,
    });
    expect(panel.find('.slot-gem').classes()).toContain('is-gold');
    expect(panel.find('.slot-gem svg').attributes('aria-hidden')).toBe('true');
  });

  it('a slot that has ended: no panel and a dash for the rank', async () => {
    const slot = { tier: 'diamond', endsAt: '2026-10-01T21:00:00Z' } as const;
    const stub = ownerStub([owned({ topSlot: slot, rank: null, rankWeekAgo: null })]);
    const { app } = await open('/my-servers', stub);
    expect(app.find('[aria-labelledby="owner-top-slot"]').exists()).toBe(false);
    expect(app.findAll('.stat')[3]?.find('.stat-value').text()).toBe(ru.owner.empty);
  });

  it('events: repeats fold into one, five rows and the rest behind a button', async () => {
    const event = (id: number, title: string): OwnedServerDetails['events'][number] => ({
      id,
      kind: 'up',
      server: null,
      at: '2026-10-03T01:21:00Z',
      read: true,
      title,
    });
    const events = [
      event(0, 'Event 1'),
      ...Array.from({ length: 7 }, (_, index) => event(index + 1, `Event ${String(index + 1)}`)),
    ];
    const { app } = await open('/my-servers', ownerStub([owned({ events })]));
    expect(app.findAll('.event')).toHaveLength(5);
    const more = app.find('.events-more');
    expect(more.text()).toBe(fill(ru.owner.events.more, { count: 2 }));
    expect(more.attributes('aria-expanded')).toBe('false');
    await more.trigger('click');
    expect(app.findAll('.event')).toHaveLength(7);
    expect(more.text()).toBe(ru.owner.events.less);
    expect(more.attributes('aria-expanded')).toBe('true');
  });

  it('a server that is down: a dash for the online count, no slots next to it', async () => {
    const { app } = await open('/my-servers', ownerStub([owned({ status: 'down' })]));
    const online = app.find('[data-stat="online"]');
    expect(online.find('.stat-value').text()).toBe(ru.owner.empty);
    expect(online.find('.stat-note').exists()).toBe(false);
  });

  it('votes going down are marked and worded with a minus', async () => {
    const { app } = await open('/my-servers', ownerStub([owned({ votesMonthChange: -8 })]));
    const change = app.find('[data-stat="split"] .split-change');
    expect(change.text()).toBe(fill(ru.owner.stats.changeDown, { value: '8' }));
    expect(change.classes()).toContain('is-down');
  });

  it('a server above the rating shows that instead of a rank number', async () => {
    const slot = { tier: 'gold', endsAt: '2026-10-09T21:00:00Z' } as const;
    const stub = ownerStub([owned({ topSlot: slot, rank: null, rankWeekAgo: null })]);
    const { app } = await open('/my-servers', stub);
    const rank = app.findAll('.stat')[3];
    expect(rank?.find('dt').text()).toBe(ru.owner.topSlot.aboveRank);
    expect(rank?.find('.stat-value').text()).toBe(ru.owner.topSlot.tiers.gold);
    expect(rank?.find('.stat-value svg').exists()).toBe(true);
    expect(rank?.find('.stat-note').text()).toBe(
      fill(ru.owner.stats.slotUntil, { date: '10 октября' }),
    );
  });

  it('no top slot but a free one on the site: an offer to take it', async () => {
    const stub = ownerStub([owned()]);
    stub.api.site.servers = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          data: [],
          topSlots: { diamond: [], gold: [] },
          topSlotsFree: { diamond: 0, gold: 2 },
          meta: { page: 1, per_page: 1, total: 0 },
        },
        stale: false,
        fetchedAt: '2026-10-03T11:42:00Z',
      }),
    );
    const { app } = await open('/my-servers', stub);
    const panel = app.find('[aria-labelledby="owner-top-slot"]');
    expect(panel.find('[data-slot="free"]').text()).toContain(ru.owner.topSlot.free.gold);
    expect(panel.find('.lx-panel-head').text()).toContain(ru.owner.topSlot.take);
    await panel.find('.lx-panel-head a').trigger('click');
    expect(stub.api.telemetry.track).toHaveBeenCalledWith({
      type: 'action',
      name: 'top_slot_take',
      server_id: FIRST,
    });
  });

  it('a launcher-only server: the caption instead of the address', async () => {
    const stub = ownerStub([owned()]);
    const card = testCard();
    withCard(stub, { ...card, launch: { kind: 'direct', minecraft: '26.2', launcherOnly: true } });
    const { app } = await open('/my-servers', stub);
    expect(app.find('[data-launcher-only]').text()).toBe(ru.server.launcherOnly);
    expect(app.html()).not.toContain(card.address.host);
  });

  it('one server: header, five figures, panels and no switcher', async () => {
    const stub = ownerStub([owned()]);
    withCard(
      stub,
      testCard({
        downtimes: [{ from: '2026-10-03T01:12:00Z', to: '2026-10-03T01:21:00Z' }],
      }),
    );
    const mounted = await open('/my-servers', stub);
    const { app } = mounted;
    expect(stub.api.site.ownedServer).toHaveBeenCalledWith(FIRST);
    expect(app.find('h1').text()).toBe('Alpha');
    expect(app.find('[data-status]').text()).toBe(ru.owner.upTag);
    expect(app.find('.head-meta').text()).toContain(
      fill(ru.owner.head.updatedAt, { time: '14:42' }),
    );
    expect(app.find('.head select').exists()).toBe(false);
    expect(app.find('[data-owner="down"]').exists()).toBe(false);
    const stats = app.findAll('.stat').map((item) => item.text());
    expect(stats).toHaveLength(5);
    expect(stats[0]).toContain(fill(ru.owner.stats.ofSlots, { slots: '1\u00a0500' }));
    expect(stats[1]).toContain(fill(ru.owner.stats.yesterday, { value: '698' }));
    expect(stats[2]).toContain(fill(ru.owner.percent, { value: '98,7' }));
    expect(stats[2]).toContain(`4\u00a0${ru.owner.stats.downtimes[1]}`);
    expect(stats[3]).toContain(fill(ru.owner.stats.rankWeekAgo, { rank: '3' }));
    expect(stats[4]).toContain(fill(ru.owner.stats.changeUp, { value: '12' }));
    const split = app.find('[data-stat="split"]');
    const change = split.find('.split-change');
    expect(change.text()).toBe(fill(ru.owner.stats.changeUp, { value: '12' }));
    expect(change.classes()).toContain('is-up');
    expect(change.attributes('title')).toBe(ru.owner.stats.changeHint);
    expect(app.findAll('rect.downtime')).toHaveLength(1);
    expect(app.find('.legend').text()).toContain('04:12–04:21');
    expect(app.findAll('.sources dt')).toHaveLength(4);
    expect(app.find('.event-meta').text()).toBe(
      fill(ru.owner.events.at, { day: ru.time.today, time: '04:21' }),
    );
    expect(app.find('[data-fact="votifier"]').text()).toBe(ru.owner.rating.votifierOk);
    expect(app.find('[data-fact="complaints"]').text()).toBe(ru.owner.rating.none);
    await app
      .findAll('.head a')
      .find((link) => link.text().includes(ru.owner.cabinet))
      ?.trigger('click');
    expect(mounted.api.openExternal).toHaveBeenCalledWith(SITE_LINKS.cabinet);
  });

  it('several servers: the switcher lists them and opens the chosen one', async () => {
    const stub = ownerStub([owned(), down]);
    const mounted = await open('/my-servers', stub);
    const select = mounted.app.find('.head select');
    expect(select.attributes('aria-label')).toBe(ru.owner.head.switch);
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      fill(ru.owner.head.option, { name: 'Alpha', state: ru.owner.up }),
      fill(ru.owner.head.option, { name: 'Beta', state: ru.owner.down }),
    ]);
    await select.setValue(String(SECOND));
    await flushPromises();
    expect(mounted.router.currentRoute.value.path).toBe(`/my-servers/${String(SECOND)}`);
    expect(stub.api.site.ownedServer).toHaveBeenLastCalledWith(SECOND);
    expect(mounted.app.find('h1').text()).toBe('Beta');
  });

  it('another account with the same server reloads the details at once', async () => {
    const stub = ownerStub([owned()]);
    const mounted = await open('/my-servers', stub);
    expect(stub.api.site.ownedServer).toHaveBeenCalledTimes(1);
    stub.api.site.ownedServer = vi.fn(() => ok(owned({ name: 'Alpha of another owner' })));
    mounted.emitAccount({
      change: 'signed-in',
      state: {
        ...signedOutState,
        seq: 2,
        user: { ...TEST_USER, id: 8, ownedServers: [refOf(owned())] },
      },
    });
    await flushPromises();
    expect(stub.api.site.ownedServer).toHaveBeenCalledWith(FIRST);
    expect(mounted.app.find('h1').text()).toBe('Alpha of another owner');
  });

  it('a server that does not respond: the notice comes first, online is a dash', async () => {
    const mounted = await open(`/my-servers/${String(SECOND)}`, ownerStub([owned(), down]));
    const notice = mounted.app.find('[data-owner="down"]');
    expect(notice.find('h2').text()).toBe(fill(ru.owner.downSinceTitle, { since: '12:40' }));
    expect(notice.attributes('data-state-tone')).toBe('danger');
    expect(mounted.app.find('[data-status]').text()).toBe(ru.owner.downTag);
    expect(mounted.app.find('.stat .stat-value').text()).toBe(ru.owner.empty);
  });

  it('null and empty fields: dashes, no notes, hidden player actions, empty journal', async () => {
    const empty = owned({
      online: null,
      slots: null,
      version: null,
      checkedAt: null,
      rank: null,
      rankWeekAgo: null,
      votesMonth: null,
      points: null,
      pointsExpireAt: null,
      uptime30d: null,
      onlineAvgDay: null,
      onlineAvgPrevDay: null,
      onlinePeakDay: null,
      downtimes30d: null,
      votesMonthChange: null,
      sources7d: null,
      votifier: null,
      reviews: null,
      complaints: null,
      events: [],
    });
    const { app } = await open('/my-servers', ownerStub([empty]));
    expect(app.findAll('.stat-value').map((item) => item.text())).toEqual(
      Array.from({ length: 4 }, () => ru.owner.empty),
    );
    expect(app.find('.stat-note').exists()).toBe(false);
    const split = app.find('[data-stat="split"]');
    expect(split.find('[data-split-energy]').text()).toBe(ru.owner.empty);
    expect(split.find('[data-split-votes]').text()).toBe(ru.owner.empty);
    expect(split.find('.split-until').exists()).toBe(false);
    expect(split.find('.split-change').exists()).toBe(false);
    expect(app.find('.sources').exists()).toBe(false);
    expect(app.find('.events').exists()).toBe(false);
    expect(app.find('.events-empty').text()).toBe(ru.owner.events.empty);
    expect(app.findAll('.facts dd').map((item) => item.text())).toEqual(
      Array.from({ length: 3 }, () => ru.owner.empty),
    );
    expect(app.find('.address').exists()).toBe(false);
    expect(app.text()).toContain(ru.serverPage.chartEmpty);
  });

  it('a network error shows the site error with a retry that loads the screen', async () => {
    const stub = ownerStub([owned()]);
    const answer = stub.api.site.ownedServer;
    stub.api.site.ownedServer = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'offline' as const } }),
    );
    const mounted = await open('/my-servers', stub);
    const fail = mounted.app.find('.site-error');
    expect(fail.text()).toContain(ru.state.offlineTitle);
    expect(mounted.app.find('.stats').exists()).toBe(false);
    stub.api.site.ownedServer = answer;
    await fail.find('button').trigger('click');
    await flushPromises();
    expect(mounted.app.find('h1').text()).toBe('Alpha');
  });

  it("someone else's server: a notice with a link home", async () => {
    const mounted = await open('/my-servers/999', ownerStub([owned()]));
    const notice = mounted.app.find('[data-owner="forbidden"]');
    expect(notice.text()).toContain(ru.owner.forbidden.title);
    expect(notice.find('a').attributes('href')).toBe('/');
    expect(mounted.app.find('.stats').exists()).toBe(false);
  });

  it('a rejected session leads home', async () => {
    const stub = ownerStub([owned()]);
    stub.api.site.ownedServer = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'unauthenticated' as const } }),
    );
    const mounted = await open('/my-servers', stub);
    expect(mounted.router.currentRoute.value.path).toBe('/');
  });

  it('markup in an event title stays text', async () => {
    const hostile = owned({
      events: [
        {
          id: 9,
          kind: 'something_new',
          server: null,
          at: '2026-10-01T10:00:00Z',
          read: false,
          title: '<img src=x onerror=alert(1)><b>bold</b>',
        },
      ],
    });
    const { app } = await open('/my-servers', ownerStub([hostile]));
    expect(app.find('.event-title').text()).toBe('<img src=x onerror=alert(1)><b>bold</b>');
    expect(app.find('.events img').exists()).toBe(false);
    expect(app.find('.events b').exists()).toBe(false);
    expect(app.find('.event [data-icon="info-circle"]').exists()).toBe(true);
  });
});

describe('owner sections in the demo', () => {
  it('shows the made-up servers on the home screen and on the owner screen', async () => {
    const mounted = await mountScreen('/');
    expect(mounted.app.findAll('.owner-table a.row')).toHaveLength(2);
    await mounted.router.push(`/my-servers/${String(OWNED_IDS.kubograd)}`);
    await flushPromises();
    expect(mounted.app.find('[data-owner="down"]').exists()).toBe(true);
    expect(mounted.api.site.ownedServers).not.toHaveBeenCalled();
    expect(mounted.api.site.ownedServer).not.toHaveBeenCalled();
  });
});
