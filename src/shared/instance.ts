import type { CoverTime, ServerCover } from './catalog';
import { isValidServerId, isValidVersionId, type LaunchResult } from './launch';

export const LOADERS = ['vanilla', 'fabric'] as const;
export type LoaderId = (typeof LOADERS)[number];

export const JAVA_MAJORS = [8, 16, 17, 21, 25] as const;
export type JavaMajor = (typeof JAVA_MAJORS)[number];

export interface InstanceRuntime {
  minecraft: string;
  loader: LoaderId;
  loaderVersion?: string;
}

export interface InstalledLoader {
  kind: LoaderId;
  version: string | null;
}

export interface InstalledRuntime {
  minecraft: string;
  loader: InstalledLoader;
}

export interface ServerInstanceInfo {
  folderId: string;
  serverId: number;
  sizeBytes: number;
  lastPlayedAt: string | null;
  installed: InstalledRuntime | null;
}

export interface InstanceLaunchOptions {
  withoutMods: boolean;
}

export interface SharedFiles {
  bytes: number;
}

export interface InstanceService {
  list: () => Promise<LaunchResult<ServerInstanceInfo[]>>;
  sharedFiles: () => Promise<LaunchResult<SharedFiles>>;
  remove: (folderId: string) => Promise<LaunchResult<null>>;
  launchOptions: (folderId: string) => Promise<LaunchResult<InstanceLaunchOptions>>;
  setWithoutMods: (folderId: string, off: boolean) => Promise<LaunchResult<InstanceLaunchOptions>>;
}

const SERVER_FOLDER = /^server-(\d{1,12})$/;

export function serverIdOfFolder(folderId: string): number | null {
  const id = Number(SERVER_FOLDER.exec(folderId)?.[1]);
  return isValidServerId(id) ? id : null;
}

export const COVER_TIMES: readonly CoverTime[] = ['day', 'sunset', 'night', 'auto'];
const COVER_SCENE = /^[a-z0-9-]{1,16}$/;
const LOADER_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,47}$/;

export function isLoaderId(value: unknown): value is LoaderId {
  return typeof value === 'string' && (LOADERS as readonly string[]).includes(value);
}

export function isJavaMajor(value: unknown): value is JavaMajor {
  return typeof value === 'number' && (JAVA_MAJORS as readonly number[]).includes(value);
}

export function isValidLoaderVersion(version: string): boolean {
  return LOADER_VERSION.test(version) && !version.includes('..') && !version.endsWith('.');
}

export function isValidCover(value: unknown): value is ServerCover {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { scene, time } = value as Record<string, unknown>;
  return (
    typeof scene === 'string' &&
    COVER_SCENE.test(scene) &&
    typeof time === 'string' &&
    (COVER_TIMES as readonly string[]).includes(time)
  );
}

// The catalog has no loader field yet: every catalog server installs as vanilla. When the site
// starts sending a loader, this is the one place to change for both the installer and the hints.
export function catalogServerRuntime(minecraft: string): InstanceRuntime {
  return { minecraft, loader: 'vanilla' };
}

export function installedRuntimeOf(runtime: InstanceRuntime): InstalledRuntime {
  return {
    minecraft: runtime.minecraft,
    loader: {
      kind: runtime.loader,
      version: runtime.loader === 'vanilla' ? null : (runtime.loaderVersion ?? null),
    },
  };
}

function parseInstalledLoader(value: unknown): InstalledLoader | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { kind, version } = value as Record<string, unknown>;
  if (!isLoaderId(kind)) {
    return null;
  }
  if (version === null) {
    return { kind, version: null };
  }
  return typeof version === 'string' && kind !== 'vanilla' && isValidLoaderVersion(version)
    ? { kind, version }
    : null;
}

export function parseInstalledRuntime(value: unknown): InstalledRuntime | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { minecraft, loader } = value as Record<string, unknown>;
  const parsedLoader = parseInstalledLoader(loader);
  return typeof minecraft === 'string' && isValidVersionId(minecraft) && parsedLoader !== null
    ? { minecraft, loader: parsedLoader }
    : null;
}

export function sameInstalledRuntime(a: InstalledRuntime, b: InstalledRuntime): boolean {
  return (
    a.minecraft === b.minecraft &&
    a.loader.kind === b.loader.kind &&
    a.loader.version === b.loader.version
  );
}
