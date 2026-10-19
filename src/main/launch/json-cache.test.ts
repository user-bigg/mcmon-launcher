import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toLaunchError } from './errors';
import { cachedJson, createFetchJson, writeJsonAtomic, type FetchJson } from './json-cache';

const HOUR = 60 * 60 * 1000;
const url = 'https://launchermeta.mojang.com/v1/products/java-runtime/x/all.json';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcmonitor-cache-'));
  file = join(dir, 'cache', 'all.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function options(fetch: FetchJson, now = Date.now()): Parameters<typeof cachedJson>[0] {
  return {
    file,
    url,
    maxAgeMs: 24 * HOUR,
    fetch,
    signal: new AbortController().signal,
    now,
    accept: (data) => typeof data === 'object' && data !== null && 'ok' in data,
  };
}

const offline: FetchJson = () =>
  Promise.reject(Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' }));

describe('cachedJson', () => {
  it('a fresh cache is returned without hitting the network', async () => {
    await writeJsonAtomic(file, { ok: 1 });
    const fetch = vi.fn<FetchJson>();
    expect(await cachedJson(options(fetch))).toEqual({ ok: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a stale cache is refreshed from the network and overwritten', async () => {
    await writeJsonAtomic(file, { ok: 1 });
    const old = new Date(Date.now() - 48 * HOUR);
    await utimes(file, old, old);
    expect(await cachedJson(options(() => Promise.resolve({ ok: 2 })))).toEqual({ ok: 2 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ok: 2 });
  });

  it('without network, a stale cache is better than nothing', async () => {
    await writeJsonAtomic(file, { ok: 1 });
    const old = new Date(Date.now() - 48 * HOUR);
    await utimes(file, old, old);
    expect(await cachedJson(options(offline))).toEqual({ ok: 1 });
  });

  it('no network and no cache — a network error', async () => {
    await expect(cachedJson(options(offline))).rejects.toThrow('fetch failed');
  });

  it('cancellation propagates even when a stale cache exists', async () => {
    await writeJsonAtomic(file, { ok: 1 });
    const old = new Date(Date.now() - 48 * HOUR);
    await utimes(file, old, old);
    const controller = new AbortController();
    controller.abort();
    const aborted: FetchJson = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    await expect(cachedJson({ ...options(aborted), signal: controller.signal })).rejects.toThrow(
      'aborted',
    );
  });

  it('a response that fails validation is not written; the previous cache remains', async () => {
    await writeJsonAtomic(file, { ok: 1 });
    const old = new Date(Date.now() - 48 * HOUR);
    await utimes(file, old, old);
    expect(await cachedJson(options(() => Promise.resolve({ broken: true })))).toEqual({ ok: 1 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ok: 1 });
  });

  it('a fresh but invalid cache is reread from the network', async () => {
    await writeJsonAtomic(file, { broken: true });
    expect(await cachedJson(options(() => Promise.resolve({ ok: 2 })))).toEqual({ ok: 2 });
  });

  it('a cache timestamped more than a minute in the future is not considered fresh', async () => {
    await writeJsonAtomic(file, { ok: 1 });
    const future = new Date(Date.now() + 2 * HOUR);
    await utimes(file, future, future);
    expect(await cachedJson(options(() => Promise.resolve({ ok: 2 })))).toEqual({ ok: 2 });
  });

  it('a failed cache write does not fail the fetch', async () => {
    const blocked = { ...options(() => Promise.resolve({ ok: 3 })), file: join(dir, 'x', 'y') };
    await writeJsonAtomic(join(dir, 'x'), {});
    expect(await cachedJson(blocked)).toEqual({ ok: 3 });
  });
});

describe('createFetchJson', () => {
  it('an HTTP error reports reason http, a Chromium error reports tls, both include the address', async () => {
    const http = createFetchJson(() => Promise.resolve(new Response('', { status: 503 })));
    const error = await http(url, new AbortController().signal).catch((caught: unknown) => caught);
    expect(toLaunchError(error)).toEqual({ code: 'network', url, reason: 'http' });

    const chromium = createFetchJson(() =>
      Promise.reject(new Error('net::ERR_CERT_AUTHORITY_INVALID')),
    );
    const tls = await chromium(url, new AbortController().signal).catch(
      (caught: unknown) => caught,
    );
    expect(toLaunchError(tls)).toEqual({ code: 'network', url, reason: 'tls' });
  });

  it('parses the response JSON', async () => {
    const fetch = createFetchJson(() => Promise.resolve(Response.json({ ok: true })));
    expect(await fetch(url, new AbortController().signal)).toEqual({ ok: true });
  });
});
