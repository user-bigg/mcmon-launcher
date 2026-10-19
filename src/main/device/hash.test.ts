import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { emptyDevice } from './collect';
import { deviceForDisplay, deviceHash } from './hash';

describe('device hash', () => {
  it('is sha256 of the prefixed upper-case value without spaces, in lower-case hex', () => {
    const expected = createHash('sha256').update('mcmonitor-device:ABC-DEF').digest('hex');
    expect(deviceHash(' abc-def ')).toBe(expected);
    expect(deviceHash('ABC-DEF')).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the known hash for a fixed MachineGuid and a fixed adapter address', () => {
    expect(deviceHash('1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab')).toBe(
      '69bef4cf80fbc373699c9b63a81f1df9259fba494ed17db717395087a5070e5f',
    );
    expect(deviceHash('A4BB6D123456')).toBe(
      'e03251884484465b07ac0f24d70faf70566b15eb4f001950c0a3b700dd427847',
    );
  });

  it('is shortened for display: eight characters, the rest of the set untouched', () => {
    const full = deviceHash('A4BB6D123456') ?? '';
    const shown = deviceForDisplay({ ...emptyDevice(), machine: full, mac: [full], vm: 'none' });
    expect(shown).toEqual({
      ...emptyDevice(),
      machine: 'e0325188…',
      mac: ['e0325188…'],
      vm: 'none',
    });
    expect(JSON.stringify(shown)).not.toContain(full);
  });

  it('gives null for a missing or empty value', () => {
    expect(deviceHash(null)).toBeNull();
    expect(deviceHash('')).toBeNull();
    expect(deviceHash('  ')).toBeNull();
  });
});
