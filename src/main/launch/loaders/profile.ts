import { LibraryInfo } from '@xmcl/core';
import { LoaderStageError, requireTrustedSource } from './sources';

export interface HashedArtifact {
  path: string;
  url: string;
  sha1: string;
  size: number;
}

export interface HashedLibrary {
  name: string;
  downloads: { artifact: HashedArtifact };
}

export interface LoaderProfile {
  id: string;
  inheritsFrom: string;
  mainClass: string;
  libraries: HashedLibrary[];
  arguments: { game: string[]; jvm: string[] };
  [key: string]: unknown;
}

export type Sha1Lookup = (url: string) => Promise<string>;

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAVEN_PART = '[A-Za-z0-9_][A-Za-z0-9_.+-]*';
const MAVEN_COORDINATE = new RegExp(
  `^${MAVEN_PART}:${MAVEN_PART}:${MAVEN_PART}(?::${MAVEN_PART})?$`,
);
const DEFAULT_MAVEN = 'https://libraries.minecraft.net/';
const JAVA_CLASS = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const KNOWN_JVM_PROPERTY = /^-D(?:FabricMcEmu|fabric\.[\w.-]+|loader\.[\w.-]+)=[^\p{Cc}]*$/u;
const GAME_ARGUMENT = /^[^\p{Cc}]{1,200}$/u;
const KEPT_FIELDS = ['releaseTime', 'time', 'type'] as const;

function isMavenCoordinate(name: string): boolean {
  return MAVEN_COORDINATE.test(name) && !name.includes('..');
}

function isSafeLibraryPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function declaredArtifact(library: Record<string, unknown>): HashedLibrary | null {
  const downloads = library.downloads;
  if (!isRecord(downloads) || !isRecord(downloads.artifact)) {
    return null;
  }
  const { path, url, sha1, size } = downloads.artifact;
  if (typeof path !== 'string' || typeof url !== 'string' || typeof sha1 !== 'string') {
    return null;
  }
  if (!SHA1.test(sha1) || !isSafeLibraryPath(path)) {
    return null;
  }
  return {
    name: String(library.name),
    downloads: {
      artifact: {
        path,
        url: requireTrustedSource(url),
        sha1,
        size: typeof size === 'number' ? size : -1,
      },
    },
  };
}

async function hashLibrary(value: unknown, lookup: Sha1Lookup): Promise<HashedLibrary> {
  if (!isRecord(value) || typeof value.name !== 'string' || !isMavenCoordinate(value.name)) {
    throw new LoaderStageError('manifest', 'malformed library');
  }
  const declared = declaredArtifact(value);
  if (declared !== null) {
    return declared;
  }
  const path = LibraryInfo.resolve(value.name).path;
  const base = typeof value.url === 'string' && value.url.length > 0 ? value.url : DEFAULT_MAVEN;
  const url = requireTrustedSource(`${withSlash(base)}${path}`);
  const sha1 =
    typeof value.sha1 === 'string' && SHA1.test(value.sha1) ? value.sha1 : await lookup(url);
  const size = typeof value.size === 'number' && value.size >= 0 ? value.size : -1;
  return { name: value.name, downloads: { artifact: { path, url, sha1, size } } };
}

export function sha256Of(value: unknown): string | null {
  return isRecord(value) && typeof value.sha256 === 'string' && SHA256.test(value.sha256)
    ? value.sha256
    : null;
}

export function libraryDigests(profile: Record<string, unknown>): Map<string, string> {
  const digests = new Map<string, string>();
  const libraries = Array.isArray(profile.libraries) ? (profile.libraries as unknown[]) : [];
  for (const library of libraries) {
    const sha256 = sha256Of(library);
    if (isRecord(library) && typeof library.name === 'string' && sha256 !== null) {
      digests.set(library.name, sha256);
    }
  }
  return digests;
}

export function parseLoaderProfile(text: string, minecraft: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (
    !isRecord(value) ||
    value.inheritsFrom !== minecraft ||
    typeof value.mainClass !== 'string' ||
    !JAVA_CLASS.test(value.mainClass) ||
    !Array.isArray(value.libraries)
  ) {
    throw new LoaderStageError('manifest', 'malformed loader profile');
  }
  return value;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function profileArguments(profile: Record<string, unknown>): {
  game: string[];
  jvm: string[];
} {
  const raw = isRecord(profile.arguments) ? profile.arguments : {};
  return {
    game: stringList(raw.game).filter((item) => GAME_ARGUMENT.test(item)),
    jvm: stringList(raw.jvm).filter((item) => KNOWN_JVM_PROPERTY.test(item)),
  };
}

export async function hashProfileLibraries(
  profile: Record<string, unknown>,
  id: string,
  lookup: Sha1Lookup,
): Promise<LoaderProfile> {
  const libraries = Array.isArray(profile.libraries) ? (profile.libraries as unknown[]) : [];
  const hashed = await Promise.all(libraries.map((library) => hashLibrary(library, lookup)));
  const kept: Record<string, unknown> = {};
  for (const field of KEPT_FIELDS) {
    if (typeof profile[field] === 'string') {
      kept[field] = profile[field];
    }
  }
  return {
    ...kept,
    id,
    inheritsFrom: String(profile.inheritsFrom),
    mainClass: String(profile.mainClass),
    arguments: profileArguments(profile),
    libraries: hashed,
  };
}
