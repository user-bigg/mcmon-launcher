import { open, readdir, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { readLogTail } from './game-log';
import { logOrderOf, NO_LOG_ORDER, type LogOrder } from './crash-rules';
import { findCrashReport } from './crash-files';
import { listModFileNames } from './instances';
import { javaMajorOfPath } from './java-components';
import { crashReportsDir, gameLogFile } from './layout';
import { completeLinesBefore, decodeLines } from './text-decode';

export interface LaunchNote {
  minecraft: string | null;
  javaPath: string | null;
  memoryMb: number | null;
}

export interface CrashFile {
  path: string;
  text: string;
}

export interface CrashFiles {
  logLines: string[];
  logHead: string;
  logOrder: LogOrder;
  crashReport: CrashFile | null;
  jvmReport: CrashFile | null;
  modFiles: string[];
  note: LaunchNote | null;
  nick: string | null;
  javaMajor: number | null;
}

const LOG_TAIL_LINES = 400;
export const LOG_ORDER_LIMIT_BYTES = 4 * 1024 * 1024;
const ORDER_CHUNK_BYTES = 64 * 1024;
const ORDER_CARRY = 512;
const HEAD_BYTES = 64 * 1024;
const REPORT_BYTES = 256 * 1024;
const JVM_REPORT = /^hs_err_pid\d+\.log$/;
const NOTE = /\[MC Monitor\] minecraft=(\S+)(?: \w+=\S+)*? java=(.+?) memory=(\d+)MB/;
const SETTING_USER = /Setting user: ([A-Za-z0-9_]{1,16})\b/;
const JAVA_VERSION_LINE = /(?:Java Version|JRE version):[^\d]*(\d+)(?:\.(\d+))?/;

async function readHead(file: string, bytes: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    const read = buffer.subarray(0, bytesRead);
    return decodeLines(bytesRead === bytes ? completeLinesBefore(read) : read);
  } finally {
    await handle.close();
  }
}

function earlier(found: number | null, next: number | null): number | null {
  return found ?? next;
}

// A modded log can run far past its first 64 KB before the game loads its resources: the two
// lines are looked for chunk by chunk, a piece of the previous chunk kept for a cut line.
export async function scanLogOrder(
  file: string,
  limit: number = LOG_ORDER_LIMIT_BYTES,
): Promise<LogOrder> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    return NO_LOG_ORDER;
  }
  try {
    let order: LogOrder = NO_LOG_ORDER;
    let carry = '';
    let position = 0;
    const buffer = Buffer.alloc(ORDER_CHUNK_BYTES);
    while (position < limit && (order.connectAt === null || order.loadAt === null)) {
      const { bytesRead } = await handle.read(buffer, 0, ORDER_CHUNK_BYTES, position);
      if (bytesRead === 0) {
        break;
      }
      const text = carry + buffer.toString('latin1', 0, bytesRead);
      const found = logOrderOf(text, position - carry.length);
      order = {
        connectAt: earlier(order.connectAt, found.connectAt),
        loadAt: earlier(order.loadAt, found.loadAt),
      };
      position += bytesRead;
      carry = text.slice(-ORDER_CARRY);
    }
    return order;
  } finally {
    await handle.close();
  }
}

export function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path);
}

export function parseLaunchNote(text: string): LaunchNote | null {
  const match = NOTE.exec(text);
  if (match === null) {
    return null;
  }
  const memory = Number(match[3]);
  return {
    minecraft: match[1] ?? null,
    javaPath: match[2] ?? null,
    memoryMb: Number.isSafeInteger(memory) ? memory : null,
  };
}

export function nickFromLog(text: string): string | null {
  return SETTING_USER.exec(text)?.[1] ?? null;
}

export function javaMajorFromReport(text: string | null): number | null {
  const match = text === null ? null : JAVA_VERSION_LINE.exec(text);
  if (match?.[1] === undefined) {
    return null;
  }
  const first = Number(match[1]);
  return first === 1 && match[2] !== undefined ? Number(match[2]) : first;
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
    if (info?.isFile() === true && info.mtimeMs >= since && info.mtimeMs > (newest?.mtime ?? -1)) {
      newest = { path, mtime: info.mtimeMs };
    }
  }
  return newest?.path ?? null;
}

async function readFileHead(path: string | null): Promise<CrashFile | null> {
  if (path === null) {
    return null;
  }
  const text = await readHead(path, REPORT_BYTES);
  return text === null ? null : { path, text };
}

async function crashReportPath(
  instance: string,
  since: number,
  reported: string | null,
): Promise<string | null> {
  const dir = crashReportsDir(instance);
  if (reported !== null && isInside(dir, reported)) {
    return reported;
  }
  return findCrashReport(dir, since);
}

export function listModFiles(instance: string): Promise<string[]> {
  return listModFileNames(instance);
}

export async function collectCrashFiles(
  instance: string,
  since: number,
  reportedCrash: string | null,
): Promise<CrashFiles> {
  const logFile = gameLogFile(instance);
  const [logLines, logHead, logOrder, crashPath, jvmPath, modFiles] = await Promise.all([
    readLogTail(logFile, LOG_TAIL_LINES, 0, { dropChat: true }),
    readHead(logFile, HEAD_BYTES),
    scanLogOrder(logFile),
    crashReportPath(instance, since, reportedCrash),
    newestFile(instance, since, (name) => JVM_REPORT.test(name)),
    listModFiles(instance),
  ]);
  const [crashReport, jvmReport] = await Promise.all([
    readFileHead(crashPath),
    readFileHead(jvmPath),
  ]);
  const head = (logHead ?? '')
    .split('\n')
    .filter((line) => !line.includes('[CHAT]'))
    .join('\n');
  const note = parseLaunchNote(head);
  const javaMajor =
    (note?.javaPath == null ? null : javaMajorOfPath(note.javaPath)) ??
    javaMajorFromReport(crashReport?.text ?? null) ??
    javaMajorFromReport(jvmReport?.text ?? null);
  return {
    logLines,
    logHead: head,
    logOrder,
    crashReport,
    jvmReport,
    modFiles,
    note,
    nick: nickFromLog(head) ?? nickFromLog(logLines.join('\n')),
    javaMajor,
  };
}

export async function waitForStableFile(
  file: string,
  intervalMs: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let previous = -1;
  while (Date.now() < deadline) {
    const size = (await stat(file).catch(() => null))?.size ?? -1;
    if (size === previous) {
      return;
    }
    previous = size;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
