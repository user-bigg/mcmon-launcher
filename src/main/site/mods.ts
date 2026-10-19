import { isValidLoaderVersion } from '@shared/instance';
import {
  clipText,
  isModSlug,
  isModVersion,
  isShaderOptions,
  MAX_MOD_BYTES,
  MOD_FILE_EXTENSION,
  MOD_CHANNELS,
  MOD_GROUPS,
  MOD_KINDS,
  type CatalogMod,
  type ModCatalog,
  type ModFile,
  type ModKind,
  type ShaderPacks,
} from '@shared/mods';
import { isLoaderTriple, isSha256, MODRINTH_CDN_HOST, releaseParts } from '@shared/skin-mod';
import {
  bool,
  httpsUrl,
  integer,
  isoTime,
  isRecord,
  line,
  list,
  oneOf,
  type Fields,
} from './guards';

const MAX_MODS = 256;
const MAX_FILES = 512;
const MAX_URLS = 8;
const MAX_REQUIRES = 16;
const MODRINTH_ID = /^[A-Za-z0-9]{8}$/;

export interface ModsRules {
  apiHosts: ReadonlySet<string>;
  log: (message: string) => void;
}

interface Address {
  modrinthPath: string;
  extension: string;
  apiHosts: ReadonlySet<string>;
}

interface RowRules {
  kind: ModKind;
  address: Address;
  requires: readonly string[];
}

// The copy on the site lies under the hash of this very row; any other file on the API host
// is not a mod.
function mirrorPath(address: Address, sha256: string): string {
  return `/storage/mods/${sha256}${address.extension}`;
}

function fileUrl(value: unknown, address: Address, sha256: string): string | null {
  const url = httpsUrl(value) === null ? null : URL.parse(String(value));
  if (url?.username !== '' || url.password !== '') {
    return null;
  }
  if (url.search !== '' || url.hash !== '' || !url.pathname.endsWith(address.extension)) {
    return null;
  }
  if (url.host === MODRINTH_CDN_HOST) {
    return url.pathname.startsWith(address.modrinthPath) ? url.href : null;
  }
  return address.apiHosts.has(url.host) && url.pathname === mirrorPath(address, sha256)
    ? url.href
    : null;
}

function fileUrls(value: unknown, address: Address, sha256: string): string[] {
  const urls: string[] = [];
  for (const item of list(value)) {
    const url = fileUrl(item, address, sha256);
    if (url !== null && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls.slice(0, MAX_URLS);
}

function modVersion(value: unknown): string | null {
  return isModVersion(value) ? value : null;
}

function clipped(value: unknown, max: number): string | null {
  return typeof value === 'string' ? clipText(value, max) : null;
}

function isRelease(value: unknown): value is string {
  return typeof value === 'string' && releaseParts(value) !== null;
}

function isLoaderMin(value: unknown): value is string {
  return typeof value === 'string' && isValidLoaderVersion(value) && isLoaderTriple(value);
}

// A mod row carries a jar for Fabric with its minimum loader; a shader pack row is a zip
// for Iris, with no loader and no loader_min at all. Any other mix is refused.
function loaderOf(
  value: Fields,
  kind: ModKind,
): { loader: 'fabric' | null; loader_min: string | null } | null {
  if (kind === 'mod') {
    return value.loader === 'fabric' && isLoaderMin(value.loader_min)
      ? { loader: 'fabric', loader_min: value.loader_min }
      : null;
  }
  return value.loader === null && !('loader_min' in value)
    ? { loader: null, loader_min: null }
    : null;
}

function rowRequiresOf(value: unknown, requires: readonly string[]): string[] | null {
  const known = (item: unknown): item is string => isModSlug(item) && requires.includes(item);
  return Array.isArray(value) && value.every(known) ? [...new Set(value)] : null;
}

function fileOf(value: unknown, rules: RowRules): ModFile | null {
  if (!isRecord(value) || !isRelease(value.minecraft)) {
    return null;
  }
  const { address } = rules;
  const loader = loaderOf(value, rules.kind);
  const requires = rowRequiresOf(value.requires, rules.requires);
  const version = modVersion(value.version);
  const channel = oneOf(value.channel, MOD_CHANNELS);
  const sha256 = typeof value.sha256 === 'string' ? value.sha256 : '';
  const size = integer(value.size, 1, MAX_MOD_BYTES);
  if (loader === null || version === null || channel === null || size === null) {
    return null;
  }
  if (!isSha256(sha256) || !Array.isArray(value.urls) || requires === null) {
    return null;
  }
  if (rules.kind === 'shader_pack' && !rules.requires.every((need) => requires.includes(need))) {
    return null;
  }
  return {
    minecraft: value.minecraft,
    ...loader,
    version,
    channel,
    urls: fileUrls(value.urls, address, sha256),
    sha256,
    size,
    requires,
  };
}

// The site keeps one row per game version; when two come, neither can be trusted to be the
// one the site meant, so the version is left without a file.
function filesOf(value: unknown[], rules: RowRules, log: (minecraft: string) => void): ModFile[] {
  const byVersion = new Map<string, unknown[]>();
  for (const item of value.slice(0, MAX_FILES)) {
    const minecraft = isRecord(item) && isRelease(item.minecraft) ? item.minecraft : null;
    if (minecraft !== null) {
      byVersion.set(minecraft, [...(byVersion.get(minecraft) ?? []), item]);
    }
  }
  const files: ModFile[] = [];
  for (const [minecraft, rows] of byVersion) {
    if (rows.length > 1) {
      log(minecraft);
      continue;
    }
    const file = fileOf(rows[0], rules);
    if (file !== null) {
      files.push(file);
    }
  }
  return files;
}

function requiresOf(value: unknown, slug: string): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_REQUIRES || !value.every(isModSlug)) {
    return null;
  }
  const slugs = [...new Set(value)];
  return slugs.includes(slug) ? null : slugs;
}

function optionsOf(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }
  return isShaderOptions(value)
    ? (Object.fromEntries(Object.entries(value)) as Record<string, string>)
    : null;
}

function optional<T>(
  value: Fields,
  key: string,
  read: (item: unknown) => T | null,
): T | null | undefined {
  if (!(key in value) || value[key] === null) {
    return null;
  }
  return read(value[key]) ?? undefined;
}

function textFields(
  value: Fields,
): Pick<CatalogMod, 'title' | 'short' | 'summary' | 'license'> | null {
  const title = clipped(value.title, 120);
  const short = clipped(value.short, 40);
  const summary = clipped(value.summary, 240);
  const license = line(value.license, 64);
  if ([title, short, summary, license].some((item) => item === null || item.trim() === '')) {
    return null;
  }
  return { title: title ?? '', short: short ?? '', summary: summary ?? '', license: license ?? '' };
}

function flagsOf(value: Fields): Pick<CatalogMod, 'player' | 'server' | 'often_forbidden'> | null {
  const player = bool(value.player);
  const server = bool(value.server);
  const oftenForbidden = bool(value.often_forbidden);
  return player === null || server === null || oftenForbidden === null
    ? null
    : { player, server, often_forbidden: oftenForbidden };
}

function modOf(value: unknown, rules: ModsRules): CatalogMod | null {
  if (!isRecord(value) || !isModSlug(value.slug)) {
    return null;
  }
  const { slug } = value;
  const kind = oneOf(value.kind, MOD_KINDS);
  const group = oneOf(value.group, MOD_GROUPS);
  const texts = textFields(value);
  const flags = flagsOf(value);
  const requires = requiresOf(value.requires, slug);
  const modrinthId =
    typeof value.modrinth_id === 'string' && MODRINTH_ID.test(value.modrinth_id)
      ? value.modrinth_id
      : null;
  const sourceUrl = optional(value, 'source_url', httpsUrl);
  const credit = optional(value, 'credit', (item) =>
    typeof item === 'string' ? clipText(item, 160) : null,
  );
  if (kind === null || group === null || texts === null || flags === null) {
    return null;
  }
  if (requires === null || modrinthId === null || !Array.isArray(value.files)) {
    return null;
  }
  if (sourceUrl === undefined || credit === undefined) {
    return null;
  }
  const address: Address = {
    modrinthPath: `/data/${modrinthId}/versions/`,
    extension: MOD_FILE_EXTENSION[kind],
    apiHosts: rules.apiHosts,
  };
  const log = (minecraft: string): void => {
    rules.log(`site: mods ${slug} ${minecraft}: two files for one version, both skipped`);
  };
  return {
    slug,
    kind,
    ...texts,
    group,
    ...flags,
    requires,
    modrinth_id: modrinthId,
    source_url: sourceUrl,
    credit: credit === '' ? null : credit,
    options: kind === 'shader_pack' ? optionsOf(value.options) : null,
    files: filesOf(value.files, { kind, address, requires }, log),
  };
}

function uniqueMods(value: unknown[], rules: ModsRules): CatalogMod[] {
  const parsed: { index: number; slug: unknown; mod: CatalogMod | null }[] = value
    .slice(0, MAX_MODS)
    .map((item, index) => ({
      index,
      slug: isRecord(item) ? item.slug : null,
      mod: modOf(item, rules),
    }));
  const counts = new Map<unknown, number>();
  for (const { slug } of parsed) {
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const mods: CatalogMod[] = [];
  for (const { index, slug, mod } of parsed) {
    if (mod === null || (counts.get(slug) ?? 0) > 1) {
      rules.log(`site: skipped mods[${String(index)}]`);
      continue;
    }
    mods.push(mod);
  }
  return mods;
}

// Only a circle in what the mod needs on any game version takes it down here; a dependency
// missing from the catalog leaves the mod without a file on the versions whose rows need it.
function withDependencies(mods: CatalogMod[], log: (message: string) => void): CatalogMod[] {
  const bySlug = new Map(mods.map((mod) => [mod.slug, mod]));
  const reaches = (from: string, target: string, seen: Set<string>): boolean => {
    if (seen.has(from)) {
      return false;
    }
    seen.add(from);
    const needs = bySlug.get(from)?.requires ?? [];
    return needs.some((need) => need === target || reaches(need, target, seen));
  };
  return mods.filter((mod) => {
    const circular = reaches(mod.slug, mod.slug, new Set());
    if (circular) {
      log(`site: skipped mod ${mod.slug}: its dependencies go in a circle`);
    }
    return !circular;
  });
}

function shadersOf(value: unknown, mods: readonly CatalogMod[]): ShaderPacks | null {
  if (!isRecord(value)) {
    return null;
  }
  const isPack = (slug: unknown): slug is string =>
    mods.some((mod) => mod.slug === slug && mod.kind === 'shader_pack');
  return isPack(value.light) && isPack(value.beautiful)
    ? { light: value.light, beautiful: value.beautiful }
    : null;
}

export function parseModCatalog(value: unknown, rules: ModsRules): ModCatalog | null {
  if (!isRecord(value) || !Array.isArray(value.mods)) {
    return null;
  }
  const mods = withDependencies(uniqueMods(value.mods, rules), rules.log);
  return {
    updated_at: isoTime(value.updated_at),
    mods,
    shaders: shadersOf(value.shaders, mods),
  };
}
