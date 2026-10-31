import { describe, expect, it } from 'vitest';
import { fittedLaunch, serverQueryParams } from './client';

describe('serverQueryParams', () => {
  it('the /servers query string', () => {
    expect(
      serverQueryParams({
        q: 'sky',
        mode: ['survival', 'anarchy'],
        access: 'all',
        page: 1,
      }).toString(),
    ).toBe('q=sky&mode%5B%5D=survival&mode%5B%5D=anarchy');
  });
});

describe('fittedLaunch', () => {
  const row = {
    versions: { from: '1.8', to: '26.3' },
    launch: { kind: 'direct', minecraft: '26.3', skins: true },
  } as unknown as Parameters<typeof fittedLaunch>[0];

  it('an old video card plays a wide server on 1.16.5', () => {
    expect(fittedLaunch(row, '1.16.5')).toEqual({
      kind: 'direct',
      minecraft: '1.16.5',
      skins: true,
    });
  });

  it('a modpack or required server mods keep the server version', () => {
    const modded = { ...row, launch: { ...row.launch, modpack: true } } as typeof row;
    expect(fittedLaunch(modded, '1.16.5')).toBe(modded.launch);
  });

  it('without a ceiling the launch is the site one', () => {
    expect(fittedLaunch(row, null)).toBe(row.launch);
  });
});
