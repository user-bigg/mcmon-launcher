import type { LoaderInstallStage } from '@shared/launch';
import { SITE_URL } from '@shared/links';
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

// Some networks cannot reach the Fabric hosts; the site keeps a copy of them under these paths.
const MIRRORS: ReadonlyMap<string, string> = new Map([
  ['meta.fabricmc.net', `${SITE_URL}/mirror/fabric-meta/`],
  ['maven.fabricmc.net', `${SITE_URL}/mirror/fabric-maven/`],
]);

export function mirrorOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const mirror = MIRRORS.get(parsed.hostname);
  return parsed.protocol === 'https:' && mirror !== undefined && parsed.search === ''
    ? `${mirror}${parsed.pathname.slice(1)}`
    : null;
}

// The site decodes the path before it routes it, so an encoded separator or dot could climb out
// of the mirror prefix there.
const ENCODED_STEP = /%2f|%5c|%2e/i;

function isMirror(parsed: URL): boolean {
  const href = `${parsed.origin}${parsed.pathname}`;
  return (
    parsed.search === '' &&
    !ENCODED_STEP.test(parsed.pathname) &&
    !parsed.pathname.includes('//') &&
    !parsed.pathname.split('/').includes('..') &&
    [...MIRRORS.values()].some((mirror) => href.startsWith(mirror))
  );
}

// A host that did not answer once in this session is asked after its copy, so every later file
// does not wait for the same timeout again.
const unreachable = new Set<string>();

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function sourcesOf(url: string): string[] {
  const mirror = mirrorOf(url);
  if (mirror === null) {
    return [url];
  }
  return unreachable.has(hostnameOf(url)) ? [mirror, url] : [url, mirror];
}

export function forgetUnreachableHosts(): void {
  unreachable.clear();
}

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

// Fabric Meta answers 400 for a version it does not have, so that answer is final; a block on
// the way to the host shows as a refusal, a rate limit or a server error and goes to the copy.
const BLOCKED_STATUSES = new Set([403, 429, 451]);

function shouldTryOther(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return false;
  }
  if (error instanceof LoaderStageError) {
    return (error as { redirected?: boolean }).redirected === true;
  }
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status !== 'number' || status >= 500 || BLOCKED_STATUSES.has(status);
}

// When both fail, the player hears what the original host said: the copy may lack a route, and
// its 404 must not turn into 'no such Fabric version'.
export function createFetchText(fetchImpl: FetchLike): FetchText {
  const once = fetchOnce(fetchImpl);
  return async (url, signal) => {
    const [first, second] = sourcesOf(url);
    if (first === undefined || second === undefined) {
      return once(url, signal);
    }
    try {
      return await once(first, signal);
    } catch (error) {
      const viaCopy = first !== url;
      if (viaCopy ? signal.aborted : !shouldTryOther(error, signal)) {
        throw error;
      }
      if (!viaCopy) {
        unreachable.add(hostnameOf(url));
      }
      try {
        return await once(second, signal);
      } catch (secondError) {
        throw signal.aborted || second === url ? secondError : error;
      }
    }
  };
}

function fetchOnce(fetchImpl: FetchLike): FetchText {
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
      throw Object.assign(
        new LoaderStageError('library', `redirect to untrusted host ${hostOf(finalUrl)}`),
        { redirected: true },
      );
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
    return parsed.protocol === 'https:' && (TRUSTED_HOSTS.has(parsed.hostname) || isMirror(parsed));
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
