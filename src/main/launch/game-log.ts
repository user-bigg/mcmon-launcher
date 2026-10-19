import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { scrubBytes } from './secrets';
import { completeLinesAfter, decodeLines } from './text-decode';

const TAIL_BYTES = 512 * 1024;
export const LOG_KEEP_ROTATED = 4;
const DISPLAY_TIME_ZONE = 'Europe/Moscow';

const EVENT = /<log4j:Event\b([^>]*)>([\s\S]*?)<\/log4j:Event>/g;
const ATTRIBUTE = /\b(\w+)="([^"]*)"/g;
const CDATA_MESSAGE = /<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>/;
const CDATA_THROWABLE = /<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Throwable>/;
const CONNECTING = /Connecting to (\S+?), (\d{1,5})\b/;
const CHAT_MESSAGE = /^(?:\[System\] )?\[CHAT\]/;

export interface LogReadOptions {
  dropChat?: boolean;
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function attributes(raw: string): Map<string, string> {
  return new Map(Array.from(raw.matchAll(ATTRIBUTE), (match) => [match[1] ?? '', match[2] ?? '']));
}

export function isChatMessage(message: string): boolean {
  return CHAT_MESSAGE.test(message.trimStart());
}

function formatEvent(rawAttributes: string, body: string, options: LogReadOptions): string[] {
  const values = attributes(rawAttributes);
  const timestamp = Number(values.get('timestamp') ?? Number.NaN);
  const time = Number.isFinite(timestamp) ? timeFormat.format(new Date(timestamp)) : '--:--:--';
  const thread = values.get('thread') ?? '';
  const level = values.get('level') ?? '';
  const message = CDATA_MESSAGE.exec(body)?.[1] ?? '';
  if (options.dropChat === true && isChatMessage(message)) {
    return [];
  }
  const throwable = CDATA_THROWABLE.exec(body)?.[1];
  const lines = `[${time}] [${thread}/${level}]: ${message}`.split(/\r?\n/);
  if (throwable !== undefined) {
    lines.push(...throwable.trimEnd().split(/\r?\n/));
  }
  return lines;
}

function plainLines(chunk: string, options: LogReadOptions): string[] {
  return chunk
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => options.dropChat !== true || !line.includes('[CHAT]'));
}

// Chat is written by the server and other players: it stays out of crash analysis and the
// report, otherwise someone else's nickname gets into the report and a
// 'java.lang.OutOfMemoryError' message in chat becomes the crash cause.
export function gameLogLines(raw: string, options: LogReadOptions = {}): string[] {
  const lines: string[] = [];
  let cursor = 0;
  for (const match of raw.matchAll(EVENT)) {
    lines.push(...plainLines(raw.slice(cursor, match.index), options));
    lines.push(...formatEvent(match[1] ?? '', match[2] ?? '', options));
    cursor = match.index + match[0].length;
  }
  const rest = raw.slice(cursor);
  const unfinished = rest.indexOf('<log4j:Event');
  lines.push(...plainLines(unfinished === -1 ? rest : rest.slice(0, unfinished), options));
  return lines;
}

export function connectingTarget(text: string): { host: string; port: number } | null {
  const match = CONNECTING.exec(text);
  if (match?.[1] === undefined || match[2] === undefined) {
    return null;
  }
  const port = Number(match[2]);
  return port >= 1 && port <= 65535 ? { host: match[1], port } : null;
}

export async function readLogTail(
  file: string,
  lines: number,
  since = 0,
  options: LogReadOptions = {},
): Promise<string[]> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch {
    return [];
  }
  try {
    const { size } = await handle.stat();
    const from = since > size ? 0 : since;
    const length = Math.min(size - from, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const bytes = length < size - from ? completeLinesAfter(buffer) : buffer;
    return gameLogLines(decodeLines(bytes), options).slice(-lines);
  } finally {
    await handle.close();
  }
}

export function rotatedLogFile(file: string, index: number): string {
  return `${file}.${String(index)}`;
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

// Each launch writes its own file from the start (crash analysis reads the launcher note at
// its head), and previous launches are rotated to .1–.4.
export async function rotateLog(file: string): Promise<void> {
  if ((await sizeOf(file)) === 0) {
    return;
  }
  await rm(rotatedLogFile(file, LOG_KEEP_ROTATED), { force: true });
  for (let index = LOG_KEEP_ROTATED - 1; index >= 1; index -= 1) {
    await rename(rotatedLogFile(file, index), rotatedLogFile(file, index + 1)).catch(
      () => undefined,
    );
  }
  await rename(file, rotatedLogFile(file, 1));
}

export class GameLogWriter {
  private broken = false;
  private ended = false;
  private readonly secrets: string[] = [];

  private constructor(
    private readonly stream: WriteStream,
    readonly file: string,
    readonly startOffset: number,
  ) {
    stream.on('error', () => {
      this.broken = true;
    });
  }

  static async create(file: string): Promise<GameLogWriter> {
    await mkdir(dirname(file), { recursive: true });
    await rotateLog(file).catch(() => undefined);
    const startOffset = await sizeOf(file);
    return new GameLogWriter(createWriteStream(file, { flags: 'a' }), file, startOffset);
  }

  get writable(): boolean {
    return !this.broken && !this.ended;
  }

  // stdout and stderr go to one file: write them as whole lines so that a stderr line does
  // not split a log4j XML event from stdout.
  attach(source: Readable | null): void {
    if (source === null) {
      return;
    }
    let pending: Buffer = Buffer.alloc(0);
    source.on('data', (chunk: Buffer) => {
      const joined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      const lastBreak = joined.lastIndexOf(0x0a);
      if (lastBreak === -1) {
        pending = joined;
        return;
      }
      this.write(joined.subarray(0, lastBreak + 1));
      pending = joined.subarray(lastBreak + 1);
    });
    source.on('end', () => {
      if (pending.length > 0) {
        this.write(pending);
        pending = Buffer.alloc(0);
      }
    });
  }

  hide(secret: string): void {
    this.secrets.push(secret);
  }

  note(line: string): void {
    this.write(`[MC Monitor] ${line}\n`);
  }

  async close(): Promise<void> {
    if (this.ended) {
      return;
    }
    this.ended = true;
    if (this.stream.closed || this.stream.destroyed) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.stream.once('close', resolve);
      this.stream.end();
    });
  }

  private write(chunk: Buffer | string): void {
    if (this.writable) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      this.stream.write(scrubBytes(bytes, this.secrets));
    }
  }
}
