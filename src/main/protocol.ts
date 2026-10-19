import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CACHE_ORIGIN_PATH } from '@shared/site';
import { contentSecurityPolicy } from './csp';
import { APP_HOST, APP_SCHEME } from './origins';
import type { CacheRequest } from './site/assets';

export interface CacheServer {
  root: string;
  resolve: (request: CacheRequest) => Promise<string | null>;
}

const CACHE_LAYER =
  /^\/cache\/landscapes\/([a-z0-9-]{1,32})-(day|sunset|night)\/([a-z0-9_-]{1,32})\.png$/;
const CACHE_THUMB = /^\/cache\/landscapes\/thumbs\/([a-z0-9-]{1,32})-(day|sunset|night)\.png$/;
const CACHE_ICON = /^\/cache\/icons\/([0-9a-f]{32})\.png$/;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// With a dev server the window lives on http://localhost and the cache pictures on app://: skin
// textures go into WebGL and must be readable across origins there. The built app has one
// origin and gets no such allowance.
export function registerAppScheme(dev = false): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: dev },
    },
  ]);
}

export function cacheHeaders(devOrigin: string | null): Record<string, string> {
  return {
    'Cache-Control': 'no-cache',
    ...(devOrigin === null ? {} : { 'Access-Control-Allow-Origin': devOrigin, Vary: 'Origin' }),
  };
}

export function resolveAppFile(
  rootDir: string,
  requestUrl: string,
  fs: path.PlatformPath = path,
): string | null {
  let url: URL;
  let pathname: string;
  try {
    url = new URL(requestUrl);
    pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (url.host !== APP_HOST) {
    return null;
  }
  const root = fs.resolve(rootDir);
  const file = fs.normalize(fs.join(root, pathname));
  if (!file.startsWith(root + fs.sep)) {
    return null;
  }
  return file;
}

export function isCacheUrl(requestUrl: string): boolean {
  const url = URL.parse(requestUrl);
  return url?.host === APP_HOST && url.pathname.startsWith(`${CACHE_ORIGIN_PATH}/`);
}

function timeOf(value: string | undefined): 'day' | 'sunset' | 'night' | null {
  return value === 'day' || value === 'sunset' || value === 'night' ? value : null;
}

export function parseCacheUrl(requestUrl: string): CacheRequest | null {
  const url = URL.parse(requestUrl);
  if (url?.host !== APP_HOST || url.username !== '' || url.password !== '') {
    return null;
  }
  const { pathname } = url;
  const layer = CACHE_LAYER.exec(pathname);
  const layerTime = timeOf(layer?.[2]);
  if (layer?.[1] !== undefined && layer[3] !== undefined && layerTime !== null) {
    return { kind: 'layer', scene: layer[1], time: layerTime, layer: layer[3] };
  }
  const thumb = CACHE_THUMB.exec(pathname);
  const thumbTime = timeOf(thumb?.[2]);
  if (thumb?.[1] !== undefined && thumbTime !== null) {
    return { kind: 'thumb', scene: thumb[1], time: thumbTime };
  }
  const icon = CACHE_ICON.exec(pathname);
  return icon?.[1] === undefined ? null : { kind: 'icon', id: icon[1] };
}

export function isInside(root: string, file: string, fs: path.PlatformPath = path): boolean {
  const base = fs.resolve(root);
  return fs.resolve(file).startsWith(base + fs.sep);
}

export function contentTypeFor(file: string): string | null {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? null;
}

async function fileResponse(
  file: string,
  contentType: string,
  headers: Record<string, string>,
): Promise<Response> {
  let response: Response;
  try {
    response = await net.fetch(pathToFileURL(file).href);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!response.ok) {
    return new Response(null, { status: 404 });
  }
  return new Response(response.body, {
    status: 200,
    headers: { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

async function serveCache(
  cache: CacheServer,
  requestUrl: string,
  devOrigin: string | null,
): Promise<Response> {
  const request = parseCacheUrl(requestUrl);
  const file = request === null ? null : await cache.resolve(request).catch(() => null);
  if (file === null || !isInside(cache.root, file)) {
    return new Response(null, { status: 404 });
  }
  return fileResponse(file, 'image/png', cacheHeaders(devOrigin));
}

export function serveApp(
  rendererDir: string | null,
  cache: CacheServer | null,
  devOrigin: string | null = null,
): void {
  const csp = contentSecurityPolicy(undefined);
  protocol.handle(APP_SCHEME, async (request) => {
    if (isCacheUrl(request.url)) {
      return cache === null
        ? new Response(null, { status: 404 })
        : serveCache(cache, request.url, devOrigin);
    }
    const file = rendererDir === null ? null : resolveAppFile(rendererDir, request.url);
    const contentType = file === null ? null : contentTypeFor(file);
    if (file === null || contentType === null) {
      return new Response(null, { status: 404 });
    }
    return fileResponse(file, contentType, { 'Content-Security-Policy': csp });
  });
}
