import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const JVM_CRASH_LOG = /^hs_err_pid\d+\.log$/;

export interface CrashLocation {
  crashReportsDir: string;
  startedAt: number;
  instanceDir?: string;
}

export async function findCrashReport(dir: string, since: number): Promise<string | null> {
  return newestFile(dir, since, (name) => name.endsWith('.txt'));
}

export async function findJvmCrashLog(dir: string, since: number): Promise<string | null> {
  return newestFile(dir, since, (name) => JVM_CRASH_LOG.test(name));
}

async function newestFile(
  dir: string,
  since: number,
  accept: (name: string) => boolean,
): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  let newest: { path: string; mtime: number } | null = null;
  for (const name of names.filter(accept)) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (
      info !== null &&
      info.isFile() &&
      info.mtimeMs >= since &&
      (newest === null || info.mtimeMs > newest.mtime)
    ) {
      newest = { path, mtime: info.mtimeMs };
    }
  }
  return newest?.path ?? null;
}

export function firstReportLine(reported: string): string | null {
  const line = reported.split(/\r?\n/)[0]?.trim() ?? '';
  return line.length > 0 ? line : null;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path);
}

export async function reportedCrashFile(
  reported: string,
  instanceDir: string,
): Promise<string | null> {
  const line = firstReportLine(reported);
  if (line === null) {
    return null;
  }
  try {
    const [file, root] = await Promise.all([
      realpath(resolve(instanceDir, line)),
      realpath(instanceDir),
    ]);
    const info = await stat(file);
    return info.isFile() && isInside(root, file) ? file : null;
  } catch {
    return null;
  }
}

export async function locateCrashReport(
  reported: string,
  options: CrashLocation,
): Promise<string | null> {
  const instance = options.instanceDir ?? resolve(options.crashReportsDir, '..');
  return (
    (await reportedCrashFile(reported, instance)) ??
    (await findCrashReport(options.crashReportsDir, options.startedAt)) ??
    (await findJvmCrashLog(instance, options.startedAt))
  );
}
