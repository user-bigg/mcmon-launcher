import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameLanguage, installedLanguage, languageCodes } from './game-language';

// Spelled as in Mojang's asset indexes: "1.8" (1.8.9) and "30" (26.1). en_us ships inside
// the game jar and is absent from the old index.
const INDEX_1_8 = {
  objects: {
    'minecraft/lang/ru_RU.lang': {},
    'realms/lang/ru_RU.lang': {},
    'minecraft/lang/en_GB.lang': {},
    'minecraft/lang/en_PT.lang': {},
    'minecraft/lang/uk_UA.lang': {},
    'minecraft/sounds/random/click.ogg': {},
  },
};
const INDEX_26 = {
  objects: {
    'minecraft/lang/ru_ru.json': {},
    'minecraft/lang/uk_ua.json': {},
    'minecraft/lang/be_by.json': {},
    'minecraft/lang/be_latn.json': {},
    'minecraft/lang/kk_kz.json': {},
    'minecraft/lang/en_gb.json': {},
    'minecraft/lang/en_pt.json': {},
    'minecraft/lang/en_ud.json': {},
    'realms/lang/en_us.json': {},
    'minecraft/lang/de_de.json': {},
    'minecraft/lang/de_at.json': {},
    'minecraft/lang/es_es.json': {},
    'minecraft/lang/es_mx.json': {},
    'minecraft/lang/pt_br.json': {},
    'minecraft/lang/pt_pt.json': {},
    'minecraft/lang/zh_cn.json': {},
    'minecraft/lang/zh_tw.json': {},
    'minecraft/lang/zh_hk.json': {},
    'minecraft/lang/sr_sp.json': {},
    'minecraft/lang/sr_cs.json': {},
    'minecraft/lang/no_no.json': {},
    'minecraft/lang/lzh.json': {},
    'minecraft/textures/gui/title/background/panorama_0.png': {},
  },
};
const NEW = languageCodes(INDEX_26);
const OLD = languageCodes(INDEX_1_8);

describe('languageCodes', () => {
  it('takes language files of the asset index, each code once', () => {
    expect(OLD.sort()).toEqual(['en_GB', 'en_PT', 'ru_RU', 'uk_UA']);
    expect(NEW).toContain('ru_ru');
    expect(NEW).toContain('lzh');
    expect(NEW).not.toContain('panorama_0');
  });

  it('an index of another shape has no languages', () => {
    expect(languageCodes(undefined)).toEqual([]);
    expect(languageCodes({ objects: 'x' })).toEqual([]);
  });
});

describe('game language from the system language', () => {
  it.each([
    ['ru-RU', 'ru_ru'],
    ['ru', 'ru_ru'],
    ['ru-KZ', 'ru_ru'],
    ['uk-UA', 'uk_ua'],
    ['be-BY', 'be_by'],
    ['be', 'be_by'],
    ['kk-KZ', 'kk_kz'],
    ['en-US', 'en_us'],
    ['en-GB', 'en_gb'],
    ['en-IN', 'en_us'],
    ['en', 'en_us'],
    ['de-AT', 'de_at'],
    ['de-CH', 'de_de'],
    ['es-US', 'es_es'],
    ['pt-BR', 'pt_br'],
    ['pt', 'pt_pt'],
    ['zh-CN', 'zh_cn'],
    ['zh-Hans-SG', 'zh_cn'],
    ['zh-TW', 'zh_tw'],
    ['zh-Hant', 'zh_tw'],
    ['zh-Hant-HK', 'zh_hk'],
    ['sr-Latn-RS', 'sr_cs'],
    ['sr-RS', 'sr_sp'],
    ['nb-NO', 'no_no'],
    ['ru_RU', 'ru_ru'],
  ])('%s — %s', (system, game) => {
    expect(gameLanguage([system], NEW)).toBe(game);
  });

  it('only the first system language counts', () => {
    expect(gameLanguage(['ru-RU', 'en-US'], NEW)).toBe('ru_ru');
    expect(gameLanguage(['en-US', 'ru-RU'], NEW)).toBe('en_us');
  });

  it.each([['ja-JP'], ['xx'], [''], ['c.utf-8']])('no match for %s — no language', (system) => {
    expect(gameLanguage([system], NEW)).toBeNull();
  });

  it('no system language or no languages in the index — no language', () => {
    expect(gameLanguage([], NEW)).toBeNull();
    expect(gameLanguage(['ru-RU'], [])).toBeNull();
  });

  it('versions up to 1.10 get the code in their own spelling', () => {
    expect(gameLanguage(['ru-RU'], OLD)).toBe('ru_RU');
    expect(gameLanguage(['uk'], OLD)).toBe('uk_UA');
    expect(gameLanguage(['en-GB'], OLD)).toBe('en_GB');
    expect(gameLanguage(['en-US'], OLD)).toBe('en_US');
  });
});

describe('installedLanguage', () => {
  let assets: string;

  beforeEach(async () => {
    assets = await mkdtemp(join(tmpdir(), 'mcmonitor-lang-'));
    await mkdir(join(assets, 'indexes'));
    await writeFile(join(assets, 'indexes', '30.json'), JSON.stringify(INDEX_26));
  });

  afterEach(async () => {
    await rm(assets, { recursive: true, force: true });
  });

  it('reads the asset index of the installed version', async () => {
    expect(await installedLanguage(assets, '30', ['ru-RU'])).toBe('ru_ru');
  });

  it('a missing index or no system language — no language', async () => {
    expect(await installedLanguage(assets, 'pre-1.6', ['ru-RU'])).toBeNull();
    expect(await installedLanguage(assets, '30', [])).toBeNull();
  });
});
