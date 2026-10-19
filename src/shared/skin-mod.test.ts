import { describe, expect, it } from 'vitest';
import {
  clientModLine,
  decideClientMod,
  decideSkins,
  isSkinLoaderVersion,
  newerLoaderVersion,
  telemetrySkins,
  type ClientModLine,
  type SkinModTable,
  type SkinsQuestion,
} from './skin-mod';

const table: SkinModTable = {
  updated_at: '2026-10-13T07:30:51Z',
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
        urls: ['https://cdn.modrinth.com/data/idMHQ4n2/versions/yyYvYfZI/mod.jar'],
        sha256: 'c'.repeat(64),
        size: 222917,
      },
    },
  ],
  client_mod: null,
};

const yes: SkinsQuestion = {
  auth: 'nick',
  serverSkins: true,
  withoutMods: false,
  loader: 'vanilla',
  minecraft: '1.21.1',
  table,
};

function reason(change: Partial<SkinsQuestion>): string {
  const decision = decideSkins({ ...yes, ...change });
  return decision.install ? 'install' : decision.reason;
}

describe('decideSkins', () => {
  it('installs for a nickname on a server that allows skins, with the table entry', () => {
    expect(decideSkins(yes)).toEqual({ install: true, entry: table.entries[0] });
  });

  it('every single reason turns skins off', () => {
    expect(reason({ auth: 'license' })).toBe('license');
    expect(reason({ serverSkins: false })).toBe('server');
    expect(reason({ withoutMods: true })).toBe('user');
    expect(reason({ serverSkins: undefined, modpack: true })).toBe('server');
    expect(reason({ loader: 'fabric' })).toBe('loader');
    expect(reason({ minecraft: '1.12.2' })).toBe('version');
    expect(reason({ table: null })).toBe('table');
    expect(reason({ table: { ...table, entries: [] } })).toBe('version');
  });

  it('names the reasons in a fixed order when several apply', () => {
    const all = {
      auth: 'license',
      serverSkins: false,
      withoutMods: true,
      loader: 'fabric',
    } as const;
    expect(reason({ ...all, table: null })).toBe('license');
    expect(reason({ ...all, auth: 'nick' })).toBe('server');
    expect(reason({ ...all, auth: 'nick', serverSkins: true })).toBe('user');
    expect(reason({ ...all, auth: 'nick', serverSkins: undefined, withoutMods: false })).toBe(
      'loader',
    );
  });

  it('all combinations: installs only when nothing is against it', () => {
    for (const auth of ['nick', 'license'] as const) {
      for (const serverSkins of [true, false, undefined]) {
        for (const withoutMods of [false, true]) {
          for (const loader of ['vanilla', 'fabric'] as const) {
            for (const minecraft of ['1.21.1', '1.12.2']) {
              const expected =
                auth === 'nick' &&
                serverSkins !== false &&
                !withoutMods &&
                loader === 'vanilla' &&
                minecraft === '1.21.1';
              const decision = decideSkins({
                auth,
                serverSkins,
                withoutMods,
                loader,
                minecraft,
                table,
              });
              expect(decision.install).toBe(expected);
            }
          }
        }
      }
    }
  });
});

function line(from: string, to: string | null): ClientModLine {
  return {
    minecraft_from: from,
    minecraft_to: to,
    loader_version: '0.19.5',
    mod: { version: '0.1.0', urls: ['https://mc-mon.ru/m.jar'], sha256: 'd'.repeat(64), size: 1 },
  };
}

const lines = [line('1.14', '1.20.1'), line('1.20.2', '1.21.11'), line('26.1', null)];
const withClient: SkinModTable = {
  ...table,
  client_mod: {
    version: '0.1.0',
    license: 'GPL-3.0-only',
    license_url: null,
    source_url: null,
    lines,
  },
};

describe('clientModLine', () => {
  it('takes both bounds in and leaves the top open when it is null', () => {
    const range = (minecraft: string): string | undefined =>
      clientModLine(withClient, minecraft)?.minecraft_from;
    expect(range('1.14')).toBe('1.14');
    expect(range('1.14.4')).toBe('1.14');
    expect(range('1.20.1')).toBe('1.14');
    expect(range('1.20.2')).toBe('1.20.2');
    expect(range('1.21.11')).toBe('1.20.2');
    expect(range('26.1')).toBe('26.1');
    expect(range('26.2')).toBe('26.1');
    expect(range('99.1.3')).toBe('26.1');
  });

  it('has no mod below the first line, between lines, for snapshots and pre-releases', () => {
    for (const minecraft of ['1.13.2', '1.21.12', '25.4', '26.1-pre1', '26.1-rc-2', '24w14a']) {
      expect(clientModLine(withClient, minecraft)).toBeNull();
    }
    expect(clientModLine(table, '1.21.1')).toBeNull();
    expect(clientModLine(null, '1.21.1')).toBeNull();
  });
});

describe('decideClientMod', () => {
  const yes = {
    auth: 'nick',
    modpack: false,
    loader: 'vanilla',
    minecraft: '1.21.1',
    table: withClient,
  } as const;

  it('goes to a catalog server by nickname whenever a line covers the version', () => {
    expect(decideClientMod(yes)).toBe(lines[1]);
    expect(decideClientMod({ ...yes, minecraft: '1.12.2' })).toBeNull();
    expect(decideClientMod({ ...yes, table: null })).toBeNull();
  });

  it('not to a licence game, a server with a modpack or a game with a loader', () => {
    expect(decideClientMod({ ...yes, auth: 'license' })).toBeNull();
    expect(decideClientMod({ ...yes, modpack: true })).toBeNull();
    expect(decideClientMod({ ...yes, loader: 'fabric' })).toBeNull();
  });
});

describe('newerLoaderVersion', () => {
  it('compares the numbers, not the text', () => {
    expect(newerLoaderVersion('0.19.5', '0.18.4')).toBe('0.19.5');
    expect(newerLoaderVersion('0.9.9', '0.19.5')).toBe('0.19.5');
    expect(newerLoaderVersion('0.19.10', '0.19.9')).toBe('0.19.10');
    expect(newerLoaderVersion('0.19.5', '0.19.5')).toBe('0.19.5');
  });
});

describe('isSkinLoaderVersion', () => {
  it('accepts Fabric Loader from 0.15.0, the first to read fabric.modsFolder', () => {
    expect(isSkinLoaderVersion('0.15.0')).toBe(true);
    expect(isSkinLoaderVersion('0.19.5')).toBe(true);
    expect(isSkinLoaderVersion('1.0.0')).toBe(true);
  });

  it('rejects older and malformed versions', () => {
    expect(isSkinLoaderVersion('0.14.22')).toBe(false);
    expect(isSkinLoaderVersion('0.19')).toBe(false);
    expect(isSkinLoaderVersion('0.19.0-beta.1')).toBe(false);
    expect(isSkinLoaderVersion('../0.19.5')).toBe(false);
  });
});

describe('telemetrySkins', () => {
  it('reports the mod as on, off by choice, or not delivered', () => {
    expect(telemetrySkins('on')).toBe('on');
    for (const status of ['license', 'server', 'user', 'loader'] as const) {
      expect(telemetrySkins(status)).toBe('off');
    }
    for (const status of ['unavailable', 'version', 'table'] as const) {
      expect(telemetrySkins(status)).toBe('unavailable');
    }
  });
});
