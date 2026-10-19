import { rm } from 'node:fs/promises';
import { checksum, Version, type MinecraftFolder, type ResolvedVersion } from '@xmcl/core';
import {
  diagnoseInstallation,
  resolveAssetInstallFiles,
  resolveAssetMetadataInstallManifest,
  resolveAssetObjectInstallFiles,
  resolveLibraryInstallFiles,
  resolveMinecraftJarInstallFile,
  type InstallFile,
  type InstallIssue,
} from '@xmcl/installer';
import { failure } from './errors';
import { filesPlan, type TrackedRuntime } from './download';
import { withFsRetry } from './fs-retry';
import { readJson, writeJsonBestEffort } from './json-cache';
import type { VersionEntry } from './version-manifest';

export interface VersionLock {
  schemaVersion: 1;
  version: string;
  validatedAt: string;
}

export function versionJsonFile(folder: MinecraftFolder, entry: VersionEntry): InstallFile {
  return {
    path: folder.getVersionJson(entry.id),
    urls: [entry.url],
    checksum: { algorithm: 'sha1', value: entry.sha1 },
    validator: 'json',
  };
}

export async function readVersionLock(file: string, version: string): Promise<number | undefined> {
  const lock = await readJson(file);
  if (typeof lock !== 'object' || lock === null) {
    return undefined;
  }
  const { schemaVersion, version: lockedVersion, validatedAt } = lock as Partial<VersionLock>;
  if (schemaVersion !== 1 || lockedVersion !== version || typeof validatedAt !== 'string') {
    return undefined;
  }
  const time = Date.parse(validatedAt);
  return Number.isNaN(time) ? undefined : time;
}

export async function writeVersionLock(
  file: string,
  version: string,
  at: number,
): Promise<boolean> {
  const lock: VersionLock = { schemaVersion: 1, version, validatedAt: new Date(at).toISOString() };
  return writeJsonBestEffort(file, lock);
}

export async function removeVersionLock(file: string): Promise<void> {
  await withFsRetry(() => rm(file, { force: true }));
}

const SHA1 = /^[0-9a-f]{40}$/i;

function hasSha1(value: string | undefined): boolean {
  return value !== undefined && SHA1.test(value);
}

export function fileWithoutHash(version: ResolvedVersion, folder: MinecraftFolder): string | null {
  if (!hasSha1(version.downloads.client?.sha1)) {
    return folder.getVersionJar(version.minecraftVersion);
  }
  const library = version.libraries.find((item) => !hasSha1(item.download.sha1));
  if (library !== undefined) {
    return folder.getLibraryByPath(library.download.path);
  }
  if (version.assetIndex !== undefined && !hasSha1(version.assetIndex.sha1)) {
    return folder.getPath('assets', 'indexes', `${version.assets}.json`);
  }
  return null;
}

export function assertHashes(version: ResolvedVersion, folder: MinecraftFolder): void {
  const file = fileWithoutHash(version, folder);
  if (file !== null) {
    throw failure({ code: 'checksum-mismatch', file });
  }
}

export function isPrecheckFailure(error: unknown): boolean {
  const kind =
    typeof error === 'object' && error !== null ? (error as { error?: unknown }).error : null;
  return kind === 'CorruptedVersionJar' || kind === 'MissingLibraries';
}

export async function countVerifiedFiles(
  version: ResolvedVersion,
  folder: MinecraftFolder,
): Promise<number> {
  const jar = version.downloads.client === undefined ? 0 : 1;
  const index = version.assetIndex;
  if (index === undefined) {
    return jar + version.libraries.length;
  }
  const content = await readJson(folder.getPath('assets', 'indexes', `${index.sha1}.json`));
  const objects =
    typeof content === 'object' && content !== null
      ? (content as { objects?: unknown }).objects
      : undefined;
  const assets = typeof objects === 'object' && objects !== null ? Object.keys(objects).length : 0;
  return jar + version.libraries.length + 1 + assets;
}

export async function installVersionJson(
  folder: MinecraftFolder,
  entry: VersionEntry,
  transfer: TrackedRuntime,
): Promise<ResolvedVersion> {
  await transfer.execute(filesPlan('version-json', [versionJsonFile(folder, entry)]));
  return Version.parse(folder, entry.id);
}

interface ValidationOptions {
  timestamp?: number;
}

function validation(timestamp: number | undefined): ValidationOptions {
  return timestamp === undefined ? {} : { timestamp };
}

function assetOptions(timestamp: number | undefined): ValidationOptions & {
  useHashForAssetsIndex: true;
} {
  return { ...validation(timestamp), useHashForAssetsIndex: true };
}

// diagnoseInstallation looks up the asset index by sha1, while launch looks it up by name
// (`34.json`): the metadata manifest stores the file under its sha1 and links the old name.
export async function installAssetIndex(
  version: ResolvedVersion,
  folder: MinecraftFolder,
  transfer: TrackedRuntime,
  timestamp: number | undefined,
): Promise<void> {
  await transfer.execute(
    resolveAssetMetadataInstallManifest(version, folder, assetOptions(timestamp)),
  );
}

async function installAssets(
  version: ResolvedVersion,
  folder: MinecraftFolder,
  transfer: TrackedRuntime,
  timestamp: number | undefined,
): Promise<void> {
  await installAssetIndex(version, folder, transfer, timestamp);
  await transfer.execute(
    filesPlan(
      'assets',
      await resolveAssetObjectInstallFiles(version, folder, assetOptions(timestamp)),
    ),
  );
}

// One batch for the client, libraries and assets: the download size is known up front, so
// the step progress does not jump to the end after the small first batch.
export async function installGameFiles(
  version: ResolvedVersion,
  folder: MinecraftFolder,
  transfer: TrackedRuntime,
  timestamp: number | undefined,
): Promise<void> {
  assertHashes(version, folder);
  const jar = resolveMinecraftJarInstallFile(version);
  if (jar === undefined) {
    throw failure({ code: 'version-not-found', minecraft: version.id });
  }
  const libraries = resolveLibraryInstallFiles(version.libraries, folder, validation(timestamp));
  const assets = await resolveAssetObjectInstallFiles(version, folder, assetOptions(timestamp));
  await transfer.execute(filesPlan('client', [jar, ...libraries, ...assets]));
}

function forceReplace(file: InstallFile): InstallFile {
  const copy: InstallFile = { ...file, replace: true, trustExistingSize: false };
  delete copy.validatedAt;
  return copy;
}

export function repairFiles(
  version: ResolvedVersion,
  folder: MinecraftFolder,
  issue: InstallIssue,
): InstallFile[] {
  const files: InstallFile[] = [];
  const jar = issue.jar === undefined ? undefined : resolveMinecraftJarInstallFile(version);
  if (jar !== undefined) {
    files.push(jar);
  }
  if (issue.libraries !== undefined) {
    files.push(...resolveLibraryInstallFiles(issue.libraries, folder));
  }
  if (issue.assets !== undefined) {
    files.push(...resolveAssetInstallFiles(issue.assets, folder));
  }
  return files.map(forceReplace);
}

export function firstIssueFile(
  version: ResolvedVersion,
  folder: MinecraftFolder,
  issue: InstallIssue,
): string {
  if (issue.jar !== undefined) {
    return folder.getVersionJar(version.minecraftVersion);
  }
  const library = issue.libraries?.[0];
  if (library !== undefined) {
    return folder.getLibraryByPath(library.download.path);
  }
  const asset = issue.assets?.[0];
  if (asset !== undefined) {
    return folder.getAsset(asset.hash);
  }
  return folder.getPath('assets', 'indexes', `${version.assetIndex?.sha1 ?? version.assets}.json`);
}

function countingChecksum(onFile: (() => void) | undefined) {
  return async (file: string, algorithm: string): Promise<string> => {
    try {
      return String(await checksum(file, algorithm));
    } finally {
      onFile?.();
    }
  };
}

export async function verifyInstallation(
  version: ResolvedVersion,
  folder: MinecraftFolder,
  transfer: TrackedRuntime,
  timestamp: number | undefined,
  signal: AbortSignal,
  onFile?: () => void,
): Promise<void> {
  assertHashes(version, folder);
  const hashing = { signal, checksum: countingChecksum(onFile) };
  const options = timestamp === undefined ? hashing : { ...hashing, timestamp };
  const issue = await diagnoseInstallation(version, options);
  signal.throwIfAborted();
  if (issue === undefined) {
    return;
  }
  await transfer.execute(filesPlan('repair', repairFiles(version, folder, issue)));
  if (issue.assetsIndex !== undefined) {
    await installAssets(version, folder, transfer, undefined);
  }
  const remaining = await diagnoseInstallation(version, { signal });
  signal.throwIfAborted();
  if (remaining !== undefined) {
    throw failure({ code: 'checksum-mismatch', file: firstIssueFile(version, folder, remaining) });
  }
}
