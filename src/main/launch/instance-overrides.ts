import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isJavaMajor,
  parseInstalledRuntime,
  type InstalledRuntime,
  type JavaMajor,
} from '@shared/instance';
import { isValidVersionId } from '@shared/launch';
import { MIN_MEMORY_MB } from '@shared/memory';
import { failure } from './errors';
import { withFsRetry } from './fs-retry';
import type { LaunchProfile } from './launch-profile';

export interface InstanceOverrides {
  memoryMb?: number;
  javaMajor?: JavaMajor | null;
  javaFor?: string;
}

const FILE_NAME = 'mcmonitor-instance.json';
const MAX_MEMORY_MB = 1024 * 1024;

export function instanceOverridesFile(instance: string): string {
  return join(instance, FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMemory(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_MEMORY_MB &&
    value <= MAX_MEMORY_MB
    ? value
    : undefined;
}

async function readRaw(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function readInstanceOverrides(instance: string): Promise<InstanceOverrides> {
  const raw = await readRaw(instanceOverridesFile(instance));
  const overrides: InstanceOverrides = {};
  const memoryMb = parseMemory(raw.memoryMb);
  if (memoryMb !== undefined) {
    overrides.memoryMb = memoryMb;
  }
  if (
    isJavaMajor(raw.javaMajor) &&
    typeof raw.javaFor === 'string' &&
    isValidVersionId(raw.javaFor)
  ) {
    overrides.javaMajor = raw.javaMajor;
    overrides.javaFor = raw.javaFor;
  }
  return overrides;
}

export async function writeInstanceOverrides(
  instance: string,
  patch: InstanceOverrides,
): Promise<void> {
  const exists = await stat(instance).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!exists) {
    throw failure({ code: 'file-missing', path: instance });
  }
  const file = instanceOverridesFile(instance);
  const next: Record<string, unknown> = { ...(await readRaw(file)), ...patch };
  if (next.javaMajor === null) {
    delete next.javaMajor;
    delete next.javaFor;
  }
  await writeRaw(file, next);
}

async function writeRaw(file: string, data: Record<string, unknown>): Promise<void> {
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await withFsRetry(() => rename(temporary, file));
}

export async function readInstalledRuntime(instance: string): Promise<InstalledRuntime | null> {
  return parseInstalledRuntime((await readRaw(instanceOverridesFile(instance))).installed);
}

export async function writeInstalledRuntime(
  instance: string,
  installed: InstalledRuntime,
): Promise<void> {
  await mkdir(instance, { recursive: true });
  const file = instanceOverridesFile(instance);
  await writeRaw(file, { ...(await readRaw(file)), installed });
}

export async function withFolderOverrides(
  profile: LaunchProfile,
  folderPath: (folderId: string) => string,
): Promise<LaunchProfile> {
  const overrides = await readInstanceOverrides(folderPath(profile.folderId));
  return {
    ...profile,
    memoryMb: overrides.memoryMb ?? profile.memoryMb,
    javaOverride:
      overrides.javaFor === profile.runtime.minecraft
        ? (overrides.javaMajor ?? profile.javaOverride)
        : profile.javaOverride,
  };
}
