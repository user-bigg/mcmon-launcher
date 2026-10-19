import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { bestEffort, withFsRetry } from './fs-retry';

export type FetchJson = (url: string, signal: AbortSignal) => Promise<unknown>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 20_000;
const CLOCK_SKEW_MS = 60 * 1000;

function withUrl(error: unknown, url: string): unknown {
  if (typeof error === 'object' && error !== null && !('downloadUrl' in error)) {
    return Object.assign(error, { downloadUrl: url });
  }
  return error;
}

export function createFetchJson(fetchImpl: FetchLike): FetchJson {
  return async (url, signal) => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw withUrl(error, url);
    }
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${String(response.status)}`), {
        statusCode: response.status,
        downloadUrl: url,
      });
    }
    return response.json();
  };
}

export const fetchJson: FetchJson = createFetchJson((url, init) => fetch(url, init));

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export interface WriteOptions {
  mode?: number;
}

export async function writeFileAtomic(
  file: string,
  data: string | Buffer,
  options: WriteOptions = {},
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await withFsRetry(() => writeFile(temporary, data, options));
    await withFsRetry(() => rename(temporary, file));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function writeJsonAtomic(
  file: string,
  data: unknown,
  options: WriteOptions = {},
): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(data), options);
}

export function writeJsonBestEffort(file: string, data: unknown): Promise<boolean> {
  return bestEffort(() => writeJsonAtomic(file, data));
}

export async function ageMs(file: string, now: number): Promise<number | null> {
  try {
    return now - (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

export interface CachedJsonOptions {
  file: string;
  url: string;
  maxAgeMs: number;
  fetch: FetchJson;
  signal: AbortSignal;
  now: number;
  accept: (data: unknown) => boolean;
}

export async function cachedJson(options: CachedJsonOptions): Promise<unknown> {
  const cached = await readJson(options.file);
  const age = await ageMs(options.file, options.now);
  const usable = cached !== undefined && options.accept(cached);
  if (usable && age !== null && age >= -CLOCK_SKEW_MS && age < options.maxAgeMs) {
    return cached;
  }
  try {
    const fresh = await options.fetch(options.url, options.signal);
    if (options.accept(fresh)) {
      await writeJsonBestEffort(options.file, fresh);
      return fresh;
    }
  } catch (error) {
    if (!usable || options.signal.aborted) {
      throw error;
    }
  }
  return usable ? cached : undefined;
}
