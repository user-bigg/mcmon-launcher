import type { JoinMode } from './launch';

export interface VersionMoment {
  id: string;
  releaseTime?: string;
}

const QUICK_PLAY_SNAPSHOT_WEEK = 2314;
const SERVER_ARGUMENT_SNAPSHOT_WEEK = 1316;
const QUICK_PLAY_SINCE = Date.parse('2023-04-05T00:00:00Z');
const SERVER_ARGUMENT_SINCE = Date.parse('2013-04-18T00:00:00Z');

const WEEKLY_SNAPSHOT = /^(\d{2})w(\d{2})[a-z]$/i;
const RELEASE = /^(\d+)\.(\d+)(?:\.\d+)?(?:[- _].*)?$/;

function modeBySnapshotWeek(year: number, week: number): JoinMode | null {
  const stamp = year * 100 + week;
  if (stamp >= QUICK_PLAY_SNAPSHOT_WEEK) {
    return 'quick-play';
  }
  return stamp >= SERVER_ARGUMENT_SNAPSHOT_WEEK ? 'legacy' : null;
}

function modeByRelease(major: number, minor: number): JoinMode | null {
  if (major > 1 || (major === 1 && minor >= 20)) {
    return 'quick-play';
  }
  return major === 1 && minor >= 6 ? 'legacy' : null;
}

function modeByReleaseTime(releaseTime: string | undefined): JoinMode | null {
  const time = releaseTime === undefined ? Number.NaN : Date.parse(releaseTime);
  if (Number.isNaN(time)) {
    return null;
  }
  if (time >= QUICK_PLAY_SINCE) {
    return 'quick-play';
  }
  return time >= SERVER_ARGUMENT_SINCE ? 'legacy' : null;
}

export function serverJoinMode(version: VersionMoment): JoinMode | null {
  const snapshot = WEEKLY_SNAPSHOT.exec(version.id);
  if (snapshot !== null) {
    return modeBySnapshotWeek(Number(snapshot[1]), Number(snapshot[2]));
  }
  const release = RELEASE.exec(version.id);
  if (release !== null) {
    return modeByRelease(Number(release[1]), Number(release[2]));
  }
  return modeByReleaseTime(version.releaseTime);
}

const SERVER_SRV_SNAPSHOT_WEEK = 2045;
const SERVER_SRV_SINCE = Date.parse('2020-11-04T00:00:00Z');

function before117(version: VersionMoment): boolean {
  const snapshot = WEEKLY_SNAPSHOT.exec(version.id);
  if (snapshot !== null) {
    return Number(snapshot[1]) * 100 + Number(snapshot[2]) < SERVER_SRV_SNAPSHOT_WEEK;
  }
  const release = RELEASE.exec(version.id);
  if (release !== null) {
    return Number(release[1]) === 1 && Number(release[2]) < 17;
  }
  const time = version.releaseTime === undefined ? Number.NaN : Date.parse(version.releaseTime);
  return !Number.isNaN(time) && time < SERVER_SRV_SINCE;
}

export function legacyJoinSkipsSrv(version: VersionMoment): boolean {
  return serverJoinMode(version) === 'legacy' && before117(version);
}

// 1.16.4 and 1.16.5 ship authlib 2.1.28: at start the client asks api.minecraftservices.com
// for the account privileges, and an answer to a token that is not a Microsoft one leaves
// 'Multiplayer' greyed out. Only an unreachable service makes that authlib fall back to
// offline privileges. 1.16.3 (authlib 1.6.25) has no such request; from 1.17 (authlib 2.3.31)
// a refused token is treated as offline by the game itself.
export const NICK_SERVICES_BLOCK = { minor: 16, fromPatch: 4, toPatch: 5 } as const;

const PATCHED_RELEASE = /^1\.(\d+)\.(\d+)(?:[- _].*)?$/;

export function nickNeedsServicesBlock(version: VersionMoment): boolean {
  const release = PATCHED_RELEASE.exec(version.id);
  if (release === null) {
    return false;
  }
  const patch = Number(release[2]);
  return (
    Number(release[1]) === NICK_SERVICES_BLOCK.minor &&
    patch >= NICK_SERVICES_BLOCK.fromPatch &&
    patch <= NICK_SERVICES_BLOCK.toPatch
  );
}

// 21w10a (1.17) moved the renderer to the OpenGL 3.2 core profile.
const CORE_PROFILE_SNAPSHOT_WEEK = 2110;
const NUMBERED = /^(\d+)\.(\d+)(?:\.(\d+|x))?(?:[- _].*)?$/i;

export function needsCoreProfile(minecraft: string): boolean {
  const snapshot = WEEKLY_SNAPSHOT.exec(minecraft);
  if (snapshot !== null) {
    return Number(snapshot[1]) * 100 + Number(snapshot[2]) >= CORE_PROFILE_SNAPSHOT_WEEK;
  }
  const release = RELEASE.exec(minecraft);
  if (release === null) {
    return false;
  }
  const major = Number(release[1]);
  return major > 1 || (major === 1 && Number(release[2]) >= 17);
}

// Catalog ranges come as typed by owners ("1.8.x", "26.3"); "x" counts as the first patch.
export function compareReleases(left: string, right: string): number | null {
  const a = NUMBERED.exec(left.trim());
  const b = NUMBERED.exec(right.trim());
  if (a === null || b === null) {
    return null;
  }
  const parts = (match: RegExpExecArray): number[] => [
    Number(match[1]),
    Number(match[2]),
    match[3] === undefined || match[3].toLowerCase() === 'x' ? 0 : Number(match[3]),
  ];
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) {
    const diff = (x[index] ?? 0) - (y[index] ?? 0);
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  return 0;
}

// A server whose range reaches down to the ceiling is played on the ceiling version: the game
// the site names would not start on this computer's video card.
export function versionUnderCeiling(
  minecraft: string,
  range: { from: string; to: string } | null,
  ceiling: string | null,
): string {
  if (ceiling === null || range === null || !needsCoreProfile(minecraft)) {
    return minecraft;
  }
  const from = compareReleases(range.from, ceiling);
  const to = compareReleases(range.to, ceiling);
  return from !== null && from <= 0 && to !== null && to >= 0 ? ceiling : minecraft;
}
