import { describe, expect, it } from 'vitest';
import { compactCount, scoreCount } from './format';

describe('compactCount', () => {
  it('keeps numbers under 1000 as-is', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(91)).toBe('91');
    expect(compactCount(999)).toBe('999');
  });

  it('shortens thousands to a K suffix, rounding down', () => {
    expect(compactCount(1000)).toBe('1K');
    expect(compactCount(1340)).toBe('1,3K');
    expect(compactCount(1960)).toBe('1,9K');
    expect(compactCount(9999)).toBe('9,9K');
  });

  it('drops the decimal from ten thousand up', () => {
    expect(compactCount(10000)).toBe('10K');
    expect(compactCount(12345)).toBe('12K');
    expect(compactCount(999999)).toBe('999K');
  });

  it('shortens millions to an M suffix', () => {
    expect(compactCount(1000000)).toBe('1M');
    expect(compactCount(1250000)).toBe('1,2M');
    expect(compactCount(12900000)).toBe('12M');
  });
});

describe('scoreCount', () => {
  it('is exact below a hundred thousand and shortened from there', () => {
    expect(scoreCount(0)).toBe('0');
    expect(scoreCount(3434)).toBe('3\u00a0434');
    expect(scoreCount(99999)).toBe('99\u00a0999');
    expect(scoreCount(100000)).toBe('100K');
    expect(scoreCount(3847000)).toBe('3,8M');
  });

  it('a part follows the form of its whole', () => {
    expect(scoreCount(99500, 100000)).toBe('99K');
    expect(scoreCount(500, 100000)).toBe('500');
    expect(scoreCount(2184, 3434)).toBe('2\u00a0184');
  });
});
