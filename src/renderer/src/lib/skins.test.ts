// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerAccess, ServerLaunch } from '@shared/catalog';
import type { SkinModTable } from '@shared/skin-mod';
import {
  clientModCredit,
  fabricFileHosts,
  fabricNote,
  fabricPurpose,
  serverClientModPreview,
  serverSkinsPreview,
  skinModCredit,
  takeLegacyNoMods,
  versionLabel,
} from './skins';

const table: SkinModTable = {
  updated_at: null,
  service_root: 'https://mc-mon.ru/skins/',
  source_url: 'https://github.com/xfl03/MCCustomSkinLoader',
  license_url: 'https://www.gnu.org/licenses/gpl-3.0.html',
  license: 'GPL-3.0-only',
  entries: [
    {
      minecraft: '1.21.1',
      loader: 'fabric',
      loader_version: '0.19.5',
      mod: {
        version: '15.1-Universal',
        urls: ['https://cdn.modrinth.com/data/a/mod.jar', 'https://mc-mon.ru/files/mod.jar'],
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
          urls: ['https://mc-mon.ru/storage/client-mod/m.jar'],
          sha256: 'd'.repeat(64),
          size: 29131,
        },
      },
    ],
  },
};

const byNick: ServerAccess = { license: true, nick: true };
const licenseOnly: ServerAccess = { license: true, nick: false };

function server(launch: ServerLaunch, access = byNick): Parameters<typeof serverSkinsPreview>[0] {
  return { launch, access };
}

afterEach(() => {
  localStorage.clear();
});

describe('the version name on screen', () => {
  it('names the loader when the game goes with Fabric for any of the two mods', () => {
    expect(versionLabel('1.21.1', fabricPurpose('on', false))).toBe('1.21.1, Fabric');
    expect(versionLabel('1.21.1', fabricPurpose('server', true))).toBe('1.21.1, Fabric');
    expect(versionLabel('1.21.1', fabricPurpose('server', false))).toBe('1.21.1');
    expect(versionLabel('1.21.1', fabricPurpose('unavailable', false))).toBe('1.21.1');
    expect(versionLabel('26.2', fabricPurpose(null, false))).toBe('26.2');
  });

  it('the note names skins whenever they go and nothing else', () => {
    expect(fabricNote('skins')).toBe('skins');
    expect(fabricNote('both')).toBe('skins');
    expect(fabricNote('check')).toBe('check');
  });

  it('tells why Fabric is there: skins, the check of the entry or both', () => {
    expect(fabricPurpose('on', false)).toBe('skins');
    expect(fabricPurpose('on', true)).toBe('both');
    expect(fabricPurpose('user', true)).toBe('check');
    expect(fabricPurpose('license', false)).toBeNull();
  });
});

describe('the choice an early build kept in the window storage', () => {
  it('is handed over once and then is gone from the storage', () => {
    localStorage.setItem('mcmonitor.no-mods', JSON.stringify(['server-7', 'profile-pack']));
    expect(takeLegacyNoMods('server-8')).toBe(false);
    expect(takeLegacyNoMods('server-7')).toBe(true);
    expect(takeLegacyNoMods('server-7')).toBe(false);
    expect(localStorage.getItem('mcmonitor.no-mods')).toBe('["profile-pack"]');
    expect(takeLegacyNoMods('profile-pack')).toBe(true);
    expect(localStorage.getItem('mcmonitor.no-mods')).toBeNull();
  });

  it('a broken record means no choice', () => {
    localStorage.setItem('mcmonitor.no-mods', '{oops');
    expect(takeLegacyNoMods('server-7')).toBe(false);
  });
});

describe('what a catalog server will be launched with', () => {
  it('skins by default, also for a site that says nothing about them', () => {
    expect(serverSkinsPreview(server({ kind: 'direct', minecraft: '1.21.1' }), table, false)).toBe(
      'on',
    );
    expect(
      serverSkinsPreview(
        server({ kind: 'direct', minecraft: '1.21.1', skins: true }),
        table,
        false,
      ),
    ).toBe('on');
  });

  it('no skins when the server, the licence, the player or the table say so', () => {
    const direct: ServerLaunch = { kind: 'direct', minecraft: '1.21.1' };
    expect(serverSkinsPreview(server({ ...direct, skins: false }), table, false)).toBe('server');
    expect(serverSkinsPreview(server(direct, licenseOnly), table, false)).toBe('license');
    expect(serverSkinsPreview(server({ kind: 'direct', minecraft: '1.8.9' }), table, false)).toBe(
      'version',
    );
    expect(serverSkinsPreview(server(direct), null, false)).toBe('table');
    expect(serverSkinsPreview(server(direct), table, true)).toBe('user');
  });

  it('a server with its own launcher is not ours to decide', () => {
    expect(serverSkinsPreview(server({ kind: 'none' }), table, false)).toBeNull();
    expect(serverClientModPreview(server({ kind: 'none' }), withClient)).toBe(false);
  });

  it('the client mod goes by nickname also where skins are off, never with a licence', () => {
    const direct: ServerLaunch = { kind: 'direct', minecraft: '1.21.1', skins: false };
    expect(serverClientModPreview(server(direct), withClient)).toBe(true);
    expect(serverClientModPreview(server(direct, licenseOnly), withClient)).toBe(false);
    expect(serverClientModPreview(server({ ...direct, minecraft: '1.8.9' }), withClient)).toBe(
      false,
    );
    expect(serverClientModPreview(server(direct), table)).toBe(false);
    expect(serverClientModPreview(server({ ...direct, modpack: true }), withClient)).toBe(false);
    expect(serverClientModPreview(server({ ...direct, modpack: false }), withClient)).toBe(true);
    const crashed = [{ minecraft: '1.21.1', sha256: 'd'.repeat(64) }];
    expect(serverClientModPreview(server(direct), withClient, crashed)).toBe(false);
    const other = [{ minecraft: '1.21.1', sha256: 'e'.repeat(64) }];
    expect(serverClientModPreview(server(direct), withClient, other)).toBe(true);
  });

  it('a modpack turns skins off even when the site says nothing about skins', () => {
    const pack: ServerLaunch = { kind: 'direct', minecraft: '1.21.1', modpack: true };
    expect(serverSkinsPreview(server(pack), table, false)).toBe('server');
  });
});

describe('where the Fabric files come from', () => {
  it('names Fabric and every host of the mods that go, once', () => {
    expect(fabricFileHosts(withClient, '1.21.1', 'both')).toEqual([
      'fabricmc.net',
      'cdn.modrinth.com',
      'mc-mon.ru',
    ]);
    expect(fabricFileHosts(withClient, '1.21.1', 'check')).toEqual(['fabricmc.net', 'mc-mon.ru']);
    expect(fabricFileHosts(table, '1.8.9', 'skins')).toEqual([]);
    expect(fabricFileHosts(withClient, '1.21.1', null)).toEqual([]);
  });
});

describe('the mod credit for the about screen', () => {
  it('is absent without a table or with an empty one', () => {
    expect(skinModCredit(null)).toBeNull();
    expect(skinModCredit({ ...table, entries: [] })).toBeNull();
  });

  it('names the client mod with its own licence, when the table has it', () => {
    expect(clientModCredit(withClient)).toEqual({
      version: '0.1.0',
      license: 'GPL-3.0-only',
      sourceUrl: null,
      licenseUrl: null,
    });
    expect(clientModCredit(table)).toBeNull();
  });
});
