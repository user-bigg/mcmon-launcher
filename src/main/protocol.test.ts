import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';

vi.mock('electron', () => ({ net: {}, protocol: {} }));

const { cacheHeaders, contentTypeFor, isCacheUrl, isInside, parseCacheUrl, resolveAppFile } =
  await import('./protocol');

const platforms = [
  ['posix', path.posix, '/tmp/launcher/out/renderer'],
  ['win32', path.win32, 'C:\\Users\\x\\AppData\\Local\\launcher\\out\\renderer'],
] as const;

describe.each(platforms)('resolveAppFile (%s)', (_name, fs, root) => {
  const inRoot = (...parts: string[]): string => fs.join(root, ...parts);

  it('the root path serves index.html', () => {
    expect(resolveAppFile(root, 'app://launcher/', fs)).toBe(inRoot('index.html'));
  });

  it('serves files inside the renderer folder', () => {
    expect(resolveAppFile(root, 'app://launcher/assets/index.js', fs)).toBe(
      inRoot('assets', 'index.js'),
    );
  });

  it('encoded .. sequences do not escape the folder', () => {
    expect(
      resolveAppFile(root, 'app://launcher/assets/..%2F..%2F..%2Fpackage.json', fs),
    ).toBeNull();
    expect(resolveAppFile(root, 'app://launcher/%2e%2e%2F%2e%2e%2Fetc%2Fpasswd', fs)).toBeNull();
  });

  it('broken percent-encoding, a port, or a foreign host give null instead of throwing', () => {
    expect(resolveAppFile(root, 'app://launcher/%E0%A4%A', fs)).toBeNull();
    expect(resolveAppFile(root, 'app://launcher:1234/index.html', fs)).toBeNull();
    expect(resolveAppFile(root, 'app://evil/index.html', fs)).toBeNull();
    expect(resolveAppFile(root, 'not a url', fs)).toBeNull();
  });
});

describe('resolveAppFile (win32)', () => {
  it('backslashes, a drive letter, and UNC paths do not escape the folder', () => {
    const root = 'C:\\launcher\\out\\renderer';
    expect(
      resolveAppFile(root, 'app://launcher/..%5C..%5Cwindows%5Cwin.ini', path.win32),
    ).toBeNull();
    expect(resolveAppFile(root, 'app://launcher/assets%5C..%5C..%5Cx', path.win32)).toBeNull();
    expect(resolveAppFile(root, 'app://launcher/C:%5Cwindows%5Cwin.ini', path.win32)).toMatch(
      /^C:\\launcher\\out\\renderer\\/,
    );
    expect(resolveAppFile(root, 'app://launcher/%5C%5Cserver%5Cshare%5Cx', path.win32)).toMatch(
      /^C:\\launcher\\out\\renderer\\/,
    );
  });
});

describe('contentTypeFor', () => {
  it("knows the build's file types and does not trust the system", () => {
    expect(contentTypeFor('/x/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/x/assets/index-abc.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/x/assets/logo.SVG')).toBe('image/svg+xml');
  });

  it('an unknown extension or a directory is not served', () => {
    expect(contentTypeFor('/x/app.asar')).toBeNull();
    expect(contentTypeFor('/x/assets')).toBeNull();
  });
});

describe('site cache via app://launcher/cache', () => {
  it('layers, thumbnails, and icons match a strict pattern', () => {
    expect(parseCacheUrl('app://launcher/cache/landscapes/taiga-day/sky.png')).toEqual({
      kind: 'layer',
      scene: 'taiga',
      time: 'day',
      layer: 'sky',
    });
    expect(parseCacheUrl('app://launcher/cache/landscapes/dark-forest-night/far_2.png')).toEqual({
      kind: 'layer',
      scene: 'dark-forest',
      time: 'night',
      layer: 'far_2',
    });
    expect(parseCacheUrl('app://launcher/cache/landscapes/thumbs/taiga-sunset.png')).toEqual({
      kind: 'thumb',
      scene: 'taiga',
      time: 'sunset',
    });
    const id = 'a'.repeat(32);
    expect(parseCacheUrl(`app://launcher/cache/icons/${id}.png?v=1`)).toEqual({ kind: 'icon', id });
  });

  it('path traversal, foreign hosts, and wrong types are rejected', () => {
    const rejected = [
      'app://launcher/cache/landscapes/taiga-day/..%2F..%2F..%2Fsite%2Fx.json',
      'app://launcher/cache/landscapes/taiga-day/%2e%2e%2fsky.png',
      'app://launcher/cache/landscapes/taiga-day/sky.png%00.js',
      'app://launcher/cache/landscapes/taiga-day/sky.json',
      'app://launcher/cache/landscapes/taiga-auto/sky.png',
      'app://launcher/cache/landscapes/taiga-day/a/b.png',
      'app://launcher/cache/landscapes/taiga-day/..%5C..%5Cwin.ini',
      'app://launcher/cache/site/0123.json',
      'app://launcher/cache/telemetry/queue.json',
      'app://launcher/cache/icons/XYZ.png',
      'app://evil/cache/icons/' + 'a'.repeat(32) + '.png',
      'app://user:pw@launcher/cache/icons/' + 'a'.repeat(32) + '.png',
      'not a url',
    ];
    for (const url of rejected) {
      expect(parseCacheUrl(url), url).toBeNull();
    }
    expect(
      parseCacheUrl('app://launcher/cache/landscapes/x/../../icons/' + 'b'.repeat(32) + '.png'),
    ).toEqual({ kind: 'icon', id: 'b'.repeat(32) });
  });

  it('cache pictures are readable across origins only for the dev server, and only for it', () => {
    expect(cacheHeaders(null)).toEqual({ 'Cache-Control': 'no-cache' });
    expect(cacheHeaders('http://localhost:5173')).toEqual({
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      Vary: 'Origin',
    });
  });

  it('the cache path is recognized by host and prefix', () => {
    expect(isCacheUrl('app://launcher/cache/icons/x.png')).toBe(true);
    expect(isCacheUrl('app://launcher/assets/index.js')).toBe(false);
    expect(isCacheUrl('app://other/cache/icons/x.png')).toBe(false);
  });

  it.each(platforms)('the file must stay inside the cache folder (%s)', (_name, fs, root) => {
    expect(isInside(root, fs.join(root, 'landscapes', 'taiga-day', 'sky.png'), fs)).toBe(true);
    expect(isInside(root, fs.join(root, '..', 'secret.png'), fs)).toBe(false);
    expect(isInside(root, `${root}-other${fs.sep}x.png`, fs)).toBe(false);
  });
});

describe.each(platforms)('app://launcher with hostile paths (%s)', (_name, fs, root) => {
  const insideOrNull = (url: string): boolean => {
    const file = resolveAppFile(root, url, fs);
    return file === null || file.startsWith(root + fs.sep);
  };

  it('double-encoding, a null byte, long paths, and unicode dots do not escape the folder', () => {
    for (const url of [
      'app://launcher/%252e%252e/%252e%252e/package.json',
      'app://launcher/%25252e%25252e%25252fpackage.json',
      'app://launcher/index.html%00.png',
      'app://launcher/..%00/..%00/package.json',
      'app://launcher/%c0%ae%c0%ae/%c0%ae%c0%ae/package.json',
      'app://launcher/%uff0e%uff0e/package.json',
      'app://launcher/．．/．．/package.json',
      'app://launcher/%E2%80%AE/../../x',
      `app://launcher/${'../'.repeat(1000)}package.json`,
      `app://launcher/${'a/'.repeat(10_000)}x.js`,
      'app://launcher/%2e%2e%5c%2e%2e%5cpackage.json',
      'app://launcher/\\..\\..\\package.json',
      'app://launcher//evil/share/x.js',
    ]) {
      expect({ url, inside: insideOrNull(url) }).toEqual({ url, inside: true });
    }
  });

  it('the type is determined only by the last known extension', () => {
    expect(contentTypeFor(fs.join(root, 'evil.html.exe'))).toBeNull();
    expect(contentTypeFor(fs.join(root, 'evil.js.map'))).toBeNull();
  });
});
