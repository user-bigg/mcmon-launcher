// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@shared/i18n/ru';
import { findServer, SERVER_IDS } from '../mock/servers';
import { openScreen as open, unmountScreen } from '../screen-testing';

const LAUNCHER_ONLY = SERVER_IDS.emeraldValley;
const host = findServer(LAUNCHER_ONLY)?.address.host ?? 'missing';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  unmountScreen();
  vi.useRealTimers();
});

describe('a launcher-only server shows no address', () => {
  it('the demo server is launcher-only', () => {
    expect(findServer(LAUNCHER_ONLY)?.launch).toMatchObject({ launcherOnly: true });
  });

  it('server page: the caption, no address and no copy button', async () => {
    const { app } = await open(`/server/${String(LAUNCHER_ONLY)}`);
    expect(app.find('.head [data-launcher-only]').text()).toBe(ru.server.launcherOnly);
    expect(app.html()).not.toContain(host);
    expect(app.html()).not.toContain(ru.serverPage.copyAddress);
  });

  it('launch screen: the caption among the sources, the join step without the address', async () => {
    const { app } = await open(`/launch/${String(LAUNCHER_ONLY)}`);
    expect(app.find('dd[data-launcher-only]').text()).toBe(ru.server.launcherOnly);
    expect(app.text()).toContain(ru.install.stepTitles.joinServer);
    expect(app.html()).not.toContain(host);
  });

  it('play sends the flag to main', async () => {
    const { app, api } = await open(`/launch/${String(LAUNCHER_ONLY)}`);
    const play = app.findAll('button').find((item) => item.text() === ru.launch.play);
    await play?.trigger('click');
    await flushPromises();
    expect(api.launch.launch).toHaveBeenCalledWith(expect.objectContaining({ launcherOnly: true }));
  });

  it('the question of an mcmonitor:// link: the caption, no address', async () => {
    const { app, emitDeepLink } = await open('/');
    emitDeepLink({ kind: 'play', serverId: LAUNCHER_ONLY });
    await flushPromises();
    const dialog = app.find('[role="alertdialog"]');
    expect(dialog.find('[data-launcher-only]').text()).toBe(ru.server.launcherOnly);
    expect(app.html()).not.toContain(host);
  });

  it('the launcher search does not find it by the address', async () => {
    const { app, router } = await open('/servers');
    await router.push({ path: '/servers', query: { q: host } });
    await flushPromises();
    expect(app.findAll('.srow:not(.is-top-slot)')).toHaveLength(0);
    const other = findServer(SERVER_IDS.pixelCity)?.address.host ?? 'missing';
    await router.push({ path: '/servers', query: { q: other } });
    await flushPromises();
    expect(app.findAll('.srow:not(.is-top-slot)')).toHaveLength(1);
  });
});
