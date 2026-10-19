// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_BAN_REASON_LENGTH, type PlayBan } from '@shared/account';
import { ru } from '@shared/i18n/ru';
import { banExpired, banView } from '../lib/ban';
import { SERVER_IDS } from '../mock/servers';
import { failedEvent, openScreen as open, serverName, unmountScreen } from '../screen-testing';
import { launchEvent, type Mounted } from '../testing';

const NOW = new Date('2026-10-13T09:00:00Z');
const UNTIL = '2026-10-20T18:00:00Z';
const LAUNCH = `/launch/${String(SERVER_IDS.cubeIsland)}`;
const NAME = serverName(SERVER_IDS.cubeIsland);

afterEach(unmountScreen);

function plain(text: string): string {
  return text.replace(/\u00a0/g, ' ');
}

function term(ban: PlayBan): string | null {
  const text = banView(ban, 'MineDest', NOW).term;
  return text === null ? null : plain(text);
}

async function banned(ban: PlayBan): Promise<Mounted> {
  const mounted = await open(LAUNCH);
  const play = mounted.app.findAll('button').find((item) => item.text() === ru.install.start);
  await play?.trigger('click');
  await flushPromises();
  mounted.emit(failedEvent({ code: 'banned', ...ban }));
  await flushPromises();
  return mounted;
}

describe('the text of a ban', () => {
  it('a term and a reason', () => {
    const view = banView({ until: UNTIL, reason: 'гриф спавна', forever: false }, 'MineDest', NOW);
    expect({
      title: plain(view.title),
      term: plain(view.term ?? ''),
      note: plain(view.note),
      action: plain(view.action),
    }).toEqual({
      title: 'MineDest закрыл вам вход',
      term: 'До 20 октября. Причина: гриф спавна.',
      note: 'Это решение владельца сервера. На других серверах оно не действует.',
      action: 'Другие серверы',
    });
  });

  it('a term without a reason says nothing about a reason', () => {
    expect(term({ until: UNTIL, reason: null, forever: false })).toBe('До 20 октября.');
    expect(term({ until: UNTIL, reason: '  ', forever: false })).toBe('До 20 октября.');
  });

  it('no term with a reason', () => {
    expect(term({ until: null, reason: 'гриф спавна', forever: true })).toBe(
      'Навсегда. Причина: гриф спавна.',
    );
  });

  it('no term and no reason', () => {
    expect(term({ until: null, reason: null, forever: true })).toBe('Навсегда.');
  });

  it('the day is the one in Moscow, and another year is named', () => {
    expect(term({ until: '2026-10-20T21:30:00Z', reason: null, forever: false })).toBe(
      'До 21 октября.',
    );
    expect(term({ until: '2027-01-09T12:00:00Z', reason: null, forever: false })).toBe(
      'До 9 января 2027.',
    );
  });

  it('a reason that ends its own sentence gets no second full stop, a long one is cut', () => {
    expect(term({ until: null, reason: 'Читы!', forever: true })).toBe('Навсегда. Причина: Читы!');
    const long = term({ until: null, reason: 'я'.repeat(4000), forever: true }) ?? '';
    expect(long.length).toBeLessThan(MAX_BAN_REASON_LENGTH + 40);
    expect(long.endsWith('….')).toBe(false);
  });

  it('braces in the reason are text, not a template', () => {
    expect(term({ until: null, reason: '{server} {date}', forever: true })).toBe(
      'Навсегда. Причина: {server} {date}.',
    );
  });

  it('a term the launcher could not read is not called forever: only the reason is left', () => {
    expect(term({ until: null, reason: 'гриф спавна', forever: false })).toBe(
      'Причина: гриф спавна.',
    );
    expect(term({ until: null, reason: null, forever: false })).toBeNull();
  });

  it('a ban is over once its term has passed; a ban without a term never is', () => {
    const until = (at: string | null): PlayBan => ({
      until: at,
      reason: null,
      forever: at === null,
    });
    expect(banExpired(until('2026-10-13T08:59:59Z'), NOW)).toBe(true);
    expect(banExpired(until('2026-10-13T09:00:01Z'), NOW)).toBe(false);
    expect(banExpired(until(null), NOW)).toBe(false);
    expect(banExpired({ until: null, reason: null, forever: false }, NOW)).toBe(false);
  });
});

describe('the ban on the launch screen', () => {
  it('replaces the launch: a title with the server name, two lines and one button, no steps and no Play', async () => {
    const { app } = await banned({ until: null, reason: 'гриф спавна', forever: true });
    const block = app.find('[data-ban]');
    expect(plain(block.find('h2').text())).toBe(`${NAME} закрыл вам вход`);
    expect(block.findAll('p').map((line) => plain(line.text()))).toEqual([
      'Навсегда. Причина: гриф спавна.',
      'Это решение владельца сервера. На других серверах оно не действует.',
    ]);
    expect(block.findAll('button').map((button) => button.text())).toEqual([ru.ban.action]);
    expect(app.find('.steps').exists()).toBe(false);
    expect(app.find('.actions').findAll('button')).toHaveLength(0);
    expect(app.find('.notice.is-error').exists()).toBe(false);
    expect(app.find('.lx-eyebrow').attributes('data-eyebrow')).toBe('muted');
    expect(block.text()).not.toContain('компьютер');
  });

  it('an unread term leaves the title, the note and the button', async () => {
    const { app } = await banned({ until: null, reason: null, forever: false });
    const block = app.find('[data-ban]');
    expect(block.findAll('p').map((line) => plain(line.text()))).toEqual([
      'Это решение владельца сервера. На других серверах оно не действует.',
    ]);
    expect(block.find('button').exists()).toBe(true);
  });

  it("a ban whose term has passed is not shown: 'Play' is back and asks the site again", async () => {
    const { app, api } = await banned({
      until: '2020-01-01T00:00:00Z',
      reason: 'гриф спавна',
      forever: false,
    });
    expect(app.find('[data-ban]').exists()).toBe(false);
    expect(app.find('.notice[role="alert"]').exists()).toBe(false);
    expect(app.find('.steps').exists()).toBe(true);
    const play = app.findAll('button').find((item) => item.text() === ru.install.start);
    await play?.trigger('click');
    await flushPromises();
    expect(api.launch.launch).toHaveBeenCalledTimes(2);
  });

  it("the ban does not stick: leaving the screen and coming back shows 'Play' again", async () => {
    const { app, router, api } = await banned({ until: null, reason: null, forever: true });
    await router.push('/library');
    await flushPromises();
    await router.push(LAUNCH);
    await flushPromises();
    expect(app.find('[data-ban]').exists()).toBe(false);
    const play = app.findAll('button').find((item) => item.text() === ru.install.start);
    await play?.trigger('click');
    await flushPromises();
    expect(api.launch.launch).toHaveBeenCalledTimes(2);
  });

  it('a ban of one server is not cleared by leaving the launch screen of another', async () => {
    const mounted = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await mounted.app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    mounted.emit(
      launchEvent({ kind: 'phase', phase: 'running', operationId: 1 }, { phase: 'running' }),
    );
    await flushPromises();
    await mounted.router.push(`/launch/${String(SERVER_IDS.pixelCity)}`);
    await flushPromises();
    const error = { code: 'banned', until: null, reason: null, forever: true } as const;
    mounted.emit(
      launchEvent(
        { kind: 'failed', error, source: 'process' },
        {
          phase: 'running',
          operationId: 1,
          windowReady: true,
          lastError: { error, source: 'process', operationId: 1, at: '2026-10-13T09:00:00Z' },
        },
      ),
    );
    await flushPromises();
    expect(mounted.app.find('[data-ban]').exists()).toBe(false);
    await mounted.router.push('/library');
    await flushPromises();
    await mounted.router.push(LAUNCH);
    await flushPromises();
    expect(mounted.app.find('[data-ban]').exists()).toBe(true);
  });

  it('going straight to the launch screen of another server clears the ban that was shown', async () => {
    const { app, router } = await banned({ until: null, reason: null, forever: true });
    await router.push(`/launch/${String(SERVER_IDS.pixelCity)}`);
    await flushPromises();
    await router.push(LAUNCH);
    await flushPromises();
    expect(app.find('[data-ban]').exists()).toBe(false);
  });

  it("'Other servers' leads to the catalog", async () => {
    const { app, router } = await banned({ until: null, reason: null, forever: true });
    await app.find('[data-ban] button').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/servers');
  });

  it('a reason with markup is shown as the text it is', async () => {
    const reason = '<img src=x onerror=alert(1)><a href="https://evil.example">сюда</a>';
    const { app } = await banned({ until: null, reason, forever: true });
    const block = app.find('[data-ban]');
    expect(block.text()).toContain(reason);
    expect(block.find('img').exists()).toBe(false);
    expect(block.find('a').exists()).toBe(false);
  });

  it('a ban that came while the game runs is shown on this server, and the game can still be closed', async () => {
    const mounted = await open(LAUNCH);
    const play = mounted.app.findAll('button').find((item) => item.text() === ru.install.start);
    await play?.trigger('click');
    await flushPromises();
    const error = { code: 'banned', until: null, reason: null, forever: true } as const;
    mounted.emit(
      launchEvent(
        { kind: 'failed', error, source: 'process' },
        {
          phase: 'running',
          operationId: 1,
          windowReady: true,
          lastError: { error, source: 'process', operationId: 1, at: '2026-10-13T09:00:00Z' },
        },
      ),
    );
    await flushPromises();
    expect(mounted.app.find('[data-ban]').exists()).toBe(true);
    const buttons = mounted.app.find('.actions').findAll('button');
    expect(buttons.map((button) => button.text())).toEqual([ru.install.kill]);
    expect(mounted.api.launch.kill).not.toHaveBeenCalled();
  });
});

describe('what the site learns', () => {
  it('the privacy table tells it and says how to turn it off', async () => {
    const { app } = await open('/settings');
    const row = app.find('tr[data-privacy="play-session"]');
    expect(row.text()).toContain(ru.privacy.playSessionWhat);
    expect(row.find('td:last-child').text()).toBe(ru.privacy.playSessionOff);
  });
});
