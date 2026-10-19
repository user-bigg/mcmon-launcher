import { describe, expect, it } from 'vitest';
import { deviceLabel } from './device';

describe('device name', () => {
  it('OS and PC name, strips control characters, capped at 64 characters', () => {
    expect(deviceLabel('win32', 'DESKTOP-1')).toBe('Windows · DESKTOP-1');
    expect(deviceLabel('win32', 'evil‮exe\nname')).toBe('Windows · evil exe name');
    expect(deviceLabel('win32', '   ')).toBe('Windows');
    expect(Array.from(deviceLabel('win32', 'ж'.repeat(100)))).toHaveLength(64);
  });
});
