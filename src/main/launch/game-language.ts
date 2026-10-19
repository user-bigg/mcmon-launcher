import path from 'node:path';
import { readJson } from './json-cache';

const LANGUAGE_FILE = /(?:^|\/)lang\/([A-Za-z]{2,4}(?:_[A-Za-z]{2,4})?)\.(?:json|lang)$/;
const DEFAULT_LANGUAGE = 'en_us';
const TRADITIONAL_CHINESE_REGIONS: Readonly<Record<string, string>> = {
  tw: 'zh_tw',
  hk: 'zh_hk',
  mo: 'zh_hk',
};
const SYSTEM_ALIASES: Readonly<Record<string, string>> = { nb: 'no', iw: 'he', in: 'id' };

interface SystemLanguage {
  language: string;
  script: string | null;
  region: string | null;
}

function parseSystemLanguage(tag: string): SystemLanguage | null {
  const [first = '', ...rest] = tag.trim().toLowerCase().split(/[-_]/);
  if (!/^[a-z]{2,3}$/.test(first)) {
    return null;
  }
  return {
    language: SYSTEM_ALIASES[first] ?? first,
    script: rest.find((part) => /^[a-z]{4}$/.test(part)) ?? null,
    region: rest.find((part) => /^[a-z]{2}$/.test(part)) ?? null,
  };
}

// Languages of one name the game has several of, none of them named after the language itself.
// The game's "en" list also holds joke languages (en_pt, en_ud), so a region the game does not
// have falls back to en_us instead of the first match.
function sharedNameChoice(system: SystemLanguage): string | null {
  if (system.language === 'en') {
    return DEFAULT_LANGUAGE;
  }
  if (system.language === 'zh') {
    const byRegion = TRADITIONAL_CHINESE_REGIONS[system.region ?? ''];
    return byRegion ?? (system.script === 'hant' ? 'zh_tw' : 'zh_cn');
  }
  if (system.language === 'sr') {
    return system.script === 'latn' ? 'sr_cs' : 'sr_sp';
  }
  return system.language === 'be' ? 'be_by' : null;
}

function candidates(system: SystemLanguage, known: readonly string[]): string[] {
  const { language, region } = system;
  const exact = region === null ? [] : [`${language}_${region}`];
  const shared = sharedNameChoice(system);
  const ofLanguage = known.filter((code) => code.startsWith(`${language}_`));
  return [
    ...exact,
    ...(shared === null ? [] : [shared]),
    `${language}_${language}`,
    ...(ofLanguage.length === 1 ? ofLanguage : []),
  ];
}

// `codes` are spelled as this version of the game spells them: ru_RU up to 1.10, ru_ru after.
// A value in the other spelling is unknown to the game, and it falls back to English.
export function gameLanguage(
  systemLanguages: readonly string[],
  codes: readonly string[],
): string | null {
  const system = parseSystemLanguage(systemLanguages[0] ?? '');
  if (system === null || codes.length === 0) {
    return null;
  }
  const spelling = new Map(codes.map((code) => [code.toLowerCase(), code]));
  if (!spelling.has(DEFAULT_LANGUAGE)) {
    const upper = codes.some((code) => code !== code.toLowerCase());
    spelling.set(DEFAULT_LANGUAGE, upper ? 'en_US' : DEFAULT_LANGUAGE);
  }
  const found = candidates(system, [...spelling.keys()]).find((code) => spelling.has(code));
  return found === undefined ? null : (spelling.get(found) ?? null);
}

export function languageCodes(assetIndex: unknown): string[] {
  const objects =
    typeof assetIndex === 'object' && assetIndex !== null
      ? (assetIndex as { objects?: unknown }).objects
      : null;
  if (typeof objects !== 'object' || objects === null) {
    return [];
  }
  const codes = Object.keys(objects).flatMap((key) => LANGUAGE_FILE.exec(key)?.[1] ?? []);
  return [...new Set(codes)];
}

export async function installedLanguage(
  assets: string,
  indexId: string,
  systemLanguages: readonly string[],
): Promise<string | null> {
  if (systemLanguages.length === 0) {
    return null;
  }
  const index = await readJson(path.join(assets, 'indexes', `${indexId}.json`));
  return gameLanguage(systemLanguages, languageCodes(index));
}
