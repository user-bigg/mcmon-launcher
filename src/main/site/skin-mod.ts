import { isValidLoaderVersion } from '@shared/instance';
import { isValidVersionId } from '@shared/launch';
import {
  compareParts,
  isSha256,
  isSkinLoaderVersion,
  isSkinModVersion,
  MODRINTH_CDN_HOST,
  MODRINTH_MOD_PATH,
  releaseParts,
  type ClientMod,
  type ClientModLine,
  type SkinModEntry,
  type SkinModFile,
  type SkinModTable,
} from '@shared/skin-mod';
import { httpsUrl, integer, isoTime, isRecord, line, list } from './guards';

export const MAX_SKIN_MOD_BYTES = 32 * 1024 * 1024;
const MAX_URLS = 8;
const MAX_ENTRIES = 512;
const MAX_LINES = 16;

export interface SkinModRules {
  skinHosts: ReadonlySet<string>;
  log: (message: string) => void;
}

function plainHttps(value: unknown, hosts: ReadonlySet<string>): URL | null {
  const url = httpsUrl(value) === null ? null : URL.parse(String(value));
  if (url === null) {
    return null;
  }
  return url.username === '' && url.password === '' && hosts.has(url.host) ? url : null;
}

// The mod appends the nickname straight to the root, so anything but a plain folder address
// would send the request somewhere else.
export function serviceRoot(value: unknown, skinHosts: ReadonlySet<string>): string | null {
  const url = plainHttps(value, skinHosts);
  if (url === null) {
    return null;
  }
  return url.search === '' && url.hash === '' && url.pathname.endsWith('/') ? url.href : null;
}

function isModAddress(url: URL): boolean {
  if (url.search !== '' || url.hash !== '' || !url.pathname.endsWith('.jar')) {
    return false;
  }
  return url.host !== MODRINTH_CDN_HOST || url.pathname.startsWith(MODRINTH_MOD_PATH);
}

function modUrls(value: unknown, hosts: ReadonlySet<string>): string[] {
  const urls: string[] = [];
  for (const item of list(value)) {
    const url = plainHttps(item, hosts);
    if (url !== null && isModAddress(url) && !urls.includes(url.href)) {
      urls.push(url.href);
    }
  }
  return urls.slice(0, MAX_URLS);
}

function modVersion(value: unknown): string | null {
  const version = line(value, 48);
  return version !== null && isSkinModVersion(version) ? version : null;
}

function modFile(value: unknown, hosts: ReadonlySet<string>, version: unknown): SkinModFile | null {
  if (!isRecord(value)) {
    return null;
  }
  const checked = modVersion(version);
  const sha256 = typeof value.sha256 === 'string' ? value.sha256.toLowerCase() : '';
  const size = integer(value.size, 1, MAX_SKIN_MOD_BYTES);
  const urls = modUrls(value.urls, hosts);
  if (checked === null || size === null || urls.length === 0 || !isSha256(sha256)) {
    return null;
  }
  return { version: checked, urls, sha256, size };
}

function isFabricLoader(value: unknown): value is string {
  return typeof value === 'string' && isValidLoaderVersion(value) && isSkinLoaderVersion(value);
}

function entryOf(value: unknown, hosts: ReadonlySet<string>): SkinModEntry | null {
  if (!isRecord(value) || value.loader !== 'fabric') {
    return null;
  }
  const { minecraft, loader_version: loaderVersion } = value;
  if (typeof minecraft !== 'string' || !isValidVersionId(minecraft)) {
    return null;
  }
  if (!isFabricLoader(loaderVersion)) {
    return null;
  }
  const mod = isRecord(value.mod) ? modFile(value.mod, hosts, value.mod.version) : null;
  return mod === null ? null : { minecraft, loader: 'fabric', loader_version: loaderVersion, mod };
}

function entries(value: unknown, rules: SkinModRules): SkinModEntry[] {
  const hosts = new Set([MODRINTH_CDN_HOST, ...rules.skinHosts]);
  const seen = new Set<string>();
  const result: SkinModEntry[] = [];
  for (const [index, item] of list(value).slice(0, MAX_ENTRIES).entries()) {
    const entry = entryOf(item, hosts);
    if (entry === null || seen.has(entry.minecraft)) {
      rules.log(`site: skipped skin-mod entries[${String(index)}]`);
      continue;
    }
    seen.add(entry.minecraft);
    result.push(entry);
  }
  return result;
}

function lineOf(value: unknown, hosts: ReadonlySet<string>, version: string): ClientModLine | null {
  if (!isRecord(value)) {
    return null;
  }
  const { minecraft_from: from, minecraft_to: to, loader_version: loaderVersion } = value;
  if (typeof from !== 'string' || (to !== null && typeof to !== 'string')) {
    return null;
  }
  const fromParts = releaseParts(from);
  const toParts = to === null ? null : releaseParts(to);
  if (fromParts === null || (to !== null && toParts === null) || !isFabricLoader(loaderVersion)) {
    return null;
  }
  if (toParts !== null && compareParts(fromParts, toParts) > 0) {
    return null;
  }
  const mod = modFile(value.mod, hosts, version);
  return mod === null
    ? null
    : { minecraft_from: from, minecraft_to: to, loader_version: loaderVersion, mod };
}

function bounds(item: ClientModLine): [number[], number[] | null] {
  const to = item.minecraft_to === null ? null : releaseParts(item.minecraft_to);
  return [releaseParts(item.minecraft_from) ?? [], to];
}

function overlap(left: ClientModLine, right: ClientModLine): boolean {
  const [leftFrom, leftTo] = bounds(left);
  const [rightFrom, rightTo] = bounds(right);
  const leftFirst = rightTo === null || compareParts(leftFrom, rightTo) <= 0;
  const rightFirst = leftTo === null || compareParts(rightFrom, leftTo) <= 0;
  return leftFirst && rightFirst;
}

// Two jars for one game version would both load; neither line can be trusted to be the
// right one, so both are left out.
function withoutOverlaps(
  found: { index: number; item: ClientModLine }[],
  log: (message: string) => void,
): ClientModLine[] {
  const dropped = new Set<number>();
  for (const [position, left] of found.entries()) {
    for (const right of found.slice(position + 1)) {
      if (overlap(left.item, right.item)) {
        log(
          `site: skipped skin-mod client_mod lines[${String(left.index)}] and lines[${String(right.index)}]: overlap`,
        );
        dropped.add(left.index).add(right.index);
      }
    }
  }
  return found.filter(({ index }) => !dropped.has(index)).map(({ item }) => item);
}

function clientMod(value: unknown, rules: SkinModRules): ClientMod | null {
  if (value === undefined || value === null) {
    return null;
  }
  const version = isRecord(value) ? modVersion(value.version) : null;
  if (!isRecord(value) || version === null) {
    rules.log('site: skin-mod client_mod rejected');
    return null;
  }
  const found: { index: number; item: ClientModLine }[] = [];
  for (const [index, item] of list(value.lines).entries()) {
    const parsed = index < MAX_LINES ? lineOf(item, rules.skinHosts, version) : null;
    if (parsed === null) {
      rules.log(`site: skipped skin-mod client_mod lines[${String(index)}]`);
      continue;
    }
    found.push({ index, item: parsed });
  }
  const lines = withoutOverlaps(found, rules.log);
  if (lines.length === 0) {
    return null;
  }
  return {
    version,
    license: line(value.license, 64),
    license_url: httpsUrl(value.license_url),
    source_url: httpsUrl(value.source_url),
    lines,
  };
}

export function parseSkinMod(value: unknown, rules: SkinModRules): SkinModTable | null {
  if (!isRecord(value)) {
    return null;
  }
  const root = serviceRoot(value.service_root, rules.skinHosts);
  if (root === null) {
    rules.log('site: skin-mod service_root rejected');
    return null;
  }
  return {
    updated_at: isoTime(value.updated_at),
    service_root: root,
    source_url: httpsUrl(value.source_url),
    license_url: httpsUrl(value.license_url),
    license: line(value.license, 64),
    entries: entries(value.entries, rules),
    client_mod: clientMod(value.client_mod, rules),
  };
}
