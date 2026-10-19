import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isModSlug } from '@shared/mods';
import { isSha256, isSkinModVersion, type SkinModFile } from '@shared/skin-mod';
import { withFsRetry } from '../fs-retry';
import type { FetchLike } from '../json-cache';
import type { GameLayout } from '../layout';

export type ModFetch = (
  url: string,
  maxBytes: number,
  signal: AbortSignal,
  onBytes?: (bytes: number) => void,
) => Promise<Uint8Array>;

export type FabricModRole = 'skins' | 'client' | 'catalog';

export interface FabricMod {
  role: FabricModRole;
  file: SkinModFile;
  slug?: string;
  stored?: string;
}

export interface FabricModsOptions {
  layout: GameLayout;
  mods: readonly FabricMod[];
  fetch: ModFetch;
  signal: AbortSignal;
  log: (message: string) => void;
}

export interface PlacedMods {
  dir: string;
  roles: ReadonlySet<FabricModRole>;
  slugs: ReadonlySet<string>;
}

const REQUEST_TIMEOUT_MS = 30_000;

export function skinModsRoot(layout: GameLayout): string {
  return path.join(layout.root, 'skin-mod');
}

export function fabricModsKey(sha256s: readonly string[]): string {
  if (sha256s.length === 0 || !sha256s.every(isSha256)) {
    throw new Error('skin mod: malformed sha256');
  }
  const sorted = [...new Set(sha256s)].sort();
  return sorted.length === 1
    ? (sorted[0] ?? '')
    : createHash('sha256').update(sorted.join('\n')).digest('hex');
}

export function fabricModsDir(layout: GameLayout, sha256s: readonly string[]): string {
  return path.join(skinModsRoot(layout), fabricModsKey(sha256s));
}

function checkedVersion(mod: SkinModFile): string {
  if (!isSkinModVersion(mod.version)) {
    throw new Error('skin mod: malformed version');
  }
  return mod.version;
}

export function fabricModFileName(mod: FabricMod): string {
  if (mod.role === 'catalog') {
    return catalogJarName(mod.slug);
  }
  const version = checkedVersion(mod.file);
  return mod.role === 'skins' ? `CustomSkinLoader-${version}.jar` : `MCMonitor-${version}.jar`;
}

export function catalogJarName(slug: string | undefined): string {
  if (!isModSlug(slug)) {
    throw new Error('catalog mod: malformed slug');
  }
  return `${slug}.jar`;
}

export function matchesSkinMod(bytes: Uint8Array, mod: SkinModFile): boolean {
  return (
    bytes.byteLength === mod.size && createHash('sha256').update(bytes).digest('hex') === mod.sha256
  );
}

function hostOf(url: string): string {
  return URL.parse(url)?.host ?? 'unknown';
}

async function limitedBytes(
  response: Response,
  maxBytes: number,
  onBytes?: (bytes: number) => void,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('mod file: response larger than expected');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error('mod file: response larger than expected');
    }
    chunks.push(chunk);
    onBytes?.(total);
  }
  return Buffer.concat(chunks);
}

// The request goes out without the launcher headers: the first address is a third-party CDN
// and has no business knowing the install id.
export function createModFetch(fetchImpl: FetchLike): ModFetch {
  return async (url, maxBytes, signal, onBytes) => {
    const asked = URL.parse(url);
    if (asked?.protocol !== 'https:') {
      throw new Error('mod file: not an https address');
    }
    const response = await fetchImpl(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      credentials: 'omit',
    });
    const reached = URL.parse(response.url.length > 0 ? response.url : url);
    if (reached?.protocol !== 'https:' || reached.host !== asked.host) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('mod file: redirected to another host');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`mod file: HTTP ${String(response.status)}`);
    }
    return limitedBytes(response, maxBytes, onBytes);
  };
}

async function readExisting(file: string, mod: SkinModFile): Promise<Uint8Array | null> {
  const info = await stat(file).catch(() => null);
  if (info?.isFile() !== true || info.size !== mod.size) {
    return null;
  }
  return readFile(file).catch(() => null);
}

export async function keepOnly(dir: string, names: readonly string[]): Promise<void> {
  const found = await readdir(dir).catch((): string[] => []);
  const kept = names.map((name) => name.toLowerCase());
  for (const other of found.filter((item) => !kept.includes(item.toLowerCase()))) {
    await rm(path.join(dir, other), { recursive: true, force: true });
  }
}

export async function storeFile(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await withFsRetry(() => writeFile(temporary, bytes));
    await withFsRetry(() => rename(temporary, file));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function downloadModFile(
  mod: SkinModFile,
  options: Pick<FabricModsOptions, 'fetch' | 'signal' | 'log'> & { label?: string },
  onBytes?: (bytes: number) => void,
): Promise<Uint8Array | null> {
  const { fetch, signal, log } = options;
  const label = options.label ?? 'skins';
  for (const url of mod.urls) {
    signal.throwIfAborted();
    try {
      const bytes = await fetch(url, mod.size, signal, onBytes);
      if (matchesSkinMod(bytes, mod)) {
        return bytes;
      }
      log(`${label}: mod from ${hostOf(url)} failed the hash check`);
    } catch (error) {
      signal.throwIfAborted();
      log(`${label}: mod from ${hostOf(url)} not downloaded: ${String(error)}`);
    }
  }
  return null;
}

interface Checked {
  size: number;
  mtimeMs: number;
  sha256: string;
}

// A file hashed once in this run of the launcher is not hashed again while its size and time
// stay the same: a launch with many mods reads each of them once, not three times.
const checked = new Map<string, Checked>();

async function remember(file: string, mod: SkinModFile): Promise<void> {
  const info = await stat(file).catch(() => null);
  if (info?.isFile() === true) {
    checked.set(file, { size: info.size, mtimeMs: info.mtimeMs, sha256: mod.sha256 });
  }
}

async function isKnown(file: string, mod: SkinModFile): Promise<boolean> {
  const known = checked.get(file);
  if (known?.sha256 !== mod.sha256 || known.size !== mod.size) {
    return false;
  }
  const info = await stat(file).catch(() => null);
  return info?.isFile() === true && info.size === known.size && info.mtimeMs === known.mtimeMs;
}

export async function verified(file: string, mod: SkinModFile): Promise<Uint8Array | null> {
  if (await isKnown(file, mod)) {
    return readFile(file).catch(() => null);
  }
  const existing = await readExisting(file, mod);
  if (existing === null || !matchesSkinMod(existing, mod)) {
    return null;
  }
  await remember(file, mod);
  return existing;
}

export async function isVerified(file: string, mod: SkinModFile): Promise<boolean> {
  return (await isKnown(file, mod)) || (await verified(file, mod)) !== null;
}

export async function storeVerified(
  file: string,
  bytes: Uint8Array,
  mod: SkinModFile,
): Promise<void> {
  await storeFile(file, bytes);
  await remember(file, mod);
}

async function fromOtherSet(
  layout: GameLayout,
  dir: string,
  name: string,
  mod: SkinModFile,
): Promise<Uint8Array | null> {
  const root = skinModsRoot(layout);
  const sets = await readdir(root).catch((): string[] => []);
  for (const set of sets.filter((item) => path.join(root, item) !== dir)) {
    const bytes = await verified(path.join(root, set, name), mod);
    if (bytes !== null) {
      return bytes;
    }
  }
  return null;
}

interface Obtained {
  mod: FabricMod;
  name: string;
  bytes: Uint8Array | null;
  onDisk: string | null;
}

async function obtain(
  mod: FabricMod,
  dir: string,
  options: FabricModsOptions,
): Promise<Obtained | null> {
  const name = fabricModFileName(mod);
  const file = path.join(dir, name);
  if (await isVerified(file, mod.file)) {
    return { mod, name, bytes: null, onDisk: file };
  }
  await rm(file, { recursive: true, force: true });
  const stored = mod.stored === undefined ? null : await verified(mod.stored, mod.file);
  const bytes =
    stored ??
    (await fromOtherSet(options.layout, dir, name, mod.file)) ??
    (await downloadModFile(mod.file, options));
  return bytes === null ? null : { mod, name, bytes, onDisk: null };
}

// Windows and macOS do not tell names apart by case: two mods under one name would leave
// only one of them in the folder.
function distinctNames(mods: readonly FabricMod[], log: (message: string) => void): FabricMod[] {
  const names = new Set<string>();
  return mods.filter((mod) => {
    const name = fabricModFileName(mod).toLowerCase();
    if (names.has(name)) {
      log(`mods: ${name} left out, another mod has the same file name`);
      return false;
    }
    names.add(name);
    return true;
  });
}

export async function ensureFabricMods(options: FabricModsOptions): Promise<PlacedMods | null> {
  const { layout } = options;
  const mods = distinctNames(options.mods, options.log);
  if (mods.length === 0) {
    return null;
  }
  const wanted = fabricModsDir(
    layout,
    mods.map((mod) => mod.file.sha256),
  );
  const obtained: Obtained[] = [];
  for (const mod of mods) {
    const item = await obtain(mod, wanted, options);
    if (item !== null) {
      obtained.push(item);
    }
  }
  if (obtained.length === 0) {
    return null;
  }
  const dir = fabricModsDir(
    layout,
    obtained.map((item) => item.mod.file.sha256),
  );
  for (const { mod, name, bytes, onDisk } of obtained) {
    const file = path.join(dir, name);
    if (onDisk === file || (await isVerified(file, mod.file))) {
      continue;
    }
    const content = bytes ?? (onDisk === null ? null : await verified(onDisk, mod.file));
    if (content === null) {
      throw new Error('mod file: the file on disk changed while the launch was placing it');
    }
    await rm(file, { recursive: true, force: true });
    await storeVerified(file, content, mod.file);
  }
  await keepOnly(
    dir,
    obtained.map((item) => item.name),
  );
  return {
    dir,
    roles: new Set(obtained.map((item) => item.mod.role)),
    slugs: new Set(
      obtained.flatMap((item) => (item.mod.slug === undefined ? [] : [item.mod.slug])),
    ),
  };
}

export async function pruneSkinMods(layout: GameLayout, keep: ReadonlySet<string>): Promise<void> {
  const root = skinModsRoot(layout);
  const names = await readdir(root).catch((): string[] => []);
  for (const name of names.filter((item) => !keep.has(item))) {
    await rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined);
  }
}
