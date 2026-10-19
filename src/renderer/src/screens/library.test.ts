// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerInstanceInfo } from '@shared/instance';
import { countOf, fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { serverEntries } from '../mock/player';
import { serverCard, SERVER_IDS } from '../mock/servers';
import { mountScreen, openScreen as open, serverName, unmountScreen } from '../screen-testing';
import { formatBytes } from '../lib/units';
import { stubLauncher, TEST_NOW, type Mounted } from '../testing';

afterEach(unmountScreen);

const cube: ServerInstanceInfo = {
  folderId: `server-${String(SERVER_IDS.cubeIsland)}`,
  serverId: SERVER_IDS.cubeIsland,
  sizeBytes: 700 * 1024 * 1024,
  lastPlayedAt: '2026-10-02T10:00:00Z',
  installed: { minecraft: '1.21.4', loader: { kind: 'vanilla', version: null } },
};

function withFolders(folders: ServerInstanceInfo[]): ReturnType<typeof stubLauncher> {
  const stub = stubLauncher();
  stub.api.instances.list = (): ReturnType<typeof stub.api.instances.list> =>
    Promise.resolve({ ok: true, value: folders });
  stub.api.site.server = vi.fn((id: number) => {
    const value = serverCard(id, TEST_NOW.getTime());
    return Promise.resolve(
      value === undefined
        ? { ok: false as const, error: { code: 'not-found' as const } }
        : { ok: true as const, value, stale: false, fetchedAt: TEST_NOW.toISOString() },
    );
  });
  return stub;
}

async function library(folders: ServerInstanceInfo[]): Promise<Mounted> {
  const mounted = await mountScreen('/library', { stub: withFolders(folders), demo: false });
  await flushPromises();
  return mounted;
}

describe('library', () => {
  it('lists server folders from disk with name, version and size', async () => {
    const stray: ServerInstanceInfo = { ...cube, folderId: 'server-777', serverId: 777 };
    const { app } = await mountScreen('/library', {
      stub: withFolders([cube, stray]),
      demo: false,
    });
    await flushPromises();
    expect(app.findAll('.inst')).toHaveLength(2);
    const card = app.find(`[data-entry="${cube.folderId}"]`);
    expect(card.text()).toContain('1.21.4');
    expect(card.text()).toContain(formatBytes(cube.sizeBytes));
    expect(card.find('a.stretched').attributes('href')).toContain(
      `/server/${String(SERVER_IDS.cubeIsland)}`,
    );
    expect(app.find('[data-entry="server-777"]').text()).toContain(
      fill(ru.library.serverFallback, { id: 777 }),
    );
  });

  it('the summary counts servers and the shared game files beside their folders', async () => {
    const stub = withFolders([cube]);
    const shared = 2 * 1024 ** 3;
    stub.api.instances.sharedFiles = (): ReturnType<typeof stub.api.instances.sharedFiles> =>
      Promise.resolve({ ok: true, value: { bytes: shared } });
    const { app } = await mountScreen('/library', { stub, demo: false });
    await flushPromises();
    const summary = app.find('[data-library-summary]').text();
    expect(summary).toContain(countOf(1, ru.plural.servers));
    expect(summary).toContain(formatBytes(cube.sizeBytes + shared));
  });

  it('removing a server folder asks first, then goes to the service by folder', async () => {
    const { app, api } = await library([cube]);
    const name = serverName(SERVER_IDS.cubeIsland);
    await app.find('[data-remove]').trigger('click');
    await flushPromises();
    const dialog = app.find('[data-confirm]');
    expect(dialog.attributes('role')).toBe('alertdialog');
    const question = app.find(`#${dialog.attributes('aria-labelledby') ?? ''}`);
    expect(question.text()).toBe(fill(ru.library.removeConfirm, { name }));
    expect(api.instances.remove).not.toHaveBeenCalled();
    await app.find('[data-remove-yes]').trigger('click');
    await flushPromises();
    expect(api.instances.remove).toHaveBeenCalledWith(cube.folderId);
  });

  it('the question takes the focus to «Keep», and «Keep» gives it back to the bin', async () => {
    const { app } = await library([cube]);
    await app.find('[data-remove]').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(app.find('[data-remove-no]').element);
    await app.find('[data-remove-no]').trigger('click');
    await flushPromises();
    expect(app.find('[data-confirm]').exists()).toBe(false);
    expect(document.activeElement).toBe(app.find('[data-remove]').element);
  });

  it('while the folder is removed, neither the bin nor «Play» can be pressed', async () => {
    const stub = withFolders([cube]);
    let finish: () => void = () => undefined;
    stub.api.instances.remove = vi.fn(
      () =>
        new Promise<{ ok: true; value: null }>((resolve) => {
          finish = (): void => {
            resolve({ ok: true, value: null });
          };
        }),
    );
    const { app } = await mountScreen('/library', { stub, demo: false });
    await flushPromises();
    await app.find('[data-remove]').trigger('click');
    await app.find('[data-remove-yes]').trigger('click');
    await flushPromises();
    expect(app.find('[data-remove-yes]').attributes('disabled')).toBeDefined();
    expect(app.find('[data-remove]').attributes('disabled')).toBeDefined();
    finish();
    await flushPromises();
  });

  it('a running game keeps its folder, and the refusal says so', async () => {
    const stub = withFolders([cube]);
    stub.api.instances.remove = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'server-in-use' as const } }),
    );
    const { app } = await mountScreen('/library', { stub, demo: false });
    await flushPromises();
    await app.find('[data-remove]').trigger('click');
    await app.find('[data-remove-yes]').trigger('click');
    await flushPromises();
    expect(app.find('[role="alert"]').text()).toContain(ru.launchError['server-in-use'].title);
    expect(app.find('[role="alert"]').text()).not.toContain(ru.launchError.busy.title);
  });

  it('a server gone from the catalog cannot be played and says why; it can be removed', async () => {
    const stray: ServerInstanceInfo = { ...cube, folderId: 'server-777', serverId: 777 };
    const { app } = await library([stray]);
    const card = app.find('[data-entry="server-777"]');
    expect(card.find('[data-unavailable]').text()).toBe(ru.library.gone);
    const play = card.findAll('button').find((item) => item.text().includes(ru.launch.play));
    expect(play?.attributes('disabled')).toBeDefined();
    expect(card.find('[data-remove]').attributes('disabled')).toBeUndefined();
  });

  it('an empty library leads to the catalog', async () => {
    const { app } = await mountScreen('/library', { stub: withFolders([]), demo: false });
    await flushPromises();
    const empty = app.find('[data-library-empty]');
    expect(empty.text()).toContain(ru.library.empty);
    expect(empty.find('a').attributes('href')).toContain('/servers');
    expect(app.find('[data-library-summary]').exists()).toBe(false);
    const item = app.findAll('nav a').find((link) => link.text().includes(ru.nav.library));
    expect(item?.text()).toBe(ru.nav.library);
  });

  it('the menu counts the installed servers', async () => {
    const { app } = await mountScreen('/library', { stub: withFolders([cube]), demo: false });
    await flushPromises();
    const item = app.findAll('nav a').find((link) => link.text().includes(ru.nav.library));
    expect(item?.text()).toContain('1');
  });

  it('card covers without parallax and drift', async () => {
    const { app } = await open('/library');
    const covers = app.findAll('.inst .cover .landscape');
    expect(covers).toHaveLength(serverEntries.length);
    for (const cover of covers) {
      expect(cover.attributes('data-motion')).toBe('still');
    }
  });
});
