import { describe, expect, it } from 'vitest';
import {
  MAX_BAN_REASON_LENGTH,
  cleanBanReason,
  formatLoginCode,
  normalizeLoginCode,
} from './account';

describe('manual code', () => {
  it('case, dashes and spaces do not matter', () => {
    expect(normalizeLoginCode('abcd-ef23')).toBe('ABCDEF23');
    expect(normalizeLoginCode(' ABCD EF23 ')).toBe('ABCDEF23');
    expect(formatLoginCode('ABCDEF23')).toBe('ABCD-EF23');
  });

  it('no 0, O, 1, I and exactly 8 characters', () => {
    expect(normalizeLoginCode('ABCD-EF2O')).toBeNull();
    expect(normalizeLoginCode('ABCD-EF21')).toBeNull();
    expect(normalizeLoginCode('ABCD-EF2')).toBeNull();
    expect(normalizeLoginCode('ABCD-EF234')).toBeNull();
    expect(normalizeLoginCode('ABCD-ЕF23')).toBeNull();
    expect(normalizeLoginCode('A'.repeat(40))).toBeNull();
  });
});

describe('a ban as the site sends it', () => {
  it('the reason is one line of plain text, cut to a sane length', () => {
    expect(cleanBanReason('  гриф\r\n\tспавна  ')).toBe('гриф спавна');
    expect(cleanBanReason('a\u0000b\u200bc\u2028d')).toBe('a b c d');
    expect(cleanBanReason('<b>x</b>')).toBe('<b>x</b>');
    const long = cleanBanReason('я'.repeat(5000));
    expect(Array.from(long ?? '')).toHaveLength(MAX_BAN_REASON_LENGTH);
    expect(long?.endsWith('…')).toBe(true);
    expect(cleanBanReason(long)).toBe(long);
  });

  it('an empty, blank or non-text reason is no reason', () => {
    for (const value of ['', '   ', '\n', null, undefined, 5, {}, ['x']]) {
      expect(cleanBanReason(value)).toBeNull();
    }
  });
});
