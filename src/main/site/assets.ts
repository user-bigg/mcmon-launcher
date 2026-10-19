import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SCENE_TIMES, type SceneTime } from '@shared/scenes';
import {
  ICON_CACHE_PATH,
  LANDSCAPE_CACHE_PATH,
  type SceneFiles,
  type SiteError,
} from '@shared/site';
import { readJson, writeJsonBestEffort } from '../launch/json-cache';
import { isRecord } from './guards';
import type { Downloaded } from './http';
import type { ParsedScene } from './parse';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SOURCES_FILE = 'sources.json';
const THUMBS_FOLDER = 'thumbs';
const MAX_PARALLEL = 6;

export type CacheRequest =
  | { kind: 'layer'; scene: string; time: SceneTime; layer: string }
  | { kind: 'thumb'; scene: string; time: SceneTime }
  | { kind: 'icon'; id: string };

export interface AssetDeps {
  root: string;
  appOrigin: string;
  download: (url: string, maxBytes: number) => Promise<Downloaded>;
  scenes: () => Promise<ParsedScene[] | null>;
  allowedHosts: () => Promise<ReadonlySet<string>>;
  log: (message: string) => void;
}

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export function iconId(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

export function isAllowedAsset(url: string, hosts: ReadonlySet<string>): boolean {
  const parsed = URL.parse(url);
  return (
    parsed !== null &&
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    hosts.has(parsed.host)
  );
}

export function assetHosts(apiBase: string, linkUrls: readonly string[]): Set<string> {
  const hosts = new Set<string>();
  for (const url of [apiBase, ...linkUrls]) {
    const parsed = URL.parse(url);
    if (parsed?.protocol === 'https:') {
      hosts.add(parsed.host);
    }
  }
  return hosts;
}

function folderOf(scene: string, time: SceneTime): string {
  return `${scene}-${time}`;
}

class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function readSources(folder: string): Promise<Record<string, string>> {
  const value = await readJson(join(folder, SOURCES_FILE));
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export class SiteAssets {
  private readonly icons = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<boolean>>();
  private readonly limiter = new Limiter(MAX_PARALLEL);
  private readonly sourceWrites = new Map<string, Promise<void>>();

  constructor(private readonly deps: AssetDeps) {}

  get landscapesDir(): string {
    return join(this.deps.root, 'landscapes');
  }

  get iconsDir(): string {
    return join(this.deps.root, 'icons');
  }

  localIcon(remote: string | null): string | null {
    if (remote === null) {
      return null;
    }
    const id = iconId(remote);
    this.icons.set(id, remote);
    return `${this.deps.appOrigin}${ICON_CACHE_PATH}/${id}.png`;
  }

  layerUrl(scene: string, time: SceneTime, layer: string): string {
    return `${this.deps.appOrigin}${LANDSCAPE_CACHE_PATH}/${folderOf(scene, time)}/${layer}.png`;
  }

  thumbUrl(scene: string, time: SceneTime): string {
    return `${this.deps.appOrigin}${LANDSCAPE_CACHE_PATH}/${THUMBS_FOLDER}/${folderOf(scene, time)}.png`;
  }

  async ensureScene(
    key: string,
    time: SceneTime,
  ): Promise<{ ok: true; value: SceneFiles } | { ok: false; error: SiteError }> {
    const scenes = await this.deps.scenes();
    const parsed = scenes?.find((item) => item.scene.key === key);
    if (parsed === undefined) {
      return { ok: false, error: { code: scenes === null ? 'offline' : 'not-found' } };
    }
    const names = Object.keys(parsed.sources.layers[time]);
    const [layers, thumb] = await Promise.all([
      Promise.all(names.map((layer) => this.resolve({ kind: 'layer', scene: key, time, layer }))),
      this.resolve({ kind: 'thumb', scene: key, time }),
    ]);
    const ready = names.flatMap((layer, index) =>
      layers[index] === null ? [] : [[layer, this.layerUrl(key, time, layer)] as const],
    );
    return {
      ok: true,
      value: {
        layers: Object.fromEntries(ready),
        thumb: thumb === null ? null : this.thumbUrl(key, time),
      },
    };
  }

  async resolve(request: CacheRequest): Promise<string | null> {
    if (request.kind === 'icon') {
      return this.resolveIcon(request.id);
    }
    const folder =
      request.kind === 'layer'
        ? join(this.landscapesDir, folderOf(request.scene, request.time))
        : join(this.landscapesDir, THUMBS_FOLDER);
    const name = request.kind === 'layer' ? request.layer : folderOf(request.scene, request.time);
    const file = join(folder, `${name}.png`);
    const remote = await this.remoteOf(request);
    const present = await exists(file);
    if (remote === null) {
      return present ? file : null;
    }
    if (present && (await readSources(folder))[name] === remote) {
      return file;
    }
    const fetched = await this.fetchOnce(remote, file);
    if (fetched) {
      await this.recordSource(folder, name, remote);
      return file;
    }
    return present ? file : null;
  }

  private async resolveIcon(id: string): Promise<string | null> {
    const file = join(this.iconsDir, `${id}.png`);
    if (await exists(file)) {
      return file;
    }
    const remote = this.icons.get(id);
    if (remote === undefined) {
      return null;
    }
    return (await this.fetchOnce(remote, file)) ? file : null;
  }

  private async remoteOf(request: Exclude<CacheRequest, { kind: 'icon' }>): Promise<string | null> {
    if (!SCENE_TIMES.includes(request.time)) {
      return null;
    }
    const scenes = await this.deps.scenes();
    const parsed = scenes?.find((item) => item.scene.key === request.scene);
    if (parsed === undefined) {
      return null;
    }
    return request.kind === 'layer'
      ? (parsed.sources.layers[request.time][request.layer] ?? null)
      : parsed.sources.thumbs[request.time];
  }

  private fetchOnce(remote: string, file: string): Promise<boolean> {
    const running = this.inflight.get(file);
    if (running !== undefined) {
      return running;
    }
    const task = this.limiter
      .run(() => this.fetchFile(remote, file))
      .finally(() => {
        this.inflight.delete(file);
      });
    this.inflight.set(file, task);
    return task;
  }

  private async fetchFile(remote: string, file: string): Promise<boolean> {
    if (!isAllowedAsset(remote, await this.deps.allowedHosts())) {
      this.deps.log(`site: blocked asset host ${URL.parse(remote)?.host ?? 'invalid'}`);
      return false;
    }
    const result = await this.deps.download(remote, MAX_IMAGE_BYTES);
    if (!result.ok || !isPng(result.bytes)) {
      this.deps.log(`site: asset failed ${result.ok ? 'not-png' : result.error.code}`);
      return false;
    }
    const temporary = `${file}.${String(process.pid)}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(temporary, result.bytes);
      await rename(temporary, file);
      return true;
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      return false;
    }
  }

  private recordSource(folder: string, name: string, remote: string): Promise<void> {
    const previous = this.sourceWrites.get(folder) ?? Promise.resolve();
    const next = previous.then(async () => {
      const sources = await readSources(folder);
      await writeJsonBestEffort(join(folder, SOURCES_FILE), { ...sources, [name]: remote });
    });
    this.sourceWrites.set(folder, next);
    return next;
  }
}
