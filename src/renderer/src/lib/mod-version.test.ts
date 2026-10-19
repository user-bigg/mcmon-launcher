import { describe, expect, it } from 'vitest';
import { shortModVersion } from './mod-version';

describe('short mod version', () => {
  it.each([
    ['fabric-1.21.11-2.6.22', '2.6.22'],
    ['3.2.0-b.build.163+1.21.11-fabric', '3.2.0'],
    ['0.8.14+mc1.21.11', '0.8.14'],
    ['mc1.21.11-0.6.13-fabric', '0.6.13'],
    ['v2.1.0', '2.1.0'],
    ['1.21.11-2.6.22', '2.6.22'],
    ['2.6.22-1.21.11', '2.6.22'],
    ['26.2-1.4.0-neoforge', '1.4.0'],
    ['1.21.11-1.5.2', '1.5.2'],
    ['1.0.0-beta.3', '1.0.0'],
    ['0.6.13', '0.6.13'],
    ['1.2.0', '1.2.0'],
  ])('%s → %s', (raw, short) => {
    expect(shortModVersion(raw)).toBe(short);
  });

  it('keeps the version as is when no number stands out', () => {
    expect(shortModVersion('build.163')).toBe('build.163');
    expect(shortModVersion('latest')).toBe('latest');
    expect(shortModVersion('')).toBe('');
  });
});
