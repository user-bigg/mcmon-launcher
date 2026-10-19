import type { LoaderId } from './instance';

export const MODRINTH_CDN_HOST = 'cdn.modrinth.com';

// Files of the CustomSkinLoader project on Modrinth and of nothing else there.
export const MODRINTH_MOD_PATH = '/data/idMHQ4n2/versions/';

const SHA256 = /^[0-9a-f]{64}$/;
const MOD_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,47}$/;

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}

export function isSkinModVersion(value: string): boolean {
  return MOD_VERSION.test(value) && !value.includes('..');
}

// The skins variant keeps its mod outside the game folder and points Fabric at it with
// fabric.modsFolder; Fabric Loader reads that property from 0.15.0 on.
export const SKIN_LOADER_MIN_VERSION: readonly number[] = [0, 15, 0];

export interface SkinModFile {
  version: string;
  urls: string[];
  sha256: string;
  size: number;
}

export interface SkinModEntry {
  minecraft: string;
  loader: 'fabric';
  loader_version: string;
  mod: SkinModFile;
}

export interface ClientModLine {
  minecraft_from: string;
  minecraft_to: string | null;
  loader_version: string;
  mod: SkinModFile;
}

export interface ClientMod {
  version: string;
  license: string | null;
  license_url: string | null;
  source_url: string | null;
  lines: ClientModLine[];
}

export interface SkinModTable {
  updated_at: string | null;
  service_root: string;
  source_url: string | null;
  license_url: string | null;
  license: string | null;
  entries: SkinModEntry[];
  client_mod: ClientMod | null;
}

export type SkinsAuth = 'nick' | 'license';

export const SKINS_OFF_REASONS = [
  'license',
  'server',
  'user',
  'loader',
  'table',
  'version',
] as const;
export type SkinsOffReason = (typeof SKINS_OFF_REASONS)[number];

export type SkinsStatus = 'on' | 'unavailable' | SkinsOffReason;

export type ClientModStatus = 'on' | 'off' | 'unavailable';

export interface ClientModRun {
  minecraft: string;
  sha256: string;
}

const SKINS_NOT_DELIVERED: readonly SkinsStatus[] = ['unavailable', 'version', 'table'];

export function telemetrySkins(status: SkinsStatus): 'on' | 'off' | 'unavailable' {
  if (status === 'on') {
    return 'on';
  }
  return SKINS_NOT_DELIVERED.includes(status) ? 'unavailable' : 'off';
}

export interface SkinsQuestion {
  auth: SkinsAuth;
  serverSkins: boolean | undefined;
  withoutMods: boolean;
  modpack?: boolean;
  loader: LoaderId;
  minecraft: string;
  table: SkinModTable | null;
}

export type SkinsDecision =
  { install: true; entry: SkinModEntry } | { install: false; reason: SkinsOffReason };

export function skinModEntry(table: SkinModTable | null, minecraft: string): SkinModEntry | null {
  return table?.entries.find((entry) => entry.minecraft === minecraft) ?? null;
}

export function skinsOffBeforeTable(
  question: Omit<SkinsQuestion, 'table' | 'minecraft'>,
): SkinsOffReason | null {
  if (question.auth === 'license') {
    return 'license';
  }
  if (question.serverSkins === false || question.modpack === true) {
    return 'server';
  }
  if (question.withoutMods) {
    return 'user';
  }
  return question.loader === 'vanilla' ? null : 'loader';
}

export function decideSkins(question: SkinsQuestion): SkinsDecision {
  const reason = skinsOffBeforeTable(question);
  if (reason !== null) {
    return { install: false, reason };
  }
  if (question.table === null) {
    return { install: false, reason: 'table' };
  }
  const entry = skinModEntry(question.table, question.minecraft);
  return entry === null ? { install: false, reason: 'version' } : { install: true, entry };
}

export function compareParts(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

function loaderParts(version: string): number[] | null {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(version);
  return match === null ? null : match.slice(1).map(Number);
}

export function isLoaderTriple(version: string): boolean {
  return loaderParts(version) !== null;
}

export function isSkinLoaderVersion(version: string): boolean {
  const parts = loaderParts(version);
  return parts !== null && compareParts(parts, SKIN_LOADER_MIN_VERSION) >= 0;
}

export function newerLoaderVersion(left: string, right: string): string {
  return compareParts(loaderParts(left) ?? [], loaderParts(right) ?? []) >= 0 ? left : right;
}

export function releaseParts(minecraft: string): number[] | null {
  const match = /^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/.exec(minecraft);
  return match === null
    ? null
    : match.slice(1).map((part: string | undefined) => Number(part ?? 0));
}

export function lineCovers(line: ClientModLine, minecraft: string): boolean {
  const version = releaseParts(minecraft);
  const from = releaseParts(line.minecraft_from);
  const to = line.minecraft_to === null ? null : releaseParts(line.minecraft_to);
  if (version === null || from === null || (line.minecraft_to !== null && to === null)) {
    return false;
  }
  return compareParts(version, from) >= 0 && (to === null || compareParts(version, to) <= 0);
}

export function clientModLine(table: SkinModTable | null, minecraft: string): ClientModLine | null {
  return table?.client_mod?.lines.find((line) => lineCovers(line, minecraft)) ?? null;
}

export interface ClientModQuestion {
  auth: SkinsAuth;
  modpack: boolean;
  loader: LoaderId;
}

// The code that the mod hands to the server exists only for a game by nickname; the mod comes
// on its own Fabric only into a game without a loader of its own, and a server with a modpack
// expects the plain game it always got.
export function wantsClientMod(question: ClientModQuestion): boolean {
  return question.auth === 'nick' && !question.modpack && question.loader === 'vanilla';
}

export function decideClientMod(
  question: ClientModQuestion & { minecraft: string; table: SkinModTable | null },
): ClientModLine | null {
  return wantsClientMod(question) ? clientModLine(question.table, question.minecraft) : null;
}
