import { checksum, Version, type MinecraftFolder, type ResolvedLibrary } from '@xmcl/core';
import { resolveFabricProfileInstallManifest, resolveLibraryInstallFiles } from '@xmcl/installer';
import type { LoaderInstallStage } from '@shared/launch';
import { filesPlan, type TrackedRuntime } from '../download';
import { failure, toLaunchError, type LaunchFailure } from '../errors';
import type { GameLayout } from '../layout';
import { mergePins, PinCollector, pinsFile, readPins, writePins, type LoaderPins } from './pins';
import { hashProfileLibraries, libraryDigests, parseLoaderProfile } from './profile';
import {
  FABRIC_META,
  fetchMavenSha1,
  isNotFound,
  LoaderStageError,
  requireTrustedSource,
  segment,
  type FetchText,
} from './sources';
import { loaderVersionId } from './versions';

export interface ModLoaderRuntime {
  minecraft: string;
  loader: 'fabric';
  loaderVersion: string;
}

export interface LoaderInstallOptions {
  layout: GameLayout;
  folder: MinecraftFolder;
  runtime: ModLoaderRuntime;
  fetch: FetchText;
  signal: AbortSignal;
  transfer: TrackedRuntime;
}

const PASSTHROUGH_CODES = new Set([
  'cancelled',
  'network',
  'disk-full',
  'permission-denied',
  'file-locked',
  'too-many-files',
  'checksum-mismatch',
  'loader-not-found',
]);

function loaderNotFound(runtime: ModLoaderRuntime): Error {
  return failure({
    code: 'loader-not-found',
    loader: runtime.loader,
    minecraft: runtime.minecraft,
    version: runtime.loaderVersion,
  });
}

async function lookup<T>(runtime: ModLoaderRuntime, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw isNotFound(error) ? loaderNotFound(runtime) : error;
  }
}

export function profileUrl(runtime: ModLoaderRuntime): string {
  const game = segment(runtime.minecraft);
  const loader = segment(runtime.loaderVersion);
  return `${FABRIC_META}/v2/versions/loader/${game}/${loader}/profile/json`;
}

export function declaredSourceOnly(library: ResolvedLibrary): string[] {
  const url = library.download.url;
  if (url.length === 0) {
    return [];
  }
  return [requireTrustedSource(url)];
}

async function verifySha256(
  folder: MinecraftFolder,
  profile: Record<string, unknown>,
  libraries: readonly { name: string; downloads: { artifact: { path: string } } }[],
): Promise<void> {
  const digests = libraryDigests(profile);
  for (const library of libraries) {
    const expected = digests.get(library.name);
    if (expected === undefined) {
      continue;
    }
    const file = folder.getLibraryByPath(library.downloads.artifact.path);
    if (String(await checksum(file, 'sha256')) !== expected) {
      throw failure({ code: 'checksum-mismatch', file });
    }
  }
}

async function installFabric(
  options: LoaderInstallOptions,
  id: string,
  pins: PinCollector,
): Promise<void> {
  const { runtime, folder, transfer, signal } = options;
  const text = await lookup(runtime, () => options.fetch(profileUrl(runtime), signal));
  const profile = parseLoaderProfile(text, runtime.minecraft);
  const hashed = await hashProfileLibraries(profile, id, (url) =>
    fetchMavenSha1(url, options.fetch, signal),
  );
  const { plan } = resolveFabricProfileInstallManifest(hashed as unknown as Version, {
    minecraftVersion: runtime.minecraft,
    version: runtime.loaderVersion,
    minecraft: folder,
    versionId: id,
  });
  await transfer.execute(plan);
  const libraries = Version.resolveLibraries(hashed.libraries);
  const files = resolveLibraryInstallFiles(libraries, folder, { libraryHost: declaredSourceOnly });
  await transfer.execute(filesPlan('loader-libraries', files));
  await verifySha256(folder, profile, hashed.libraries);
  for (const library of hashed.libraries) {
    const artifact = library.downloads.artifact;
    pins.add(folder.getLibraryByPath(artifact.path), artifact.sha1);
  }
}

function asLoaderError(error: unknown, runtime: ModLoaderRuntime, signal: AbortSignal): unknown {
  if (signal.aborted) {
    return error;
  }
  const failed = (stage: LoaderInstallStage, detail: string | null): LaunchFailure =>
    failure({ code: 'loader-install-failed', loader: runtime.loader, stage, detail });
  if (error instanceof LoaderStageError) {
    return failed(error.stage, error.detail);
  }
  const launchError = toLaunchError(error);
  if (PASSTHROUGH_CODES.has(launchError.code)) {
    return error;
  }
  const message = error instanceof Error ? (error.message.split('\n')[0] ?? null) : null;
  return failed('manifest', message);
}

export async function installLoader(options: LoaderInstallOptions): Promise<string> {
  const { runtime, layout, folder } = options;
  const id = loaderVersionId(runtime);
  const pins = new PinCollector(folder.root);
  try {
    await installFabric(options, id, pins);
    const file = pinsFile(layout, id);
    const merged: LoaderPins = mergePins(await readPins(file, id), pins.toPins(id));
    await writePins(file, merged);
  } catch (error) {
    throw asLoaderError(error, runtime, options.signal);
  }
  return id;
}
