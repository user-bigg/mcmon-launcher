import { access, lstat, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type {
  CrashError,
  CrashFix,
  CrashFixOutcome,
  CrashFolder,
  CrashReportPreview,
  CrashResult,
} from '@shared/crash';
import type { JavaMajor } from '@shared/instance';
import { isAllowedMemoryMb } from '@shared/memory';
import { isInside } from './crash-sources';
import { isTransientFsError, withFsRetry } from './fs-retry';
import { javaMajorFor } from './java-components';
import { crashReportsDir, gameLogFile } from './layout';

export interface FixContext {
  root: string;
  instance: string;
  totalMemoryBytes: number;
  crashReportPath: string | null;
  saveMemory: (memoryMb: number) => Promise<void>;
  saveJava: (major: JavaMajor | null) => Promise<void>;
  openPath: (path: string) => Promise<string>;
  writeReport: () => Promise<CrashReportPreview>;
}

const MOD_FILE_NAME = /^[^\\/:*?"<>|\0]{1,200}\.(?:jar|zip|litemod)$/i;
const GAME_FILE = /^(?:libraries|versions|assets)\/[A-Za-z0-9._+\-/ ]{1,400}$/;
const LOG_FILE = /\.(?:txt|log)$/i;
const MAX_DISABLED_SUFFIX = 20;

function ok(fix: CrashFix, report: CrashReportPreview | null = null): CrashResult<CrashFixOutcome> {
  return { ok: true, value: { fix, report } };
}

function fail(error: CrashError): CrashResult<never> {
  return { ok: false, error };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function regularFile(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  return info?.isFile() === true;
}

async function setMemory(
  fix: Extract<CrashFix, { type: 'set-memory' }>,
  context: FixContext,
): Promise<CrashResult<CrashFixOutcome>> {
  if (!isAllowedMemoryMb(fix.mb, context.totalMemoryBytes)) {
    return fail({ code: 'invalid-request', field: 'mb' });
  }
  await context.saveMemory(fix.mb);
  return ok(fix);
}

// Java is installed by the next launch in the java step, with progress and cancel; here we
// only pick the version.
async function installJava(
  fix: Extract<CrashFix, { type: 'install-java' }>,
  context: FixContext,
): Promise<CrashResult<CrashFixOutcome>> {
  const major = javaMajorFor(fix.major);
  if (major === null) {
    return fail({ code: 'fix-not-available' });
  }
  await context.saveJava(major);
  return ok(fix);
}

async function resetJava(
  fix: Extract<CrashFix, { type: 'reset-java' }>,
  context: FixContext,
): Promise<CrashResult<CrashFixOutcome>> {
  await context.saveJava(null);
  return ok(fix);
}

async function changeFile(file: string, change: () => Promise<void>): Promise<CrashResult<null>> {
  try {
    await withFsRetry(change);
    return { ok: true, value: null };
  } catch (error) {
    if (isTransientFsError(error)) {
      return fail({ code: 'file-locked', file });
    }
    throw error;
  }
}

async function freeDisabledName(file: string): Promise<string | null> {
  for (let index = 0; index <= MAX_DISABLED_SUFFIX; index += 1) {
    const candidate = index === 0 ? `${file}.disabled` : `${file}.${String(index)}.disabled`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  return null;
}

async function disableMod(
  fix: Extract<CrashFix, { type: 'disable-mod' }>,
  context: FixContext,
): Promise<CrashResult<CrashFixOutcome>> {
  const mods = join(context.instance, 'mods');
  const file = join(mods, fix.file);
  if (!MOD_FILE_NAME.test(fix.file) || dirname(file) !== mods || !isInside(mods, file)) {
    return fail({ code: 'outside-game-dir' });
  }
  if (!(await regularFile(file))) {
    return fail({ code: 'file-missing', file: fix.file });
  }
  const target = await freeDisabledName(file);
  if (target === null) {
    return fail({ code: 'failed', message: 'disabled-name-taken' });
  }
  const renamed = await changeFile(fix.file, () => rename(file, target));
  return renamed.ok ? ok(fix) : renamed;
}

async function removeFile(
  fix: Extract<CrashFix, { type: 'remove-file' }>,
  context: FixContext,
): Promise<CrashResult<CrashFixOutcome>> {
  const relative = fix.path.replace(/\\/g, '/');
  const target = resolve(context.root, normalize(relative));
  if (
    !GAME_FILE.test(relative) ||
    relative.split('/').includes('..') ||
    !isInside(context.root, target)
  ) {
    return fail({ code: 'outside-game-dir' });
  }
  if (!(await regularFile(target))) {
    return fail({ code: 'file-missing', file: relative });
  }
  const removed = await changeFile(relative, () => unlink(target));
  return removed.ok ? ok(fix) : removed;
}

async function firstLogFile(paths: (string | null)[]): Promise<string | null> {
  for (const path of paths) {
    if (path !== null && LOG_FILE.test(path) && (await regularFile(path))) {
      return path;
    }
  }
  return null;
}

async function open(
  path: string,
  fix: CrashFix,
  context: FixContext,
): Promise<CrashResult<CrashFixOutcome>> {
  if (path !== context.instance && !isInside(context.instance, path)) {
    return fail({ code: 'outside-game-dir' });
  }
  const message = await context.openPath(path);
  return message.length === 0 ? ok(fix) : fail({ code: 'failed', message });
}

async function openLog(fix: CrashFix, context: FixContext): Promise<CrashResult<CrashFixOutcome>> {
  const candidates = [
    context.crashReportPath,
    join(context.instance, 'logs', 'latest.log'),
    gameLogFile(context.instance),
  ].filter((item) => item !== null && isInside(context.instance, item));
  const path = await firstLogFile(candidates);
  return path === null ? fail({ code: 'file-missing', file: 'log' }) : open(path, fix, context);
}

export function folderPath(instance: string, folder: CrashFolder): string {
  const folders: Record<CrashFolder, string> = {
    instance,
    mods: join(instance, 'mods'),
    logs: join(instance, 'logs'),
    'crash-reports': crashReportsDir(instance),
  };
  return folders[folder];
}

async function openFolder(
  fix: Extract<CrashFix, { type: 'open-folder' }>,
  context: FixContext,
): Promise<CrashResult<CrashFixOutcome>> {
  const path = folderPath(context.instance, fix.folder);
  if (fix.folder === 'mods') {
    await mkdir(path, { recursive: true });
  }
  const target = (await exists(path)) ? path : context.instance;
  return open(target, fix, context);
}

export async function applyCrashFix(
  fix: CrashFix,
  context: FixContext,
): Promise<CrashResult<CrashFixOutcome>> {
  if (!context.instance.startsWith(context.root + sep)) {
    return fail({ code: 'outside-game-dir' });
  }
  switch (fix.type) {
    case 'set-memory':
      return setMemory(fix, context);
    case 'install-java':
      return installJava(fix, context);
    case 'reset-java':
      return resetJava(fix, context);
    case 'disable-mod':
      return disableMod(fix, context);
    case 'remove-file':
      return removeFile(fix, context);
    case 'launch-without-join':
      return ok(fix);
    case 'open-log':
      return openLog(fix, context);
    case 'open-folder':
      return openFolder(fix, context);
    case 'report':
      return ok(fix, await context.writeReport());
    case 'advice':
      return fail({ code: 'fix-not-available' });
  }
}
