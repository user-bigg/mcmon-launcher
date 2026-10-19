import { describe, expect, it } from 'vitest';
import { compareUpdateVersions } from './update';

describe('comparing launcher versions', () => {
  it('compares numbers part by part and puts a pre-release before its release', () => {
    expect(compareUpdateVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareUpdateVersions('0.2.0', '0.2.0')).toBe(0);
    expect(compareUpdateVersions('0.2.0-beta.1', '0.2.0')).toBe(-1);
    expect(compareUpdateVersions('0.2.0', '0.2.0-beta.1')).toBe(1);
    expect(compareUpdateVersions('0.2.0-beta.2', '0.2.0-beta.1')).toBe(1);
  });
});
