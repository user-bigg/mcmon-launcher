import { failure } from './errors';
import { ageMs, readJson, writeJsonBestEffort, type FetchJson } from './json-cache';

export const VERSION_MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

export interface VersionEntry {
  id: string;
  type: string;
  url: string;
  sha1: string;
  releaseTime: string;
}

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: VersionEntry[];
}

const SHA1 = /^[0-9a-f]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseEntry(value: unknown): VersionEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, type, url, sha1, releaseTime } = value;
  if (
    typeof id !== 'string' ||
    typeof type !== 'string' ||
    !isHttpsUrl(url) ||
    typeof sha1 !== 'string' ||
    !SHA1.test(sha1) ||
    typeof releaseTime !== 'string'
  ) {
    return null;
  }
  return { id, type, url, sha1, releaseTime };
}

export function parseVersionManifest(value: unknown): VersionManifest | null {
  if (!isRecord(value) || !Array.isArray(value.versions) || !isRecord(value.latest)) {
    return null;
  }
  const { release, snapshot } = value.latest;
  if (typeof release !== 'string' || typeof snapshot !== 'string') {
    return null;
  }
  const versions = value.versions
    .map(parseEntry)
    .filter((entry): entry is VersionEntry => entry !== null);
  return versions.length === 0 ? null : { latest: { release, snapshot }, versions };
}

export const VERSION_MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// mtime is more precise than Date.now(): a freshly written cache can be 'from the future'
// by a fraction of a millisecond.
const CLOCK_SKEW_MS = 60 * 1000;

export interface VersionManifestSource {
  cacheFile: string;
  fetch: FetchJson;
  signal: AbortSignal;
  now?: number;
}

export interface FindVersionOptions {
  refresh?: boolean;
}

export async function fetchVersionManifest(
  source: VersionManifestSource,
): Promise<VersionManifest> {
  const fresh = parseVersionManifest(await source.fetch(VERSION_MANIFEST_URL, source.signal));
  if (fresh === null) {
    throw failure({ code: 'network', url: VERSION_MANIFEST_URL, reason: 'http' });
  }
  await writeJsonBestEffort(source.cacheFile, fresh);
  return fresh;
}

async function cachedManifest(
  source: VersionManifestSource,
): Promise<{ manifest: VersionManifest; fresh: boolean } | null> {
  const manifest = parseVersionManifest(await readJson(source.cacheFile));
  if (manifest === null) {
    return null;
  }
  const age = await ageMs(source.cacheFile, source.now ?? Date.now());
  return {
    manifest,
    fresh: age !== null && age >= -CLOCK_SKEW_MS && age < VERSION_MANIFEST_MAX_AGE_MS,
  };
}

function entryOf(manifest: VersionManifest | undefined, id: string): VersionEntry | undefined {
  return manifest?.versions.find((entry) => entry.id === id);
}

export async function findVersion(
  id: string,
  source: VersionManifestSource,
  options: FindVersionOptions = {},
): Promise<VersionEntry> {
  const cached = options.refresh === true ? null : await cachedManifest(source);
  const fromCache = entryOf(cached?.manifest, id);
  if (fromCache !== undefined && cached?.fresh === true) {
    return fromCache;
  }
  let fresh: VersionManifest;
  try {
    fresh = await fetchVersionManifest(source);
  } catch (error) {
    if (fromCache === undefined || source.signal.aborted) {
      throw error;
    }
    return fromCache;
  }
  const entry = entryOf(fresh, id);
  if (entry === undefined) {
    throw failure({ code: 'version-not-found', minecraft: id });
  }
  return entry;
}
