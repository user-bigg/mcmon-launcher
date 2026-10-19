import type { LoaderInstallStage } from '@shared/launch';
import { failure } from '../errors';
import type { FetchLike } from '../json-cache';

export type FetchText = (url: string, signal: AbortSignal) => Promise<string>;

const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const SHA1 = /^[0-9a-f]{40}$/;

export const FABRIC_META = 'https://meta.fabricmc.net';

const TRUSTED_HOSTS = new Set([
  'meta.fabricmc.net',
  'maven.fabricmc.net',
  'libraries.minecraft.net',
]);

export class LoaderStageError extends Error {
  constructor(
    readonly stage: LoaderInstallStage,
    readonly detail: string,
  ) {
    super(`Loader ${stage} failed: ${detail}`);
    this.name = 'LoaderStageError';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}

function httpError(status: number, url: string): Error {
  return Object.assign(new Error(`HTTP ${String(status)}`), {
    statusCode: status,
    downloadUrl: url,
  });
}

async function limitedText(response: Response, url: string): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_TEXT_BYTES) {
    throw new LoaderStageError('manifest', `response too large: ${url}`);
  }
  const body = response.body as AsyncIterable<Uint8Array> | null;
  if (body === null) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > MAX_TEXT_BYTES) {
      throw new LoaderStageError('manifest', `response too large: ${url}`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createFetchText(fetchImpl: FetchLike): FetchText {
  return async (url, signal) => {
    requireTrustedSource(url);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
    } catch (error) {
      throw typeof error === 'object' && error !== null
        ? Object.assign(error, { downloadUrl: url })
        : error;
    }
    const finalUrl = response.url.length > 0 ? response.url : url;
    if (!isTrustedSource(finalUrl)) {
      await response.body?.cancel().catch(() => undefined);
      throw new LoaderStageError('library', `redirect to untrusted host ${hostOf(finalUrl)}`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw httpError(response.status, url);
    }
    return limitedText(response, url);
  };
}

export const fetchText: FetchText = createFetchText((url, init) => fetch(url, init));

export function isTrustedSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && TRUSTED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function requireTrustedSource(url: string): string {
  if (!isTrustedSource(url)) {
    throw new LoaderStageError('library', `untrusted source ${hostOf(url)}`);
  }
  return url;
}

// Fabric Meta answers 400, not 404, when it does not have that loader or game version.
export function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const status = (error as { statusCode?: unknown }).statusCode;
  return status === 404 || status === 400;
}

export function parseSha1File(text: string): string | null {
  const digest = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return SHA1.test(digest) ? digest : null;
}

export async function fetchMavenSha1(
  url: string,
  fetch: FetchText,
  signal: AbortSignal,
): Promise<string> {
  const digest = parseSha1File(await fetch(`${requireTrustedSource(url)}.sha1`, signal));
  if (digest === null) {
    throw failure({ code: 'checksum-mismatch', file: url });
  }
  return digest;
}

export function segment(value: string): string {
  return encodeURIComponent(value);
}
