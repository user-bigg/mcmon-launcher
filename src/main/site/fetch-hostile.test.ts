import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iconId, isAllowedAsset, MAX_IMAGE_BYTES, SiteAssets } from './assets';
import { MemoryCache } from './cache';
import { SiteHttp, type Downloaded, type Headers } from './http';
import type { ParsedScene } from './parse';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const HOSTS = new Set(['mc-mon.ru', 'cdn.mc-mon.ru']);

function http(reply: () => Response): {
  site: SiteHttp;
  fetch: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;
} {
  const fetch = vi.fn((): Promise<Response> => Promise.resolve(reply()));
  const site = new SiteHttp({
    base: 'https://mc-mon.ru/api/launcher/v1',
    fetch,
    headers: (): Promise<Headers> => Promise.resolve({}),
    cache: new MemoryCache(),
    now: (): number => 0,
    sleep: (): Promise<void> => Promise.resolve(),
    log: vi.fn(),
    retryDelaysMs: [],
  });
  return { site, fetch };
}

describe('images from the site: only own hosts', () => {
  it('host look-alikes, ports, IPs, and IDN tricks are rejected', () => {
    for (const url of [
      'https://mc-mon.ru@evil.example/a.png',
      'https://evil.example#@mc-mon.ru/a.png',
      'https://evil.example/?https://mc-mon.ru/a.png',
      'https://mc-mon.ru.evil.example/a.png',
      'https://mc-mon.ru:8443/a.png',
      'https://mс-mon.ru/a.png',
      'https://127.0.0.1/a.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.png',
      'https://localhost/a.png',
      'file:///C:/Windows/win.ini',
      'http://mc-mon.ru/a.png',
      '//mc-mon.ru/a.png',
    ]) {
      expect({ url, allowed: isAllowedAsset(url, HOSTS) }).toEqual({ url, allowed: false });
    }
    expect(isAllowedAsset('https://MC-MON.RU/a.png', HOSTS)).toBe(true);
  });

  describe('server icon from a foreign host', () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'mcmon-hostile-'));
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('is not downloaded and not written to disk', async () => {
      const download = vi.fn((): Promise<Downloaded> => Promise.resolve({ ok: true, bytes: PNG }));
      const assets = new SiteAssets({
        root,
        appOrigin: 'app://launcher',
        download,
        scenes: (): Promise<ParsedScene[] | null> => Promise.resolve([]),
        allowedHosts: (): Promise<ReadonlySet<string>> => Promise.resolve(HOSTS),
        log: vi.fn(),
      });
      const remote = 'https://169.254.169.254/latest/meta-data/icon.png';
      expect(assets.localIcon(remote)).toBe(`app://launcher/cache/icons/${iconId(remote)}.png`);
      expect(await assets.resolve({ kind: 'icon', id: iconId(remote) })).toBeNull();
      expect(download).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual([]);
    });
  });
});

describe('image downloads: redirects and size', () => {
  it('the redirect is not followed, fetch gets redirect: error', async () => {
    const { site, fetch } = http(
      () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }),
    );
    const result = await site.download('https://mc-mon.ru/a.png', MAX_IMAGE_BYTES);
    expect(result.ok).toBe(false);
    expect(fetch.mock.calls[0]?.[1].redirect).toBe('error');
  });

  it('a declared or actual size over the limit is rejected', async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    const declared = http(
      () => new Response(PNG, { headers: { 'Content-Length': String(MAX_IMAGE_BYTES + 1) } }),
    );
    expect((await declared.site.download('https://mc-mon.ru/a.png', MAX_IMAGE_BYTES)).ok).toBe(
      false,
    );
    const chunked = http(
      () =>
        new Response(
          new ReadableStream({
            start(controller): void {
              controller.enqueue(big);
              controller.close();
            },
          }),
        ),
    );
    expect((await chunked.site.download('https://mc-mon.ru/a.png', MAX_IMAGE_BYTES)).ok).toBe(
      false,
    );
  });
});
