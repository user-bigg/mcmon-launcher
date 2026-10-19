import { access, constants } from 'node:fs/promises';
import {
  createJavaRuntimeInstallWorkflow,
  DEFAULT_RUNTIME_ALL_URL,
  runInstallWorkflow,
  type JavaRuntimeTarget,
} from '@xmcl/installer';
import { failure } from './errors';
import { cachedJson, type FetchJson } from './json-cache';
import type { TrackedRuntime } from './download';
import { javaExecutables, type JavaPlace } from './layout';

export interface JavaRequirement {
  component: string;
  major: number;
}

export interface JavaVersionLike {
  javaVersion?: { component?: string; majorVersion?: number } | undefined;
}

const LEGACY_JAVA: JavaRequirement = { component: 'jre-legacy', major: 8 };
const INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function javaRequirement(version: JavaVersionLike): JavaRequirement {
  const component = version.javaVersion?.component;
  const major = version.javaVersion?.majorVersion;
  if (typeof component !== 'string' || component.length === 0 || typeof major !== 'number') {
    return LEGACY_JAVA;
  }
  return { component, major };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRuntimeIndex(value: unknown): boolean {
  return isRecord(value) && isRecord(value['windows-x64']);
}

export function pickJavaTarget(
  index: unknown,
  platform: string,
  component: string,
): JavaRuntimeTarget | null {
  if (!isRecord(index)) {
    return null;
  }
  const targets = index[platform];
  if (!isRecord(targets)) {
    return null;
  }
  const list = targets[component];
  if (!Array.isArray(list)) {
    return null;
  }
  const target: unknown = list[0];
  if (!isRecord(target) || !isRecord(target.manifest)) {
    return null;
  }
  const { url, sha1, size } = target.manifest;
  if (typeof url !== 'string' || typeof sha1 !== 'string' || typeof size !== 'number') {
    return null;
  }
  return target as unknown as JavaRuntimeTarget;
}

export interface JavaInstallOptions {
  requirement: JavaRequirement;
  platform: NodeJS.Platform;
  place: (index: unknown) => JavaPlace | null;
  indexCache: string;
  fetch: FetchJson;
  signal: AbortSignal;
  now: number;
  transfer: TrackedRuntime;
}

export async function firstExecutable(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

export async function installJava(options: JavaInstallOptions): Promise<string> {
  const { requirement } = options;
  const missing = failure({
    code: 'java-missing',
    component: requirement.component,
    major: requirement.major,
  });
  const index = await cachedJson({
    file: options.indexCache,
    url: DEFAULT_RUNTIME_ALL_URL,
    maxAgeMs: INDEX_MAX_AGE_MS,
    fetch: options.fetch,
    signal: options.signal,
    now: options.now,
    accept: isRuntimeIndex,
  });
  const place = options.place(index);
  const target =
    place === null ? null : pickJavaTarget(index, place.mojangPlatform, requirement.component);
  if (place === null || target === null) {
    throw missing;
  }
  const workflow = createJavaRuntimeInstallWorkflow({ target, destination: place.home });
  await runInstallWorkflow(workflow, (plan) => options.transfer.execute(plan));
  const executable = await firstExecutable(javaExecutables(place.home, options.platform));
  if (executable === null) {
    throw missing;
  }
  return executable;
}
