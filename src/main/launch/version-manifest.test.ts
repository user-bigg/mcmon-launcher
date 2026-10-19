import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LaunchFailure } from './errors';
import { writeJsonAtomic, type FetchJson } from './json-cache';
import {
  findVersion,
  parseVersionManifest,
  VERSION_MANIFEST_URL,
  type VersionManifestSource,
} from './version-manifest';

const HOUR = 60 * 60 * 1000;

function manifest(...ids: string[]): unknown {
  return {
    latest: { release: ids[0], snapshot: ids[0] },
    versions: ids.map((id) => ({
      id,
      type: 'release',
      url: `https://piston-meta.mojang.com/v1/packages/x/${id}.json`,
      sha1: 'a'.repeat(40),
      releaseTime: '2026-09-01T00:00:00+00:00',
    })),
  };
}

const NOW = Date.parse('2026-10-03T12:00:00Z');

let dir: string;
let cacheFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcmonitor-manifest-'));
  cacheFile = join(dir, 'version_manifest_v2.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function source(fetch: FetchJson): VersionManifestSource {
  return { cacheFile, fetch, signal: new AbortController().signal, now: NOW };
}

async function age(hours: number): Promise<void> {
  const time = new Date(NOW - hours * HOUR);
  await utimes(cacheFile, time, time);
}

async function writeCache(value: unknown): Promise<void> {
  await writeJsonAtomic(cacheFile, value);
  await age(1);
}

const offline: FetchJson = () =>
  Promise.reject(Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' }));

describe('findVersion', () => {
  it('a cache under a day old answers without the network', async () => {
    await writeCache(manifest('26.3'));
    const fetch = vi.fn<FetchJson>();
    expect((await findVersion('26.3', source(fetch))).id).toBe('26.3');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a cache over a day old is refreshed from the network', async () => {
    await writeCache(manifest('26.3'));
    await age(25);
    const fetch = vi.fn<FetchJson>(() => Promise.resolve(manifest('26.4', '26.3')));
    expect((await findVersion('26.3', source(fetch))).id).toBe('26.3');
    expect(fetch).toHaveBeenCalledWith(VERSION_MANIFEST_URL, expect.anything());
  });

  it('without network access, the stale cache is used if it has the version', async () => {
    await writeCache(manifest('26.3'));
    await age(72);
    expect((await findVersion('26.3', source(offline))).id).toBe('26.3');
    await expect(findVersion('26.4', source(offline))).rejects.toThrow('fetch failed');
  });

  it('cancellation propagates instead of being swallowed by the stale cache', async () => {
    await writeCache(manifest('26.3'));
    await age(72);
    const controller = new AbortController();
    controller.abort();
    const aborted: FetchJson = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    await expect(
      findVersion('26.3', { ...source(aborted), signal: controller.signal }),
    ).rejects.toThrow('aborted');
  });

  it('a new version missing from the cache triggers a network request; an unknown one is version-not-found', async () => {
    await writeCache(manifest('26.3'));
    const fetch: FetchJson = () => Promise.resolve(manifest('26.4', '26.3'));
    expect((await findVersion('26.4', source(fetch))).id).toBe('26.4');
    await expect(findVersion('99.9', source(fetch))).rejects.toBeInstanceOf(LaunchFailure);
  });

  it('refresh ignores a fresh cache', async () => {
    await writeCache(manifest('26.3'));
    const fetch = vi.fn<FetchJson>(() => Promise.resolve(manifest('26.3')));
    await findVersion('26.3', source(fetch), { refresh: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('parseVersionManifest', () => {
  it('drops entries without https or sha1', () => {
    const parsed = parseVersionManifest({
      latest: { release: '26.3', snapshot: '26.3' },
      versions: [
        {
          id: 'bad',
          type: 'release',
          url: 'http://x/y.json',
          sha1: 'a'.repeat(40),
          releaseTime: '',
        },
        ...((manifest('26.3') as { versions: unknown[] }).versions as object[]),
      ],
    });
    expect(parsed?.versions.map((entry) => entry.id)).toEqual(['26.3']);
    expect(parseVersionManifest({ latest: {}, versions: [] })).toBeNull();
  });
});
