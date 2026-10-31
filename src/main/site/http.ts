import { cleanBanReason, type PlayBan } from '@shared/account';
import type { SiteError } from '@shared/site';
import type { FetchLike } from '../launch/json-cache';
import type { CacheEntry, ResponseCache } from './cache';
import { isValidNick } from '@shared/launch';
import { integer, isoTime, isRecord } from './guards';
import { parseErrorBody } from './parse';

export type Headers = Record<string, string>;

export type RevokedCode = 'unauthenticated' | 'install_mismatch';

export interface AuthSource {
  token: () => string | null;
  reject: (token: string, code: RevokedCode) => void;
}

export type RateBucket =
  'catalog' | 'account' | 'skin' | 'cape' | 'telemetry' | 'behavior' | 'crash';
export type PostBucket = Extract<RateBucket, 'telemetry' | 'behavior' | 'crash'>;

export interface SiteHttpOptions {
  base: string;
  fetch: FetchLike;
  headers: () => Promise<Headers>;
  cache: ResponseCache;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
  auth?: AuthSource;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  maxStaleMs?: number;
}

export interface GetOptions<T> {
  parse: (body: unknown) => T | null;
  fallbackTtlMs: number;
  // The term is the launcher's own and the site's Cache-Control does not change it.
  fixedTtl?: boolean;
  auth?: 'optional';
  store?: (body: unknown) => unknown;
  revalidate?: boolean;
}

export type SendMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface SendOptions<T> {
  method: SendMethod;
  token: string | null;
  parse: (body: unknown) => T | null;
  body?: unknown;
  bucket?: RateBucket;
  timeoutMs?: number;
}

export type Sent<T> = { ok: true; value: T } | { ok: false; error: SiteError };

export type Fetched<T> =
  { ok: true; value: T; stale: boolean; fetchedAt: number } | { ok: false; error: SiteError };

export type Posted = { ok: true } | { ok: false; error: SiteError };

export type Downloaded = { ok: true; bytes: Uint8Array } | { ok: false; error: SiteError };

interface RequestInitLite {
  method: SendMethod;
  body?: string;
  accept?: string;
  token?: string;
  bucket?: RateBucket;
  cache?: 'no-cache' | 'no-store';
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAYS_MS = [500, 1500] as const;
const DEFAULT_MAX_STALE_MS = 30 * 24 * 3_600_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_RETRY_AFTER_S = 3600;
const DEFAULT_RETRY_AFTER_S = 60;
const REVOKED_CODES: readonly string[] = ['unauthenticated', 'install_mismatch'];
const LOCAL_LIMIT_CODES: readonly string[] = [
  'vote_paused',
  'too_many_attempts',
  'daily_limit',
  'too_frequent',
  'nick_change_too_soon',
];
// The site counts skin and cape changes itself and the player may press again at once: the
// launcher adds no pause of its own on top of a 429.
const UNPAUSED_BUCKETS: readonly RateBucket[] = ['skin', 'cape'];
const MAX_ERROR_LIMIT = 10_000;

export const DEBUG_SLOW_ENV = 'MCMONITOR_DEBUG_SLOW_MS';

export function debugSlowMs(packaged: boolean, env: NodeJS.ProcessEnv): number {
  const ms = packaged ? NaN : Number(env[DEBUG_SLOW_ENV]);
  return Number.isInteger(ms) && ms > 0 ? ms : 0;
}

export function slowFetch(
  fetch: FetchLike,
  delayMs: number,
  sleep: (ms: number) => Promise<void>,
): FetchLike {
  if (delayMs === 0) {
    return fetch;
  }
  return async (url, init) => {
    const response = await fetch(url, init);
    await sleep(delayMs);
    return response;
  };
}

class TransportError extends Error {
  constructor(readonly error: SiteError) {
    super(error.code);
  }
}

export function maxAgeMs(cacheControl: string | null): number | null {
  if (cacheControl === null) {
    return null;
  }
  const directives = cacheControl
    .toLowerCase()
    .split(',')
    .map((part) => part.trim());
  if (directives.includes('no-store') || directives.includes('no-cache')) {
    return 0;
  }
  const maxAge = directives.find((part) => part.startsWith('max-age='));
  const seconds = maxAge === undefined ? NaN : Number(maxAge.slice('max-age='.length));
  return Number.isInteger(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export function retryAfterSeconds(header: string | null, now: number): number {
  if (header === null) {
    return DEFAULT_RETRY_AFTER_S;
  }
  const trimmed = header.trim();
  const seconds = /^\d{1,7}$/.test(trimmed)
    ? Number(trimmed)
    : Math.ceil((Date.parse(trimmed) - now) / 1000);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_RETRY_AFTER_S;
  }
  return Math.min(MAX_RETRY_AFTER_S, Math.max(1, seconds));
}

function statusError(status: number, siteCode: string | undefined): SiteError {
  const withCode = siteCode === undefined ? {} : { siteCode };
  if (status === 404) {
    return { code: 'not-found', status, ...withCode };
  }
  if (status === 400 || status === 409 || status === 413 || status === 422) {
    return { code: 'invalid-request', status, ...withCode };
  }
  if (status === 401 || status === 403) {
    return { code: 'unauthorized', status, ...withCode };
  }
  return { code: 'server-error', status, ...withCode };
}

function transportError(error: unknown): SiteError {
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError'
    ? { code: 'timeout' }
    : { code: 'offline' };
}

function isRetryable(error: SiteError): boolean {
  return (
    error.code === 'offline' ||
    error.code === 'timeout' ||
    (error.code === 'server-error' && (error.status ?? 500) >= 500)
  );
}

async function readBody(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) {
    throw new TransportError({ code: 'invalid-response', status: response.status });
  }
  const textBody = await response.text();
  if (textBody.length > MAX_BODY_BYTES) {
    throw new TransportError({ code: 'invalid-response', status: response.status });
  }
  if (response.status === 204 || textBody === '') {
    return null;
  }
  try {
    return JSON.parse(textBody) as unknown;
  } catch {
    throw new TransportError({ code: 'invalid-response', status: response.status });
  }
}

export function revokedCode(error: SiteError): RevokedCode | null {
  return error.status === 401 && REVOKED_CODES.includes(error.siteCode ?? '')
    ? (error.siteCode as RevokedCode)
    : null;
}

type ErrorExtras = Pick<
  SiteError,
  'nextVoteAt' | 'reportedAt' | 'limit' | 'resetsAt' | 'nickChangeAt' | 'nick'
>;

function errorExtras(body: unknown): ErrorExtras {
  if (!isRecord(body)) {
    return {};
  }
  const extras: ErrorExtras = {};
  const voteAt = isoTime(body.next_vote_at);
  const reportedAt = isoTime(body.at);
  const limit = integer(body.limit, 1, MAX_ERROR_LIMIT);
  const resetsAt = isoTime(body.resets_at);
  if (voteAt !== null) {
    extras.nextVoteAt = voteAt;
  }
  if (reportedAt !== null) {
    extras.reportedAt = reportedAt;
  }
  if (limit !== null) {
    extras.limit = limit;
  }
  if (resetsAt !== null) {
    extras.resetsAt = resetsAt;
  }
  const nickChangeAt = isoTime(body.nick_change_at);
  if (nickChangeAt !== null) {
    extras.nickChangeAt = nickChangeAt;
  }
  if (typeof body.nick === 'string' && isValidNick(body.nick)) {
    extras.nick = body.nick;
  }
  return extras;
}

function banOf(body: unknown): PlayBan {
  const fields = isRecord(body) ? body : {};
  return {
    reason: cleanBanReason(fields.reason),
    until: isoTime(fields.until),
    forever: fields.until === null,
  };
}

function failed(error: unknown): { ok: false; error: SiteError } {
  return {
    ok: false,
    error: error instanceof TransportError ? error.error : transportError(error),
  };
}

export interface SiteReader {
  get: SiteHttp['get'];
  post: SiteHttp['post'];
}

export class SiteHttp {
  private readonly blockedUntil = new Map<RateBucket, number>();
  private readonly flights = new Map<string, Promise<unknown>>();

  constructor(private readonly options: SiteHttpOptions) {}

  // Answers only from what is already kept, however old, and never touches the network.
  kept(): SiteReader {
    return {
      get: (path, query, get) => this.remembered(path, query, get),
      post: (path, body, token, bucket) => this.post(path, body, token, bucket),
    };
  }

  url(path: string, query?: URLSearchParams): string {
    const search = query === undefined || query.size === 0 ? '' : `?${query.toString()}`;
    return `${this.options.base}${path}${search}`;
  }

  // The same address asked twice at once is one request on the wire.
  get<T>(
    path: string,
    query: URLSearchParams | undefined,
    get: GetOptions<T>,
  ): Promise<Fetched<T>> {
    const token = get.auth === 'optional' ? (this.options.auth?.token() ?? null) : null;
    // A personal answer is not shared: a card asked for before a vote must not be handed to the
    // read that comes after it.
    if (token !== null) {
      return this.fetched(path, query, token, get);
    }
    const key = JSON.stringify([this.url(path, query), get.revalidate === true]);
    const flying = this.flights.get(key);
    if (flying !== undefined) {
      return flying as Promise<Fetched<T>>;
    }
    const flight = this.fetched(path, query, token, get);
    this.flights.set(key, flight);
    const done = (): void => {
      this.flights.delete(key);
    };
    void flight.then(done, done);
    return flight;
  }

  private async remembered<T>(
    path: string,
    query: URLSearchParams | undefined,
    get: GetOptions<T>,
  ): Promise<Fetched<T>> {
    const cached = await this.options.cache.read(this.url(path, query));
    const value = cached === null ? null : get.parse(cached.body);
    const maxStale = this.options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
    const now = this.options.now();
    return cached !== null && value !== null && now - cached.fetchedAt <= maxStale
      ? { ok: true, value, stale: now >= cached.expiresAt, fetchedAt: cached.fetchedAt }
      : { ok: false, error: { code: 'offline' } };
  }

  private async fetched<T>(
    path: string,
    query: URLSearchParams | undefined,
    token: string | null,
    get: GetOptions<T>,
  ): Promise<Fetched<T>> {
    const url = this.url(path, query);
    const now = this.options.now();
    const cached = await this.options.cache.read(url);
    const cachedValue = cached === null ? null : get.parse(cached.body);
    const cacheFirst = token === null && get.revalidate !== true;
    if (cacheFirst && cached !== null && cachedValue !== null && now < cached.expiresAt) {
      return { ok: true, value: cachedValue, stale: false, fetchedAt: cached.fetchedAt };
    }
    const stale = (error: SiteError): Fetched<T> => {
      const usable =
        cached !== null &&
        cachedValue !== null &&
        error.code !== 'not-found' &&
        now - cached.fetchedAt <= (this.options.maxStaleMs ?? DEFAULT_MAX_STALE_MS);
      return usable
        ? { ok: true, value: cachedValue, stale: true, fetchedAt: cached.fetchedAt }
        : { ok: false, error };
    };
    const blocked = this.blocked('catalog');
    if (blocked !== null) {
      return stale(blocked);
    }
    const etag = cachedValue === null || token !== null ? null : (cached?.etag ?? null);
    let response: Response;
    try {
      response = await this.request(
        url,
        {
          method: 'GET',
          ...(token === null ? {} : { token }),
          ...(get.revalidate === true ? { cache: 'no-cache' as const } : {}),
        },
        etag,
        true,
      );
    } catch (error) {
      const siteError = error instanceof TransportError ? error.error : transportError(error);
      if (token !== null && this.rejected(token, siteError)) {
        return this.get(path, query, { parse: get.parse, fallbackTtlMs: get.fallbackTtlMs });
      }
      return stale(siteError);
    }
    return this.accept(response, url, cached, cachedValue, get, stale);
  }

  async send<T>(path: string, options: SendOptions<T>): Promise<Sent<T>> {
    const bucket = options.bucket ?? 'catalog';
    const blocked = this.blocked(bucket);
    if (blocked !== null) {
      return { ok: false, error: blocked };
    }
    const init: RequestInitLite = {
      method: options.method,
      bucket,
      cache: 'no-store',
      ...(options.token === null ? {} : { token: options.token }),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
    try {
      const response = await this.request(this.url(path), init, null, options.method === 'GET');
      const value = options.parse(await readBody(response));
      if (value === null) {
        this.options.log(`site: invalid response ${options.method} ${path}`);
        return { ok: false, error: { code: 'invalid-response', status: response.status } };
      }
      return { ok: true, value };
    } catch (error) {
      const result = failed(error);
      if (options.token !== null) {
        this.rejected(options.token, result.error);
      }
      return result;
    }
  }

  async download(url: string, maxBytes: number): Promise<Downloaded> {
    try {
      const response = await this.request(url, { method: 'GET', accept: 'image/png' }, null, true);
      const length = Number(response.headers.get('content-length') ?? '0');
      if (response.status !== 200 || length > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, error: { code: 'invalid-response', status: response.status } };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength > maxBytes
        ? { ok: false, error: { code: 'invalid-response', status: response.status } }
        : { ok: true, bytes };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof TransportError ? error.error : transportError(error),
      };
    }
  }

  // Behavior packets have their own daily allowance on the site, so their 429 is counted apart
  // and does not stop the packets with launches.
  async post(
    path: string,
    body: unknown,
    token: string | null = null,
    bucket: PostBucket = 'telemetry',
  ): Promise<Posted> {
    const blocked = this.blocked(bucket);
    if (blocked !== null) {
      return { ok: false, error: blocked };
    }
    try {
      const response = await this.request(
        this.url(path),
        {
          method: 'POST',
          body: JSON.stringify(body),
          bucket,
          ...(token === null ? {} : { token }),
        },
        null,
        false,
      );
      await response.body?.cancel().catch(() => undefined);
      return { ok: true };
    } catch (error) {
      const result = failed(error);
      // Telemetry accepts a foreign token as a guest; a 401 here comes from somewhere else, so the
      // packet goes once more without the token instead of looping, and the session stays.
      if (token !== null && result.error.status === 401) {
        return this.post(path, body, null, bucket);
      }
      return result;
    }
  }

  private blocked(bucket: RateBucket): SiteError | null {
    const until = this.blockedUntil.get(bucket) ?? 0;
    const now = this.options.now();
    return now < until
      ? { code: 'rate-limited', retryAfterS: Math.ceil((until - now) / 1000) }
      : null;
  }

  private rejected(token: string, error: SiteError): boolean {
    const code = revokedCode(error);
    if (code === null) {
      return false;
    }
    this.options.auth?.reject(token, code);
    return true;
  }

  private async accept<T>(
    response: Response,
    url: string,
    cached: CacheEntry | null,
    cachedValue: T | null,
    get: GetOptions<T>,
    stale: (error: SiteError) => Fetched<T>,
  ): Promise<Fetched<T>> {
    const now = this.options.now();
    const ttl =
      get.fixedTtl === true
        ? get.fallbackTtlMs
        : (maxAgeMs(response.headers.get('cache-control')) ?? get.fallbackTtlMs);
    if (response.status === 304 && cached !== null && cachedValue !== null) {
      await response.body?.cancel().catch(() => undefined);
      await this.options.cache.write({ ...cached, fetchedAt: now, expiresAt: now + ttl });
      return { ok: true, value: cachedValue, stale: false, fetchedAt: now };
    }
    let body: unknown;
    try {
      body = await readBody(response);
    } catch (error) {
      return stale(error instanceof TransportError ? error.error : transportError(error));
    }
    const value = get.parse(body);
    if (value === null) {
      this.options.log(`site: invalid response ${url}`);
      return stale({ code: 'invalid-response', status: response.status });
    }
    await this.options.cache.write({
      key: url,
      etag: get.auth === undefined ? response.headers.get('etag') : null,
      fetchedAt: now,
      expiresAt: now + ttl,
      body: get.store === undefined ? body : get.store(body),
    });
    return { ok: true, value, stale: false, fetchedAt: now };
  }

  private async request(
    url: string,
    init: RequestInitLite,
    etag: string | null,
    retry: boolean,
  ): Promise<Response> {
    const delays = retry ? (this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS) : [];
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.once(url, init, etag);
      } catch (error) {
        const siteError = error instanceof TransportError ? error.error : transportError(error);
        const delay = delays[attempt];
        if (delay === undefined || !isRetryable(siteError)) {
          throw new TransportError(siteError);
        }
        this.options.log(`site: retry ${init.method} ${url} after ${siteError.code}`);
        await this.options.sleep(delay);
      }
    }
  }

  private async once(url: string, init: RequestInitLite, etag: string | null): Promise<Response> {
    const headers: Headers = {
      Accept: init.accept ?? 'application/json',
      ...(await this.options.headers()),
      ...(etag === null ? {} : { 'If-None-Match': etag }),
      ...(init.token === undefined ? {} : { Authorization: `Bearer ${init.token}` }),
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    };
    const response = await this.options.fetch(url, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.cache === undefined ? {} : { cache: init.cache }),
      redirect: 'error',
      signal: AbortSignal.timeout(init.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (response.ok || response.status === 304) {
      return response;
    }
    throw new TransportError(await this.failure(response, url, init.bucket ?? 'catalog'));
  }

  private async failure(response: Response, url: string, bucket: RateBucket): Promise<SiteError> {
    const body = await readBody(response).catch(() => null);
    const parsed = parseErrorBody(body);
    this.options.log(
      `site: HTTP ${String(response.status)} ${url} ${parsed?.code ?? ''} ${parsed?.message ?? ''}`.trim(),
    );
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response.headers.get('retry-after'), this.options.now());
      const paused = !LOCAL_LIMIT_CODES.includes(parsed?.code ?? '');
      if (paused && !UNPAUSED_BUCKETS.includes(bucket)) {
        this.blockedUntil.set(bucket, this.options.now() + seconds * 1000);
      }
      return {
        code: 'rate-limited',
        status: 429,
        retryAfterS: seconds,
        ...(parsed === null ? {} : { siteCode: parsed.code }),
        ...errorExtras(body),
      };
    }
    return {
      ...statusError(response.status, parsed?.code),
      ...errorExtras(body),
      ...(parsed?.code === 'banned' ? { ban: banOf(body) } : {}),
      ...(parsed?.code === 'invalid_skin' && parsed.message !== ''
        ? { message: parsed.message }
        : {}),
    };
  }
}
