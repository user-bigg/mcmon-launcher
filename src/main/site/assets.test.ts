import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import scenes from './fixtures/scenes.json';
import type { Downloaded } from './http';
import { assetHosts, iconId, isAllowedAsset, isPng, SiteAssets } from './assets';
import { parseScenes, type ParsedScene } from './parse';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const API = 'https://mc-mon.ru/api/launcher/v1';

describe('hosts for images', () => {
  it('only https and only the API and site link hosts', () => {
    const hosts = assetHosts(API, ['https://cdn.mc-mon.ru/x', 'http://plain.example/']);
    expect([...hosts]).toEqual(['mc-mon.ru', 'cdn.mc-mon.ru']);
    expect(isAllowedAsset('https://mc-mon.ru/images/landscapes/taiga-day/sky.png', hosts)).toBe(
      true,
    );
    expect(isAllowedAsset('https://cdn.mc-mon.ru/a.png', hosts)).toBe(true);
    expect(isAllowedAsset('https://evil.example/a.png', hosts)).toBe(false);
    expect(isAllowedAsset('http://mc-mon.ru/a.png', hosts)).toBe(false);
    expect(isAllowedAsset('https://user:pass@mc-mon.ru/a.png', hosts)).toBe(false);
    expect(isAllowedAsset('https://mc-mon.ru.evil.example/a.png', hosts)).toBe(false);
    expect(isAllowedAsset('не url', hosts)).toBe(false);
  });

  it('PNG is recognized by signature, not by extension', () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(new TextEncoder().encode('<html>'))).toBe(false);
  });
});

describe('layer cache', () => {
  let root: string;
  let manifest: ParsedScene[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mcmon-assets-'));
    manifest = parseScenes(scenes, vi.fn()) ?? [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  interface Built {
    assets: SiteAssets;
    download: Mock<(url: string) => Promise<Downloaded>>;
  }

  function assets(download: (url: string) => Promise<Downloaded>, hosts = ['mc-mon.ru']): Built {
    const fn = vi.fn(download);
    const created = new SiteAssets({
      root,
      appOrigin: 'app://launcher',
      download: fn,
      scenes: (): Promise<ParsedScene[]> => Promise.resolve(manifest),
      allowedHosts: (): Promise<Set<string>> => Promise.resolve(new Set(hosts)),
      log: vi.fn(),
    });
    return { assets: created, download: fn };
  }

  it('downloads scene layers into landscapes/<scene>-<time>/<layer>.png and returns app:// addresses', async () => {
    const { assets: site, download } = assets(() => Promise.resolve({ ok: true, bytes: PNG }));
    const result = await site.ensureScene('taiga', 'day');
    expect(result.ok).toBe(true);
    const layers = result.ok ? result.value.layers : {};
    expect(layers.sky).toBe('app://launcher/cache/landscapes/taiga-day/sky.png');
    expect(result.ok ? result.value.thumb : null).toBe(
      'app://launcher/cache/landscapes/thumbs/taiga-day.png',
    );
    const file = join(root, 'landscapes', 'taiga-day', 'sky.png');
    expect(new Uint8Array(await readFile(file))).toEqual(PNG);
    const calls = download.mock.calls.length;
    await site.ensureScene('taiga', 'day');
    expect(download.mock.calls.length).toBe(calls);
  });

  it('a new layer URL in the manifest triggers a re-download', async () => {
    const { assets: site, download } = assets(() => Promise.resolve({ ok: true, bytes: PNG }));
    await site.resolve({ kind: 'layer', scene: 'taiga', time: 'day', layer: 'sky' });
    const taiga = manifest.find((item) => item.scene.key === 'taiga');
    if (taiga !== undefined) {
      taiga.sources.layers.day.sky = 'https://mc-mon.ru/images/landscapes/taiga-day/sky.new.png';
    }
    await site.resolve({ kind: 'layer', scene: 'taiga', time: 'day', layer: 'sky' });
    expect(download.mock.calls.map(([url]) => url).at(-1)).toMatch(/sky\.new\.png$/);
  });

  it('a foreign host is not downloaded, the layer stays as the sky color', async () => {
    const { assets: site, download } = assets(
      () => Promise.resolve({ ok: true, bytes: PNG }),
      ['cdn.other.example'],
    );
    const result = await site.ensureScene('taiga', 'day');
    expect(download).not.toHaveBeenCalled();
    expect(result.ok ? result.value.layers : null).toEqual({});
  });

  it('a non-PNG file is not written', async () => {
    const { assets: site } = assets(() =>
      Promise.resolve({ ok: true, bytes: new TextEncoder().encode('<html>') }),
    );
    expect(await site.resolve({ kind: 'layer', scene: 'taiga', time: 'day', layer: 'sky' })).toBe(
      null,
    );
  });

  it('without network access, returns what was already downloaded', async () => {
    let online = true;
    const { assets: site } = assets(() =>
      Promise.resolve(
        online ? { ok: true, bytes: PNG } : { ok: false, error: { code: 'offline' } },
      ),
    );
    await site.ensureScene('taiga', 'day');
    online = false;
    manifest = [];
    expect(
      await site.resolve({ kind: 'layer', scene: 'taiga', time: 'day', layer: 'sky' }),
    ).toMatch(/taiga-day[\\/]sky\.png$/);
  });

  it('an unknown scene is not-found, concurrent requests for a layer download it only once', async () => {
    const { assets: site, download } = assets(() => Promise.resolve({ ok: true, bytes: PNG }));
    expect(await site.ensureScene('nope', 'day')).toEqual({
      ok: false,
      error: { code: 'not-found' },
    });
    const request = { kind: 'layer', scene: 'taiga', time: 'night', layer: 'sky' } as const;
    await Promise.all([site.resolve(request), site.resolve(request), site.resolve(request)]);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('icons: the address is keyed by URL hash, only known ones are downloaded', async () => {
    const { assets: site } = assets(() => Promise.resolve({ ok: true, bytes: PNG }));
    const remote = 'https://mc-mon.ru/icons/abc.png';
    const local = site.localIcon(remote);
    expect(local).toBe(`app://launcher/cache/icons/${iconId(remote)}.png`);
    expect(await site.resolve({ kind: 'icon', id: iconId(remote) })).toMatch(/\.png$/);
    expect(await site.resolve({ kind: 'icon', id: '0'.repeat(32) })).toBeNull();
    expect(site.localIcon(null)).toBeNull();
  });
});
