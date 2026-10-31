import { describe, expect, it } from 'vitest';
import {
  compareReleases,
  legacyJoinSkipsSrv,
  serverJoinMode,
  versionUnderCeiling,
} from './minecraft-version';

describe('serverJoinMode', () => {
  it.each([
    ['1.20', 'quick-play'],
    ['1.20.1', 'quick-play'],
    ['1.21.11', 'quick-play'],
    ['1.20-pre1', 'quick-play'],
    ['1.20-rc1', 'quick-play'],
    ['26.2', 'quick-play'],
    ['26.3', 'quick-play'],
    ['26.4-snapshot-2', 'quick-play'],
    ['2.0', 'quick-play'],
  ] as const)('%s — quickPlayMultiplayer', (id, mode) => {
    expect(serverJoinMode({ id })).toBe(mode);
  });

  it.each([
    ['1.6', 'legacy'],
    ['1.6.4', 'legacy'],
    ['1.12.2', 'legacy'],
    ['1.16.5', 'legacy'],
    ['1.19.4', 'legacy'],
    ['1.19.4-rc3', 'legacy'],
  ] as const)('%s: --server and --port', (id, mode) => {
    expect(serverJoinMode({ id })).toBe(mode);
  });

  it('versions before 1.6 cannot join a server from the command line', () => {
    expect(serverJoinMode({ id: '1.5.2' })).toBeNull();
    expect(serverJoinMode({ id: '1.0' })).toBeNull();
  });

  it('weekly snapshots: quickPlay from 23w14a, --server from 13w16a', () => {
    expect(serverJoinMode({ id: '23w14a' })).toBe('quick-play');
    expect(serverJoinMode({ id: '24w14a' })).toBe('quick-play');
    expect(serverJoinMode({ id: '23w13a' })).toBe('legacy');
    expect(serverJoinMode({ id: '13w16a' })).toBe('legacy');
    expect(serverJoinMode({ id: '13w15a' })).toBeNull();
  });

  it('does not rely on a 1. prefix: 10.x and 26.x are parsed as numbers', () => {
    expect(serverJoinMode({ id: '1.2' })).toBeNull();
    expect(serverJoinMode({ id: '10.0' })).toBe('quick-play');
  });

  it('non-standard versions are resolved by the release date from the Mojang manifest', () => {
    expect(serverJoinMode({ id: '23w13a_or_b', releaseTime: '2023-04-01T09:00:00+00:00' })).toBe(
      'legacy',
    );
    expect(serverJoinMode({ id: '24w14potato', releaseTime: '2024-04-01T12:00:00+00:00' })).toBe(
      'quick-play',
    );
    expect(serverJoinMode({ id: 'b1.7.3', releaseTime: '2011-07-07T22:00:00+00:00' })).toBeNull();
    expect(serverJoinMode({ id: 'rd-132211' })).toBeNull();
  });
});

describe('legacyJoinSkipsSrv', () => {
  it('--server in 1.6–1.16 does not look up SRV, from 1.17 and in quickPlay — it does', () => {
    expect(legacyJoinSkipsSrv({ id: '1.6.4' })).toBe(true);
    expect(legacyJoinSkipsSrv({ id: '1.12.2' })).toBe(true);
    expect(legacyJoinSkipsSrv({ id: '1.16.5' })).toBe(true);
    expect(legacyJoinSkipsSrv({ id: '20w45a' })).toBe(false);
    expect(legacyJoinSkipsSrv({ id: '20w30a' })).toBe(true);
    expect(legacyJoinSkipsSrv({ id: '1.17' })).toBe(false);
    expect(legacyJoinSkipsSrv({ id: '1.19.4' })).toBe(false);
    expect(legacyJoinSkipsSrv({ id: '26.2' })).toBe(false);
    expect(legacyJoinSkipsSrv({ id: '1.5.2' })).toBe(false);
  });

  it('a non-standard version — by release date: before 1.17 it does not look up SRV, after — it does', () => {
    expect(legacyJoinSkipsSrv({ id: 'custom', releaseTime: '2019-12-10T12:00:00+00:00' })).toBe(
      true,
    );
    expect(legacyJoinSkipsSrv({ id: 'custom', releaseTime: '2021-06-08T12:00:00+00:00' })).toBe(
      false,
    );
  });
});

describe('a version under the video card ceiling', () => {
  it('compares releases as typed in the catalog', () => {
    expect(compareReleases('1.8', '1.16.5')).toBe(-1);
    expect(compareReleases('1.16.5', '1.16.5')).toBe(0);
    expect(compareReleases('1.20.x', '1.16.5')).toBe(1);
    expect(compareReleases('26.3', '1.16.5')).toBe(1);
    expect(compareReleases('b1.7.3', '1.16.5')).toBeNull();
  });

  it('a server that takes 1.16.5 is played on it, a newer-only one keeps its version', () => {
    const wide = { from: '1.8', to: '26.3' };
    expect(versionUnderCeiling('26.3', wide, '1.16.5')).toBe('1.16.5');
    expect(versionUnderCeiling('26.3', { from: '1.16.5', to: '26.2' }, '1.16.5')).toBe('1.16.5');
    expect(versionUnderCeiling('26.3', { from: '1.21.11', to: '26.3' }, '1.16.5')).toBe('26.3');
    expect(versionUnderCeiling('1.12.2', { from: '1.8', to: '1.12.2' }, '1.16.5')).toBe('1.12.2');
    expect(versionUnderCeiling('26.3', wide, null)).toBe('26.3');
    expect(versionUnderCeiling('26.3', null, '1.16.5')).toBe('26.3');
    expect(versionUnderCeiling('26.3', { from: '1.8', to: '1.12.2' }, '1.16.5')).toBe('26.3');
  });
});
