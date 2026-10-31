import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CrashCause } from '@shared/crash';
import { serverIdOfFolder } from '@shared/instance';
import type { CrashUpload } from '@shared/telemetry';
import { redactSecrets } from './crash-redact';
import { gameLogFile } from './layout';

export const UPLOAD_PART_BYTES = 64 * 1024;
// The site takes up to 192 KB; the install header needs well under 4 KB of it.
const UPLOAD_BODY_BYTES = 188 * 1024;
const EARLY_EXIT_MS = 2 * 60 * 1000;
const PROBLEM_MAX = 64;

export interface CrashUploadInput {
  instanceDir: string;
  folderId: string;
  minecraft: string;
  loader: string;
  launchId: string | null;
  clientMod: boolean;
  javaMajor: number | null;
  exitCode: number | null;
  uptimeMs: number;
  cause: CrashCause;
  crashReport: string | null;
  since: number;
}

export interface CrashMoment {
  stoppedByUser: boolean;
  crashed: boolean;
  exitCode: number | null;
  uptimeMs: number;
  cause: CrashCause;
}

export function shouldUpload(moment: CrashMoment): boolean {
  if (moment.stoppedByUser || moment.cause.code === 'closed') {
    return false;
  }
  return moment.crashed || (moment.exitCode !== 0 && moment.uptimeMs < EARLY_EXIT_MS);
}

export function problemOf(cause: CrashCause): string {
  const detail = cause.code === 'graphics' ? `.${cause.problem}` : '';
  return `${cause.code}${detail}`.slice(0, PROBLEM_MAX);
}

const CONTINUATION_MASK = 0xc0;
const CONTINUATION = 0x80;

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & CONTINUATION_MASK) === CONTINUATION;
}

// The cut moves to a character boundary, so no replacement character makes a part longer.
export function tailOf(text: string, maxBytes: number = UPLOAD_PART_BYTES): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) {
    return text;
  }
  let start = bytes.length - maxBytes;
  while (isContinuation(bytes[start])) {
    start += 1;
  }
  const tail = bytes.subarray(start).toString('utf8');
  const lineStart = tail.indexOf('\n');
  return lineStart === -1 || bytes[start - 1] === 0x0a ? tail : tail.slice(lineStart + 1);
}

// A crash report and a JVM report put the cause at the top.
export function headOf(text: string, maxBytes: number = UPLOAD_PART_BYTES): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) {
    return text;
  }
  let end = maxBytes;
  while (isContinuation(bytes[end])) {
    end -= 1;
  }
  const head = bytes.subarray(0, end).toString('utf8');
  const lineEnd = head.lastIndexOf('\n');
  return lineEnd === -1 ? head : head.slice(0, lineEnd);
}

// Read with room to spare: redaction and line cleanup shorten the text before the final cut.
const READ_BYTES = 2 * UPLOAD_PART_BYTES;
const CHAT_MARK = '[CHAT]';

async function readTail(file: string, since: number): Promise<string | null> {
  const fresh = await stat(file).then(
    (info) => info.mtimeMs >= since,
    () => false,
  );
  const handle = fresh ? await open(file, 'r').catch(() => null) : null;
  if (handle === null) {
    return null;
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, READ_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return tailOf(buffer.toString('utf8'), READ_BYTES);
  } finally {
    await handle.close();
  }
}

// Chat lines carry other players' messages, private ones included: they stay on the computer.
function cleanLog(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.includes(CHAT_MARK))
    .join('\n');
}

// A game that died before log4j started leaves the previous run's latest.log behind.
export async function readLogTail(instanceDir: string, since: number): Promise<string> {
  const latest = await readTail(path.join(instanceDir, 'logs', 'latest.log'), since);
  if (latest !== null && latest.trim() !== '') {
    return cleanLog(latest);
  }
  return cleanLog((await readTail(gameLogFile(instanceDir), since)) ?? '');
}

export async function buildCrashUpload(input: CrashUploadInput): Promise<CrashUpload> {
  const serverId = serverIdOfFolder(input.folderId);
  const logTail = redactSecrets(await readLogTail(input.instanceDir, input.since));
  const crashReport =
    input.crashReport === null ? null : redactSecrets(input.crashReport.replace(/\r\n/g, '\n'));
  const facts: CrashUpload = {
    ...(input.launchId === null ? {} : { launch_id: input.launchId }),
    ...(serverId === null ? {} : { server_id: serverId }),
    minecraft: input.minecraft,
    loader: input.loader,
    ...(input.clientMod ? { client_mod: 'on' as const } : {}),
    ...(input.javaMajor === null ? {} : { java_major: input.javaMajor }),
    ...(input.exitCode === null ? {} : { exit_code: input.exitCode }),
    duration_s: Math.round(input.uptimeMs / 1000),
    problem: problemOf(input.cause),
    log_tail: '',
  };
  return fitBody(facts, logTail, crashReport);
}

// JSON doubles every backslash of a Windows path, so the parts shrink until the body fits.
function fitBody(facts: CrashUpload, logTail: string, crashReport: string | null): CrashUpload {
  let limit = UPLOAD_PART_BYTES;
  for (;;) {
    const report: CrashUpload = {
      ...facts,
      log_tail: tailOf(logTail, limit),
      ...(crashReport === null ? {} : { crash_report: headOf(crashReport, limit) }),
    };
    if (Buffer.byteLength(JSON.stringify(report)) <= UPLOAD_BODY_BYTES || limit < 1024) {
      return report;
    }
    limit = Math.floor(limit * 0.75);
  }
}
