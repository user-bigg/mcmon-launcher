import type { ServerRow } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { urlHost } from '@shared/links';
import {
  clientModLine,
  decideClientMod,
  decideSkins,
  skinModEntry,
  type ClientModLine,
  type ClientModRun,
  type SkinsAuth,
  type SkinModTable,
  type SkinsQuestion,
  type SkinsStatus,
} from '@shared/skin-mod';
import { licenseOnly } from './tags';

const NO_MODS_KEY = 'mcmonitor.no-mods';
const FABRIC_HOST = 'fabricmc.net';

function readList(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(NO_MODS_KEY) ?? '[]');
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

// Only for moving the choice an early build kept in the window storage: the record is taken
// out as it is read.
export function takeLegacyNoMods(instanceId: string): boolean {
  const stored = readList();
  if (!stored.includes(instanceId)) {
    return false;
  }
  const rest = stored.filter((item) => item !== instanceId);
  try {
    if (rest.length === 0) {
      localStorage.removeItem(NO_MODS_KEY);
    } else {
      localStorage.setItem(NO_MODS_KEY, JSON.stringify(rest));
    }
  } catch {
    return true;
  }
  return true;
}

export function serverSkinsFlag(server: Pick<ServerRow, 'launch'>): boolean | undefined {
  return server.launch.kind === 'direct' ? server.launch.skins : undefined;
}

export function serverModpack(server: Pick<ServerRow, 'launch'>): boolean {
  return server.launch.kind === 'direct' && server.launch.modpack === true;
}

export function skinsPreview(question: SkinsQuestion): SkinsStatus {
  const decision = decideSkins(question);
  return decision.install ? 'on' : decision.reason;
}

export function serverAuth(server: Pick<ServerRow, 'access'>): SkinsAuth {
  return licenseOnly(server.access) ? 'license' : 'nick';
}

export function serverSkinsPreview(
  server: Pick<ServerRow, 'launch' | 'access'>,
  table: SkinModTable | null,
  withoutMods: boolean,
): SkinsStatus | null {
  if (server.launch.kind !== 'direct') {
    return null;
  }
  return skinsPreview({
    auth: serverAuth(server),
    serverSkins: server.launch.skins,
    modpack: serverModpack(server),
    withoutMods,
    loader: 'vanilla',
    minecraft: server.launch.minecraft,
    table,
  });
}

export function clientModGoes(
  line: ClientModLine | null,
  minecraft: string,
  blocked: readonly ClientModRun[],
): boolean {
  return (
    line !== null &&
    !blocked.some((run) => run.minecraft === minecraft && run.sha256 === line.mod.sha256)
  );
}

export function serverClientModPreview(
  server: Pick<ServerRow, 'launch' | 'access'>,
  table: SkinModTable | null,
  blocked: readonly ClientModRun[] = [],
): boolean {
  if (server.launch.kind !== 'direct') {
    return false;
  }
  const question = {
    auth: serverAuth(server),
    modpack: serverModpack(server),
    loader: 'vanilla' as const,
    minecraft: server.launch.minecraft,
    table,
  };
  return clientModGoes(decideClientMod(question), server.launch.minecraft, blocked);
}

export type FabricPurpose = 'skins' | 'check' | 'both';

export function fabricPurpose(skins: SkinsStatus | null, clientMod: boolean): FabricPurpose | null {
  if (skins === 'on') {
    return clientMod ? 'both' : 'skins';
  }
  return clientMod ? 'check' : null;
}

export function fabricNote(purpose: FabricPurpose): 'skins' | 'check' {
  return purpose === 'check' ? 'check' : 'skins';
}

export function versionLabel(minecraft: string, purpose: FabricPurpose | null): string {
  return purpose === null
    ? minecraft
    : fill(ru.install.versionWithLoader, { version: minecraft, loader: ru.loaders.fabric });
}

function hostsOf(urls: readonly string[]): string[] {
  return urls.map((url) => urlHost(url)).filter((host) => host !== null);
}

export function fabricFileHosts(
  table: SkinModTable | null,
  minecraft: string,
  purpose: FabricPurpose | null,
): string[] {
  const skins = purpose === 'skins' || purpose === 'both' ? skinModEntry(table, minecraft) : null;
  const client = purpose === 'check' || purpose === 'both' ? clientModLine(table, minecraft) : null;
  const hosts = [...hostsOf(skins?.mod.urls ?? []), ...hostsOf(client?.mod.urls ?? [])];
  return hosts.length === 0 ? [] : [...new Set([FABRIC_HOST, ...hosts])];
}

// A licence name such as GPL-3.0-only must not break at its hyphens.
export function unbroken(text: string): string {
  return text.replaceAll('-', '\u2011');
}

export interface SkinModCredit {
  version: string;
  license: string | null;
  sourceUrl: string | null;
  licenseUrl: string | null;
}

export function skinModCredit(table: SkinModTable | null): SkinModCredit | null {
  const versions = [...new Set((table?.entries ?? []).map((entry) => entry.mod.version))];
  if (table === null || versions.length === 0) {
    return null;
  }
  return {
    version: versions.join(', '),
    license: table.license,
    sourceUrl: table.source_url,
    licenseUrl: table.license_url,
  };
}

export interface ClientModCredit {
  version: string;
  license: string | null;
  sourceUrl: string | null;
  licenseUrl: string | null;
}

export function clientModCredit(table: SkinModTable | null): ClientModCredit | null {
  const mod = table?.client_mod ?? null;
  if (mod === null) {
    return null;
  }
  return {
    version: mod.version,
    license: mod.license,
    sourceUrl: mod.source_url,
    licenseUrl: mod.license_url,
  };
}
