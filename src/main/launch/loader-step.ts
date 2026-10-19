import { Version, type MinecraftFolder, type ResolvedVersion } from '@xmcl/core';
import type { InstanceRuntime } from '@shared/instance';
import type { TrackedRuntime } from './download';
import { failure, toLaunchError } from './errors';
import { readVersionLock, verifyInstallation } from './game-files';
import { versionLockFile, type GameLayout } from './layout';
import { installLoader, type ModLoaderRuntime } from './loaders/install';
import { firstChangedPin, pinsFile, readPins } from './loaders/pins';
import type { FetchText } from './loaders/sources';
import { loaderVersionId } from './loaders/versions';

export interface LoaderStepOptions {
  layout: GameLayout;
  folder: MinecraftFolder;
  runtime: InstanceRuntime;
  fetch: FetchText;
  signal: AbortSignal;
  install?: typeof installLoader;
  verify?: typeof verifyInstallation;
}

export interface PreparedLoader {
  version: ResolvedVersion;
  lockFile: string;
  validatedAt: number | undefined;
  fresh: boolean;
}

export interface VerifiedBase {
  version: ResolvedVersion;
  validatedAt: number | undefined;
}

const NOT_REPAIRABLE = new Set([
  'cancelled',
  'disk-full',
  'permission-denied',
  'loader-install-failed',
]);

export function modLoaderRuntime(runtime: InstanceRuntime): ModLoaderRuntime {
  if (runtime.loader === 'vanilla' || runtime.loaderVersion === undefined) {
    throw failure({
      code: 'loader-not-found',
      loader: runtime.loader,
      minecraft: runtime.minecraft,
      version: runtime.loaderVersion ?? null,
    });
  }
  return {
    minecraft: runtime.minecraft,
    loader: runtime.loader,
    loaderVersion: runtime.loaderVersion,
  };
}

async function parseInstalled(
  folder: MinecraftFolder,
  id: string,
  minecraft: string,
): Promise<ResolvedVersion | null> {
  try {
    const version = await Version.parse(folder, id);
    return version.minecraftVersion === minecraft ? version : null;
  } catch {
    return null;
  }
}

export async function installLoaderVersion(
  options: LoaderStepOptions,
  transfer: TrackedRuntime,
): Promise<ResolvedVersion> {
  const runtime = modLoaderRuntime(options.runtime);
  const install = options.install ?? installLoader;
  const id = await install({
    layout: options.layout,
    folder: options.folder,
    runtime,
    fetch: options.fetch,
    signal: options.signal,
    transfer,
  });
  const version = await parseInstalled(options.folder, id, runtime.minecraft);
  if (version === null) {
    throw failure({
      code: 'loader-not-found',
      loader: runtime.loader,
      minecraft: runtime.minecraft,
      version: runtime.loaderVersion,
    });
  }
  return version;
}

export async function prepareLoader(
  options: LoaderStepOptions,
  transfer: TrackedRuntime,
): Promise<PreparedLoader> {
  const id = loaderVersionId(modLoaderRuntime(options.runtime));
  const lockFile = versionLockFile(options.layout, id);
  const validatedAt = await readVersionLock(lockFile, id);
  const installed =
    validatedAt === undefined
      ? null
      : await parseInstalled(options.folder, id, options.runtime.minecraft);
  if (installed !== null) {
    return { version: installed, lockFile, validatedAt, fresh: false };
  }
  const version = await installLoaderVersion(options, transfer);
  return { version, lockFile, validatedAt: undefined, fresh: true };
}

async function verifyPinned(options: LoaderStepOptions, prepared: PreparedLoader): Promise<void> {
  const id = prepared.version.id;
  const pins = await readPins(pinsFile(options.layout, id), id);
  if (pins === null) {
    throw failure({ code: 'checksum-mismatch', file: pinsFile(options.layout, id) });
  }
  const changed = await firstChangedPin(
    options.folder.root,
    pins,
    prepared.validatedAt,
    options.signal,
  );
  if (changed !== null) {
    throw failure({ code: 'checksum-mismatch', file: changed });
  }
}

// A freshly installed loader is fully verified by the installation: every maven file by sha1
// on download, and all hashes are pinned in mcmonitor-pins.json. So right after
// installation only the game files are checked. From the next launch the loader is checked
// against the pinned hashes and version.json, but, as with vanilla, only files changed after
// the lock file mark are hashed.
export async function verifyWithLoaderRepair(
  options: LoaderStepOptions,
  prepared: PreparedLoader,
  base: VerifiedBase,
  transfer: TrackedRuntime,
): Promise<ResolvedVersion> {
  const verify = options.verify ?? verifyInstallation;
  if (prepared.fresh) {
    await verify(base.version, options.folder, transfer, base.validatedAt, options.signal);
    return prepared.version;
  }
  try {
    await verify(prepared.version, options.folder, transfer, prepared.validatedAt, options.signal);
    await verifyPinned(options, prepared);
    return prepared.version;
  } catch (error) {
    if (options.signal.aborted || NOT_REPAIRABLE.has(toLaunchError(error).code)) {
      throw error;
    }
  }
  const reinstalled = await installLoaderVersion(options, transfer);
  await verify(base.version, options.folder, transfer, undefined, options.signal);
  return reinstalled;
}
