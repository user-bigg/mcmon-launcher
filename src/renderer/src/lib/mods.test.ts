import { describe, expect, it } from 'vitest';
import { ru } from '@shared/i18n/ru';
import { catalogView, serverModsView, type ModChoices } from '@shared/mods';
import { demoModCatalog, demoServerMods } from '../mock/mods';
import {
  enabledAfter,
  enabledModsCount,
  inlineName,
  modCredits,
  modsGroups,
  namesText,
  serverModRows,
  serverModsBytes,
  withoutShaderNeeds,
} from './mods';
import { formatModSize } from './units';

const MC = '1.21.1';
const choices: ModChoices = {
  enabled: ['sodium', 'xaeros-minimap', 'appleskin'],
  shaders: 'beautiful',
  optionalOff: {},
};

function view(next: ModChoices = choices): ReturnType<typeof catalogView> {
  return catalogView(demoModCatalog, next, MC);
}

describe('mods section view', () => {
  it('folds what the shader packs bring into one shaders row at the top of its group', () => {
    const groups = modsGroups(view());
    const graphics = groups.find((group) => group.group === 'graphics');
    expect(graphics?.shaders).toMatchObject({ on: true, choice: 'beautiful' });
    expect(graphics?.shaders?.credit).toBe('Complementary Reimagined от Complementary Development');
    expect(graphics?.mods.map((mod) => mod.slug)).not.toContain('iris');
    expect(groups.map((group) => group.label)).toEqual([
      ru.mods.groups.optimization,
      ru.mods.groups.graphics,
      ru.mods.groups.interface,
      ru.mods.groups.cosmetics,
      ru.mods.groups.sound,
    ]);
  });

  it('counts the enabled rows and the shaders as one mod', () => {
    expect(enabledModsCount(view())).toBe(4);
    expect(enabledModsCount(view({ ...choices, shaders: 'off' }))).toBe(3);
  });

  it('a pack without a credit line is named by its title', () => {
    const groups = modsGroups(view({ ...choices, shaders: 'light' }));
    const shaders = groups.find((group) => group.shaders !== null)?.shaders;
    expect(shaders?.credit).toBe('Набор MakeUp Ultra Fast');
  });

  it('turning a mod on or off keeps the rest of the choice', () => {
    expect(enabledAfter(['a', 'b'], 'c', true)).toEqual(['a', 'b', 'c']);
    expect(enabledAfter(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(withoutShaderNeeds(view(), ['iris', 'sodium'])).toEqual(['sodium']);
  });

  it('credits every catalog mod with a link to its source or to Modrinth', () => {
    const credits = modCredits(view());
    expect(credits.map((item) => item.slug)).not.toContain('reeses-sodium-options');
    expect(credits).toHaveLength(demoModCatalog.mods.length - 1);
    expect(credits.find((item) => item.slug === 'iris')?.url).toBe(
      'https://modrinth.com/project/YL57xq9U',
    );
  });

  it('a mod size below ten megabytes keeps one decimal', () => {
    expect(formatModSize(2_200_000)).toBe('2,1 МБ');
    expect(formatModSize(1000)).toBe('0,1 МБ');
  });
});

describe('mods of a server', () => {
  const emerald = serverModsView(
    { serverId: 103, minecraft: MC },
    {
      state: 'known',
      modpack: false,
      mods: demoServerMods[103] ?? { required: [], optional: [], forbidden: [] },
    },
    demoModCatalog,
    choices,
  );
  const north = serverModsView(
    { serverId: 102, minecraft: MC },
    {
      state: 'known',
      modpack: false,
      mods: demoServerMods[102] ?? { required: [], optional: [], forbidden: [] },
    },
    demoModCatalog,
    choices,
  );

  it('lists a required mod locked, an optional one with a switch and a banned mod of the player', () => {
    expect(serverModRows(emerald).map((row) => [row.title, row.kind, row.on])).toEqual([
      ['Голосовой чат', 'locked', true],
      ['Эмоции', 'optional', true],
    ]);
    expect(serverModRows(north).map((row) => [row.title, row.kind])).toEqual([
      ['Голосовой чат', 'optional'],
      ['Миникарта', 'forbidden'],
    ]);
  });

  it('a mod turned off for this server is off in the list and out of the size', () => {
    const off = serverModsView(
      { serverId: 103, minecraft: MC },
      {
        state: 'known',
        modpack: false,
        mods: demoServerMods[103] ?? { required: [], optional: [], forbidden: [] },
      },
      demoModCatalog,
      { ...choices, optionalOff: { '103': ['emotecraft'] } },
    );
    const rows = serverModRows(off);
    expect(rows.find((row) => row.slug === 'emotecraft')?.on).toBe(false);
    expect(serverModsBytes(rows)).toBeLessThan(serverModsBytes(serverModRows(emerald)));
  });

  it('names the mods inline: common words in lower case, names as they are', () => {
    expect(inlineName('Голосовой чат')).toBe('голосовой чат');
    expect(inlineName('AppleSkin')).toBe('AppleSkin');
    expect(namesText(['Голосовой чат', 'Эмоции'])).toBe('голосовой чат и эмоции');
    expect(namesText(['A', 'B', 'C'])).toBe('A, B и C');
    expect(namesText(['Fabric API', 'Библиотека'], { keepFirst: true })).toBe(
      'Fabric API и библиотека',
    );
    expect(namesText(['A', 'B', 'C', 'D'], { limit: 2 })).toBe('A, B и ещё 2');
  });
});
