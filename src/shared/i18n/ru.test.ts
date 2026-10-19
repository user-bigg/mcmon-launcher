import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ru } from './ru';

type Leaf = [path: string, value: unknown];

function leaves(value: unknown, path: string): Leaf[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
  }
  return [[path, value]];
}

function placeholders(template: string): string[] {
  return Array.from(template.matchAll(/\{(\w*)\}/g), (match) => match[1] ?? '');
}

function strings(value: unknown): string[] {
  return leaves(value, '').flatMap(([, leaf]) =>
    Array.isArray(leaf) ? leaf.map(String) : [String(leaf)],
  );
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const sources = [
  ...walk(join(import.meta.dirname, '../../renderer/src')),
  ...walk(join(import.meta.dirname, '../../main')),
  ...walk(join(import.meta.dirname, '..')),
]
  .filter((file) => /\.(vue|ts)$/.test(file) && !file.endsWith('.test.ts'))
  .filter((file) => !file.endsWith('ru.ts'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const own = leaves({ ...ru, crashAnalysis: undefined, homeRows: undefined }, 'ru').filter(
  ([path]) => !path.startsWith('ru.crashAnalysis') && !path.startsWith('ru.homeRows'),
);

function isUsed(path: string): boolean {
  const parts = path.split('.');
  for (let length = parts.length; length >= 2; length--) {
    const prefix = parts.slice(0, length).join('.');
    if (
      length === parts.length &&
      new RegExp(`${prefix.replace(/\./g, '\\.')}(?![\\w])`).test(sources)
    ) {
      return true;
    }
    if (sources.includes(`${prefix}[`)) {
      return true;
    }
  }
  return false;
}

describe('interface strings', () => {
  it('no empty strings and no empty plural forms', () => {
    for (const [path, value] of leaves(ru, 'ru')) {
      for (const text of Array.isArray(value) ? value : [value]) {
        expect(String(text).trim().length, path).toBeGreaterThan(0);
      }
    }
  });

  it('placeholders without empty names and without duplicates', () => {
    for (const [path, value] of own) {
      if (typeof value !== 'string') {
        continue;
      }
      const names = placeholders(value);
      expect(names.includes(''), `${path}: пустой плейсхолдер`).toBe(false);
      expect(new Set(names).size, `${path}: повтор плейсхолдера`).toBe(names.length);
    }
  });

  it('every string is used somewhere', () => {
    expect(own.map(([path]) => path).filter((path) => !isUsed(path))).toEqual([]);
  });

  it('no sponsor label, advertiser name or erid', () => {
    expect(strings(ru).filter((text) => /реклам|erid/i.test(text))).toEqual([]);
  });

  it('no boosting, honesty or fake wording and no publisher label', () => {
    const text = JSON.stringify(ru);
    expect(text).not.toMatch(/накрут|честн|подделк|Подписан|подписан/);
  });

  it('uses "журнал", "около" and "хеш", not "лог", "~" or "контрольная сумма"', () => {
    const all = strings(ru);
    const log = /(^|[^\p{L}])[Лл]ог(и|а|у|ом|е|ов|ам|ами|ах)?(?!\p{L})/u;
    expect(all.filter((text) => log.test(text))).toEqual([]);
    expect(['Логин', 'логотип', 'логика'].filter((text) => log.test(text))).toEqual([]);
    expect(['лог', 'Логи игры', 'в логах'].every((text) => log.test(text))).toBe(true);
    expect(all.filter((text) => text.includes('~'))).toEqual([]);
    expect(all.filter((text) => /контрольн/i.test(text))).toEqual([]);
  });

  it('ё where it belongs, guillemet quotes, a dash instead of a hyphen with spaces', () => {
    const all = strings(ru);
    const withoutYo =
      /(^|[^\p{L}])(еще|ее|вперед|пришел|нашел|ушел|прошел|отчет\p{L}*|счет\p{L}*|учет\p{L}*)(?!\p{L})/iu;
    expect(withoutYo.test('Вперед')).toBe(true);
    expect(all.filter((text) => withoutYo.test(text))).toEqual([]);
    expect(all.filter((text) => /["“”„']/.test(text))).toEqual([]);
    expect(all.filter((text) => text.includes(' - '))).toEqual([]);
  });
});
