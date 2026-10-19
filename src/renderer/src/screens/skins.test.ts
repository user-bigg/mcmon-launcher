// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { SkinModTable } from '@shared/skin-mod';
import { findServer, SERVER_IDS } from '../mock/servers';
import { openScreen as open, progress, unmountScreen } from '../screen-testing';
import { idleState, launchEvent, stubLauncher, type Mounted, type Stub } from '../testing';

const SERVER = `/server/${String(SERVER_IDS.cubeIsland)}`;
const LAUNCH = `/launch/${String(SERVER_IDS.cubeIsland)}`;
const FOLDER = `server-${String(SERVER_IDS.cubeIsland)}`;

const table: SkinModTable = {
  updated_at: '2026-10-13T07:30:51Z',
  service_root: 'https://mc-mon.ru/skins/',
  source_url: 'https://github.com/xfl03/MCCustomSkinLoader',
  license_url: 'https://www.gnu.org/licenses/gpl-3.0.html',
  license: 'GPL-3.0-only',
  entries: [
    {
      minecraft: '1.21.4',
      loader: 'fabric',
      loader_version: '0.19.5',
      mod: {
        version: '15.1-Universal',
        urls: ['https://cdn.modrinth.com/data/idMHQ4n2/versions/yyYvYfZI/mod.jar'],
        sha256: 'c'.repeat(64),
        size: 222917,
      },
    },
  ],
  client_mod: null,
};

const withClient: SkinModTable = {
  ...table,
  client_mod: {
    version: '0.1.0',
    license: 'GPL-3.0-only',
    license_url: null,
    source_url: null,
    lines: [
      {
        minecraft_from: '1.20.2',
        minecraft_to: '1.21.11',
        loader_version: '0.19.5',
        mod: {
          version: '0.1.0',
          urls: [`https://mc-mon.ru/storage/client-mod/${'d'.repeat(64)}.jar`],
          sha256: 'd'.repeat(64),
          size: 29131,
        },
      },
    ],
  },
};

function withTable(value: SkinModTable = table): Stub {
  const stub = stubLauncher();
  stub.api.site.skinMod = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value,
      stale: false,
      fetchedAt: '2026-10-13T08:00:00Z',
    }),
  );
  return stub;
}

function skinsOff<T>(run: () => Promise<T>): Promise<T> {
  const server = findServer(SERVER_IDS.cubeIsland);
  if (server?.launch.kind !== 'direct') {
    throw new Error('the mock server must launch directly');
  }
  const launch = server.launch;
  launch.skins = false;
  return run().finally(() => {
    delete launch.skins;
  });
}

function loaderStep(app: Mounted['app']): string {
  return app.findAll('.step')[2]?.text() ?? '';
}

async function play(app: Mounted['app']): Promise<void> {
  const button = app.findAll('button').find((item) => item.text() === ru.install.start);
  await button?.trigger('click');
  await flushPromises();
}

afterEach(unmountScreen);

describe('skins on the launch screen', () => {
  it('says in one short line that Fabric is there for skins', async () => {
    const { app } = await open(LAUNCH, withTable());
    expect(loaderStep(app)).toContain(ru.install.fabricLoader.skins);
    expect(ru.install.fabricLoader.skins).toContain('Fabric');
    expect(app.findAll('.step')[2]?.classes()).not.toContain('is-skipped');
    expect(app.find('.steps').text().split('Fabric')).toHaveLength(2);
    const sources = app.find('[data-skin-sources]').text();
    expect(sources).toContain('fabricmc.net');
    expect(sources).toContain('cdn.modrinth.com');
  });

  it('without a table the screen is unchanged', async () => {
    const { app } = await open(LAUNCH);
    expect(loaderStep(app)).toContain(ru.install.loaderSkipped);
    expect(app.text()).toContain(fill(ru.install.stepTitles.files, { version: '1.21.4' }));
    expect(app.text()).not.toContain('Fabric');
    expect(app.find('[data-without-mods]').exists()).toBe(false);
    expect(app.find('[data-skin-sources]').exists()).toBe(false);
  });

  it("'Launch without mods' is saved with the game data of this server, not in the window", async () => {
    const stub = withTable();
    const { app, api } = await open(LAUNCH, stub);
    const toggle = app.find(`[role="switch"][aria-label="${ru.install.withoutMods}"]`);
    expect(toggle.attributes('aria-checked')).toBe('false');
    await toggle.trigger('click');
    await flushPromises();
    expect(toggle.attributes('aria-checked')).toBe('true');
    expect(api.instances.setWithoutMods).toHaveBeenCalledWith(FOLDER, true);
    expect(loaderStep(app)).toContain(ru.install.loaderSkipped);
    expect(app.find('[data-skin-sources]').exists()).toBe(false);
    expect(app.find('[data-without-mods]').exists()).toBe(true);
    expect(localStorage.getItem('mcmonitor.no-mods')).toBeNull();
    await play(app);
    expect(vi.mocked(api.launch.launch).mock.calls[0]?.[0]).not.toHaveProperty('withoutMods');
    unmountScreen();
    const again = await open(LAUNCH, stub);
    const reopened = again.app.find(`[role="switch"][aria-label="${ru.install.withoutMods}"]`);
    expect(reopened.attributes('aria-checked')).toBe('true');
  });

  it('a choice left in the window storage by an early build moves to the game data', async () => {
    localStorage.setItem('mcmonitor.no-mods', JSON.stringify([FOLDER]));
    const { app, api } = await open(LAUNCH, withTable());
    await flushPromises();
    expect(api.instances.setWithoutMods).toHaveBeenCalledWith(FOLDER, true);
    expect(localStorage.getItem('mcmonitor.no-mods')).toBeNull();
    const toggle = app.find(`[role="switch"][aria-label="${ru.install.withoutMods}"]`);
    expect(toggle.attributes('aria-checked')).toBe('true');
  });

  it('a save that failed puts the switch back', async () => {
    const stub = withTable();
    stub.api.instances.setWithoutMods = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'busy' as const } }),
    );
    const { app } = await open(LAUNCH, stub);
    const toggle = app.find(`[role="switch"][aria-label="${ru.install.withoutMods}"]`);
    await toggle.trigger('click');
    await flushPromises();
    expect(toggle.attributes('aria-checked')).toBe('false');
  });

  it('a plain launch sends neither flag, so an old request stays as it was', async () => {
    const { app, api } = await open(LAUNCH, withTable());
    await play(app);
    const request = vi.mocked(api.launch.launch).mock.calls[0]?.[0];
    expect(request).not.toHaveProperty('withoutMods');
    expect(request).not.toHaveProperty('serverSkins');
  });

  it("a server that turned skins off is marked 'No mods' and offers no switch", async () => {
    await skinsOff(async () => {
      const { app, api } = await open(LAUNCH, withTable());
      const row = app.find('[data-no-mods]');
      expect(row.text()).toContain(ru.install.noMods);
      expect(row.text()).toContain(ru.install.noModsNote);
      expect(app.find('[data-without-mods]').exists()).toBe(false);
      expect(loaderStep(app)).toContain(ru.install.loaderSkipped);
      await play(app);
      expect(api.launch.launch).toHaveBeenCalledWith(
        expect.objectContaining({ serverSkins: false }),
      );
    });
  });

  it("when the mod could not be fetched the step quietly says 'Skins are unavailable now'", async () => {
    const { app, emit } = await open(LAUNCH, withTable());
    await play(app);
    emit(
      launchEvent(
        { kind: 'progress' },
        {
          phase: 'preparing',
          operationId: 1,
          skins: 'unavailable',
          progress: progress(['done', 'done', 'skipped', 'active'], 70),
        },
      ),
    );
    await flushPromises();
    expect(loaderStep(app)).toContain(ru.install.skinsUnavailable);
    expect(app.find('.steps').text()).not.toContain('Fabric');
    expect(app.find('[role="alert"]').exists()).toBe(false);
  });
});

describe('the client mod on the launch screen', () => {
  it('says Fabric is there for skins when both mods go', async () => {
    const { app } = await open(LAUNCH, withTable(withClient));
    expect(loaderStep(app)).toContain(ru.install.fabricLoader.skins);
    const sources = app.find('[data-skin-sources]');
    expect(sources.text()).toContain(ru.install.sourceFabric.both);
    expect(sources.text()).toContain('mc-mon.ru');
  });

  it('keeps Fabric for the client mod alone when the server turned skins off', async () => {
    await skinsOff(async () => {
      const { app } = await open(LAUNCH, withTable(withClient));
      expect(loaderStep(app)).toContain(ru.install.fabricLoader.check);
      expect(loaderStep(app)).not.toContain(ru.install.fabricLoader.skins);
      expect(app.find('[data-no-mods]').exists()).toBe(true);
      const sources = app.find('[data-skin-sources]').text();
      expect(sources).toContain(ru.install.sourceFabric.check);
      expect(sources).not.toContain('cdn.modrinth.com');
    });
  });
});

describe('a server with a modpack', () => {
  it('goes plain, without Fabric, and the launch says it has a modpack', async () => {
    const server = findServer(SERVER_IDS.cubeIsland);
    if (server?.launch.kind !== 'direct') {
      throw new Error('the mock server must launch directly');
    }
    const launch = server.launch;
    launch.skins = false;
    launch.modpack = true;
    try {
      const { app, api } = await open(LAUNCH, withTable(withClient));
      expect(loaderStep(app)).toContain(ru.install.loaderSkipped);
      expect(app.find('[data-skin-sources]').exists()).toBe(false);
      await play(app);
      expect(api.launch.launch).toHaveBeenCalledWith(
        expect.objectContaining({ serverSkins: false, serverModpack: true }),
      );
    } finally {
      delete launch.skins;
      delete launch.modpack;
    }
  });
});

describe('a client mod blocked after a crash', () => {
  it('is not promised on the launch screen or the server page', async () => {
    await skinsOff(async () => {
      const stub = withTable(withClient);
      const line = withClient.client_mod?.lines[0];
      const blocked = [{ minecraft: '1.21.4', sha256: line?.mod.sha256 ?? '' }];
      stub.api.launch.state = vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...idleState, blockedClientMods: blocked },
        }),
      );
      const { app } = await open(LAUNCH, stub);
      await flushPromises();
      expect(loaderStep(app)).toContain(ru.install.loaderSkipped);
      expect(app.find('.steps').text()).not.toContain('Fabric');
      unmountScreen();
      const page = await open(SERVER, stub);
      await flushPromises();
      expect(page.app.find('.is-launch').text()).not.toContain('Fabric');
    });
  });
});

describe('skins on the server page', () => {
  it('a server with skins turned off still names Fabric for the client mod', async () => {
    await skinsOff(async () => {
      const { app } = await open(SERVER, withTable(withClient));
      await flushPromises();
      const panel = app.find('.is-launch');
      expect(panel.text()).toContain('1.21.4, Fabric');
      expect(panel.find('[data-skins-note]').text()).toBe(ru.serverPage.trustFabric.check);
    });
  });

  it("'What will be installed' names Fabric and why it is there", async () => {
    const { app } = await open(SERVER, withTable());
    const panel = app.find('.is-launch');
    expect(panel.text()).toContain('1.21.4, Fabric');
    expect(panel.find('[data-skins-note]').text()).toBe(ru.serverPage.trustFabric.skins);
    expect(panel.find('[data-no-mods]').exists()).toBe(false);
  });

  it("a server with skins turned off carries the 'No mods' mark", async () => {
    await skinsOff(async () => {
      const { app } = await open(SERVER, withTable());
      await flushPromises();
      const panel = app.find('.is-launch');
      expect(panel.find('[data-no-mods]').text()).toBe(ru.install.noMods);
      expect(panel.text()).not.toContain('Fabric');
      expect(panel.find('[data-skins-note]').exists()).toBe(false);
    });
  });
});

describe('skins in the privacy table', () => {
  it('says what the mod asks the site for and how to turn it off', async () => {
    const { app } = await open('/settings');
    const row = app.find('tr[data-privacy="skins"]');
    expect(row.text()).toContain(ru.privacy.skinsWhat);
    expect(row.find('td:last-child').text()).toBe(ru.privacy.skinsOff);
  });
});

describe('the mod in the about block', () => {
  it('names the mod and links to its source code and licence', async () => {
    const { app } = await open('/settings', withTable());
    const block = app.find('[data-about="skin-mod"]');
    expect(block.text()).toContain(fill(ru.settings.aboutSkinMod, { version: '15.1-Universal' }));
    expect(block.text()).toContain(
      fill(ru.settings.aboutSkinModLicense, { license: 'GPL\u20113.0\u2011only' }),
    );
    const links = block.findAll('a').map((link) => link.attributes('href'));
    expect(links).toEqual([
      'https://github.com/xfl03/MCCustomSkinLoader',
      'https://www.gnu.org/licenses/gpl-3.0.html',
    ]);
  });

  it('links the licence of the client mod always and its source only when there is one', async () => {
    const licenseUrl = 'https://www.gnu.org/licenses/gpl-3.0.html';
    const sourceUrl = 'https://github.com/mc-monitor/client-mod';
    const mod = withClient.client_mod;
    if (mod === null) {
      throw new Error('no client mod');
    }
    const linksOf = async (change: Partial<typeof mod>): Promise<string[]> => {
      const value = { ...withClient, client_mod: { ...mod, ...change } };
      const { app } = await open('/settings', withTable(value));
      const found = app
        .findAll('[data-about-link^="client-mod"] a')
        .map((link) => `${link.text()} ${link.attributes('href') ?? ''}`);
      unmountScreen();
      return found;
    };
    expect(await linksOf({ license_url: licenseUrl })).toEqual([
      `${ru.settings.aboutClientModLicenseLink} ${licenseUrl}`,
    ]);
    expect(await linksOf({ license_url: licenseUrl, source_url: sourceUrl })).toEqual([
      `${ru.settings.aboutClientModSource} ${sourceUrl}`,
      `${ru.settings.aboutClientModLicenseLink} ${licenseUrl}`,
    ]);
  });

  it('names the client mod and its licence next to the skins mod', async () => {
    const { app } = await open('/settings', withTable(withClient));
    const line = app.find('[data-about="skin-mod"] [data-about-client-mod]');
    expect(line.text()).toContain(fill(ru.settings.aboutClientMod, { version: '0.1.0' }));
    expect(line.text()).toContain(
      fill(ru.settings.aboutSkinModLicense, { license: 'GPL\u20113.0\u2011only' }),
    );
  });

  it('is not shown while the site has no table', async () => {
    const { app } = await open('/settings');
    expect(app.find('[data-about="skin-mod"]').exists()).toBe(false);
  });
});
