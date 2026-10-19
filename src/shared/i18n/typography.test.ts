import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { typeset, typesetTree } from './typography';

const NBSP = '\u00a0';

function strings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

describe('string typesetting', () => {
  it('a non-breaking space before a dash', () => {
    expect(typeset('Ник — 3–16 символов')).toBe(`Ник${NBSP}— 3–16${NBSP}символов`);
  });

  it('a number and its unit do not break apart, including inside a template', () => {
    expect(typeset('Нужен хотя бы 1 ГБ')).toBe(`Нужен хотя бы 1${NBSP}ГБ`);
    expect(typeset('{value} ГБ')).toBe(`{value}${NBSP}ГБ`);
    expect(typeset('{minutes} мин')).toBe(`{minutes}${NBSP}мин`);
    expect(typeset('{hours} ч')).toBe(`{hours}${NBSP}ч`);
    expect(typeset('Подождите 5 с.')).toBe(`Подождите 5${NBSP}с.`);
    expect(typeset('{count} сегодня')).toBe('{count} сегодня');
    expect(typeset('{count} с аккаунтом')).toBe('{count} с аккаунтом');
  });

  it('short prepositions and conjunctions stick to the word only in long text', () => {
    expect(typeset('Скачанное сохранено, продолжим с того же места.')).toBe(
      `Скачанное сохранено, продолжим с${NBSP}того же места.`,
    );
    expect(typeset('С аккаунтом MC Monitor голосовать можно прямо здесь')).toBe(
      `С${NBSP}аккаунтом MC Monitor голосовать можно прямо здесь`,
    );
    expect(typeset('Серверы с модами')).toBe('Серверы с модами');
  });

  it('consecutive prepositions, and it does not confuse word endings with prepositions', () => {
    expect(typeset('Голос будет считаться за два и в рейтинге, и на сайте')).toBe(
      `Голос будет считаться за${NBSP}два и${NBSP}в${NBSP}рейтинге, и${NBSP}на${NBSP}сайте`,
    );
    expect(typeset('Это дело на сайте, лаунчер его не трогает.')).toBe(
      `Это дело на${NBSP}сайте, лаунчер его не${NBSP}трогает.`,
    );
  });

  it('plural forms are typeset too', () => {
    expect(typesetTree({ wait: ['{n} мин', '{n} ч', 'через 5 с'] })).toEqual({
      wait: [`{n}${NBSP}мин`, `{n}${NBSP}ч`, `через 5${NBSP}с`],
    });
  });

  it('a repeated run changes nothing', () => {
    const once = typeset('Игре выделено 4 ГБ — не хватило, а больше этот компьютер не даст.');
    expect(typeset(once)).toBe(once);
  });

  it('interface strings have no plain space before a dash or between a number and GB', () => {
    const all = strings(ru);
    expect(all.filter((text) => text.includes(' —'))).toEqual([]);
    expect(all.filter((text) => /[\d}] (ГБ|МБ|мс)(?![А-Яа-яЁё])/.test(text))).toEqual([]);
  });
});
