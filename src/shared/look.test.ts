import { describe, expect, it } from 'vitest';
import { isPresetId, parseLookChange, releaseDay } from './look';

describe('releaseDay', () => {
  it('keeps a calendar date and drops anything else', () => {
    expect(releaseDay('2026-10-13')).toBe('2026-10-13');
    expect(releaseDay('2026-10-13T00:00:00Z')).toBeNull();
    expect(releaseDay('2026-13-01')).toBeNull();
    expect(releaseDay(null)).toBeNull();
    expect(releaseDay(20261013)).toBeNull();
  });
});

describe('parseLookChange', () => {
  it('accepts a skin, a cape, both, and a cape taken off', () => {
    expect(parseLookChange({ skin: 'plaid-shirt' })).toEqual({ skin: 'plaid-shirt' });
    expect(parseLookChange({ cape: 'cape-web' })).toEqual({ cape: 'cape-web' });
    expect(parseLookChange({ cape: null })).toEqual({ cape: null });
    expect(parseLookChange({ skin: 'a', cape: 'b', extra: 1 })).toEqual({ skin: 'a', cape: 'b' });
  });

  it('rejects an empty change and anything that is not a preset id', () => {
    expect(parseLookChange({})).toBeNull();
    expect(parseLookChange(null)).toBeNull();
    expect(parseLookChange(['plaid-shirt'])).toBeNull();
    expect(parseLookChange({ skin: null })).toBeNull();
    expect(parseLookChange({ skin: '../me' })).toBeNull();
    expect(parseLookChange({ skin: 'ok', cape: 7 })).toBeNull();
    expect(isPresetId('a'.repeat(65))).toBe(false);
  });
});
