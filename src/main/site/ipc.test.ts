import { describe, expect, it, vi } from 'vitest';
import type { SiteService } from '@shared/site';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, BrowserWindow: {} }));

const { siteHandlers, trackHandler, TRACK_LIMIT, TRACK_WINDOW_MS } = await import('./ipc');

const ALERT_SETTINGS = { favorite_wipe: true, watched_up: false, server_removed: true };

function service(): SiteService {
  const empty = vi.fn(() =>
    Promise.resolve({ ok: false as const, error: { code: 'offline' as const } }),
  );
  return {
    onChanged: vi.fn(() => () => undefined),
    meta: empty,
    servers: empty,
    server: empty,
    live: empty,
    scenes: empty,
    ensureScene: empty,
    skinMod: empty,
    lookPresets: empty,
    standardSkin: vi.fn(() => Promise.resolve(null)),
    ping: vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'timeout' as const } })),
    telemetryPreview: empty,
    favorites: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'not_signed_in' as const } }),
    ),
    setFavorite: vi.fn(() => Promise.resolve({ ok: true as const, value: true })),
    vote: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { nextVoteAt: '2026-10-04T12:00:00Z', weight: 2 as const },
      }),
    ),
    report: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { at: '2026-10-03T12:00:00Z' } }),
    ),
    alerts: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { items: [], unread: 0, next: null } }),
    ),
    readAlerts: vi.fn(() => Promise.resolve({ ok: true as const, value: true as const })),
    clearAlerts: vi.fn(() => Promise.resolve({ ok: true as const, value: true as const })),
    setWatch: vi.fn(() => Promise.resolve({ ok: true as const, value: true })),
    alertSettings: vi.fn(() => Promise.resolve({ ok: true as const, value: ALERT_SETTINGS })),
    setAlertSettings: vi.fn(() => Promise.resolve({ ok: true as const, value: ALERT_SETTINGS })),
    ownedServers: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
    votePauses: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
    ownedServer: vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'forbidden' as const } }),
    ),
  };
}

describe('telemetry IPC', () => {
  const NOW = Date.parse('2026-10-12T09:00:00.000Z');

  it('the renderer can send only screens and actions; main sets the time and cleans', () => {
    const push = vi.fn();
    const track = trackHandler({ behavior: true, now: () => NOW, push });
    track({ type: 'screen.viewed', screen: 'server', server_id: 7, at: '1999-01-01', path: 'C:' });
    track({ type: 'action', name: 'search', server_id: null, length: 5, results: 2, q: 'text' });
    expect(push.mock.calls.map(([event]) => event as unknown)).toEqual([
      { type: 'screen.viewed', at: '2026-10-12T09:00:00.000Z', screen: 'server', server_id: 7 },
      {
        type: 'action',
        at: '2026-10-12T09:00:00.000Z',
        name: 'search',
        server_id: null,
        length: 5,
        results: 2,
      },
    ]);
    push.mockClear();
    for (const foreign of [
      { type: 'app.started', reason: 'user' },
      { type: 'app.closed', duration_s: 5 },
      { type: 'app.alive', state: 'playing' },
      { type: 'vote.finished', server_id: 7, outcome: 'ok' },
      { type: 'update.finished', from: '0.1.0', to: '0.2.0', outcome: 'ok', error_code: null },
      { type: 'error', area: 'ui', code: 'x' },
      { type: 'launch.finished', server_id: 7, outcome: 'ok', exit_code: 0, duration_s: 9000 },
      { type: 'launch.started', server_id: 7, minecraft: '1.21.11', nick: 'Steve' },
      { type: 'install.finished', minecraft: '1.21.11' },
      { type: 'action', name: 'unknown', server_id: null },
      { type: 'screen.viewed', screen: 'admin', server_id: null },
      null,
      'action',
      [],
    ]) {
      track(foreign);
    }
    expect(push).not.toHaveBeenCalled();
  });

  it('a flood from the renderer is cut at the per-minute limit, the next minute passes again', () => {
    const push = vi.fn();
    let now = NOW;
    const track = trackHandler({ behavior: true, now: () => now, push });
    for (let index = 0; index < TRACK_LIMIT * 20; index += 1) {
      track({ type: 'screen.viewed', screen: 'home', server_id: null });
    }
    expect(push).toHaveBeenCalledTimes(TRACK_LIMIT);
    now += TRACK_WINDOW_MS - 1;
    track({ type: 'screen.viewed', screen: 'home', server_id: null });
    expect(push).toHaveBeenCalledTimes(TRACK_LIMIT);
    now += 1;
    track({ type: 'screen.viewed', screen: 'home', server_id: null });
    expect(push).toHaveBeenCalledTimes(TRACK_LIMIT + 1);
  });

  it('with the flag off nothing from the renderer is queued', () => {
    const push = vi.fn();
    const track = trackHandler({ behavior: false, now: () => NOW, push });
    track({ type: 'screen.viewed', screen: 'home', server_id: null });
    expect(push).not.toHaveBeenCalled();
  });
});

describe('site IPC', () => {
  it('alerts: a malformed cursor, watch flag and settings never reach the service', async () => {
    const site = service();
    const handlers = siteHandlers(site);
    const rejected = { ok: false, error: { code: 'invalid_request' } };
    expect(await handlers.alerts('a b')).toEqual(rejected);
    expect(await handlers.alerts('x'.repeat(200))).toEqual(rejected);
    expect(await handlers.setWatch('7', true)).toEqual(rejected);
    expect(await handlers.setWatch(7, 1)).toEqual(rejected);
    expect(await handlers.setAlertSettings({ favorite_wipe: true })).toEqual(rejected);
    expect(await handlers.setAlertSettings({ ...ALERT_SETTINGS, email: true })).toEqual(rejected);
    expect(await handlers.ownedServer(0)).toEqual(rejected);
    expect(await handlers.readAlerts([])).toEqual(rejected);
    expect(await handlers.readAlerts([1, '2'])).toEqual(rejected);
    expect(await handlers.readAlerts('all')).toEqual(rejected);
    expect(site.readAlerts).not.toHaveBeenCalled();
    expect(site.alerts).not.toHaveBeenCalled();
    expect(site.setWatch).not.toHaveBeenCalled();
    expect(site.setAlertSettings).not.toHaveBeenCalled();
    expect(site.ownedServer).not.toHaveBeenCalled();
  });

  it('alerts: valid parameters are passed through', async () => {
    const site = service();
    const handlers = siteHandlers(site);
    await handlers.alerts(undefined);
    await handlers.alerts('eyJpZCI6NDJ9');
    await handlers.setWatch(7, false);
    await handlers.setAlertSettings(ALERT_SETTINGS);
    await handlers.ownedServer(7);
    await handlers.readAlerts(undefined);
    await handlers.readAlerts([42]);
    expect(site.readAlerts).toHaveBeenNthCalledWith(1, undefined);
    expect(site.readAlerts).toHaveBeenNthCalledWith(2, [42]);
    expect(site.alerts).toHaveBeenNthCalledWith(1, undefined);
    expect(site.alerts).toHaveBeenNthCalledWith(2, 'eyJpZCI6NDJ9');
    expect(site.setWatch).toHaveBeenCalledWith(7, false);
    expect(site.setAlertSettings).toHaveBeenCalledWith(ALERT_SETTINGS);
    expect(site.ownedServer).toHaveBeenCalledWith(7);
  });

  it('malformed parameters never reach the service', async () => {
    const site = service();
    const handlers = siteHandlers(site);
    expect(await handlers.server('3')).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'id' },
    });
    expect(await handlers.live([1, 'x'])).toMatchObject({ ok: false });
    expect(await handlers.servers({ per_page: 1000 })).toMatchObject({ ok: false });
    expect(await handlers.ensureScene('../../x', 'day')).toMatchObject({ ok: false });
    expect(await handlers.ping('file:///etc/passwd')).toMatchObject({ ok: false });
    expect(site.server).not.toHaveBeenCalled();
    expect(site.live).not.toHaveBeenCalled();
    expect(site.servers).not.toHaveBeenCalled();
    expect(site.ensureScene).not.toHaveBeenCalled();
    expect(site.ping).not.toHaveBeenCalled();
  });

  it('favorites and vote: a malformed id and nickname are not sent to the site', async () => {
    const site = service();
    const handlers = siteHandlers(site);
    expect(await handlers.setFavorite('7', true)).toEqual({
      ok: false,
      error: { code: 'invalid_request' },
    });
    expect(await handlers.setFavorite(7, 'yes')).toMatchObject({ ok: false });
    expect(await handlers.vote(7, '')).toEqual({ ok: false, error: { code: 'invalid_nick' } });
    expect(await handlers.vote(7, 'a'.repeat(40))).toMatchObject({ ok: false });
    expect(await handlers.vote(7, 'nick\u0000')).toMatchObject({ ok: false });
    expect(site.setFavorite).not.toHaveBeenCalled();
    expect(site.vote).not.toHaveBeenCalled();
    await handlers.setFavorite(7, false);
    await handlers.vote(7, ' Steve ');
    expect(site.setFavorite).toHaveBeenCalledWith(7, false);
    expect(site.vote).toHaveBeenCalledWith(7, 'Steve');
  });

  it('report: malformed id, reason and details are not sent to the site', async () => {
    const site = service();
    const handlers = siteHandlers(site);
    const invalid = { ok: false, error: { code: 'invalid_request' } };
    expect(await handlers.report('7', { reason: 'fake_stats', note: '' })).toEqual(invalid);
    expect(await handlers.report(7, null)).toEqual(invalid);
    expect(await handlers.report(7, { reason: 'fake_stats', note: '', extra: 1 })).toEqual(invalid);
    expect(await handlers.report(7, { reason: 'Fake-Stats', note: '' })).toEqual(invalid);
    expect(await handlers.report(7, { reason: 'a'.repeat(33), note: '' })).toEqual(invalid);
    expect(await handlers.report(7, { reason: 'fake_stats', note: 42 })).toEqual(invalid);
    expect(await handlers.report(7, { reason: 'fake_stats', note: 'x'.repeat(1001) })).toEqual(
      invalid,
    );
    expect(await handlers.report(7, { reason: 'other', note: '  коротко  ' })).toEqual({
      ok: false,
      error: { code: 'note_required' },
    });
    expect(site.report).not.toHaveBeenCalled();
    expect(await handlers.report(7, { reason: 'fake_stats', note: ' онлайн 5000 ' })).toEqual({
      ok: true,
      value: { at: '2026-10-03T12:00:00Z' },
    });
    expect(site.report).toHaveBeenCalledWith(7, { reason: 'fake_stats', note: 'онлайн 5000' });
    await handlers.report(7, { reason: 'cheats_allowed' });
    expect(site.report).toHaveBeenLastCalledWith(7, { reason: 'cheats_allowed', note: '' });
    await handlers.report(7, { reason: 'other', note: 'Адрес ведёт на чужой сервер' });
    expect(site.report).toHaveBeenCalledTimes(3);
  });

  it('validated parameters are sent to the service', async () => {
    const site = service();
    const handlers = siteHandlers(site);
    await handlers.server(3);
    await handlers.live([3, 4]);
    await handlers.servers({ q: 'sky', sort: 'online' });
    await handlers.ensureScene('taiga', 'night');
    await handlers.ping('play.example.ru');
    expect(site.server).toHaveBeenCalledWith(3);
    expect(site.live).toHaveBeenCalledWith([3, 4]);
    expect(site.servers).toHaveBeenCalledWith({ q: 'sky', sort: 'online' });
    expect(site.ensureScene).toHaveBeenCalledWith('taiga', 'night');
    expect(site.ping).toHaveBeenCalledWith('play.example.ru');
  });

  it('/meta bypassing the cache — only when true', async () => {
    const site = service();
    const handlers = siteHandlers(site);
    await handlers.meta();
    await handlers.meta('yes');
    await handlers.meta(true);
    expect(vi.mocked(site.meta).mock.calls).toEqual([[false], [false], [true]]);
  });
});
