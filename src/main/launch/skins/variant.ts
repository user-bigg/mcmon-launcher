import path from 'node:path';
import type { InstanceRuntime } from '@shared/instance';
import { fabricFloor } from '@shared/mods';
import {
  clientModLine,
  decideSkins,
  newerLoaderVersion,
  skinsOffBeforeTable,
  wantsClientMod,
  type ClientModLine,
  type ClientModStatus,
  type SkinModEntry,
  type SkinModTable,
  type SkinsAuth,
  type SkinsStatus,
} from '@shared/skin-mod';
import { toLaunchError } from '../errors';
import type { GameLayout } from '../layout';
import type { ClientModRun } from './client-mod-blocks';
import { writeSkinConfig } from './config';
import {
  ensureFabricMods,
  fabricModsKey,
  pruneSkinMods,
  type FabricMod,
  type FabricModRole,
  type ModFetch,
  type PlacedMods,
} from './mod-file';

export type SkinModSource = () => Promise<SkinModTable | null>;

export interface SkinsRequest {
  auth: SkinsAuth;
  serverSkins: boolean | undefined;
  modpack: boolean;
  withoutMods: () => Promise<boolean>;
  table: SkinModSource;
  clientModBlocked?: (run: ClientModRun) => Promise<boolean>;
}

export interface CatalogFabricMods {
  mods: FabricMod[];
  loaderMin: string;
}

export interface SkinsPlan {
  skins: { entry: SkinModEntry; serviceRoot: string } | null;
  clientMod: ClientModLine | null;
  catalog: FabricMod[];
  floor: string;
  runtime: InstanceRuntime;
  keep: ReadonlySet<string> | null;
}

export interface PlannedSkins {
  status: SkinsStatus | null;
  clientMod: ClientModStatus | null;
  plan: SkinsPlan | null;
  blocked?: ClientModRun;
}

export interface SkinFilesOptions {
  layout: GameLayout;
  instance: string;
  plan: SkinsPlan;
  fetch: ModFetch;
  signal: AbortSignal;
  log: (message: string) => void;
}

export interface PlacedSkinFiles {
  modsDir: string;
  roles: ReadonlySet<FabricModRole>;
  slugs: ReadonlySet<string>;
}

const NOT_OPTIONAL = new Set(['cancelled', 'disk-full', 'permission-denied']);

function setOf(...mods: ({ sha256: string } | undefined)[]): string {
  return fabricModsKey(mods.flatMap((mod) => (mod === undefined ? [] : [mod.sha256])));
}

export function fabricModsKeys(table: SkinModTable): Set<string> {
  const keys = new Set<string>();
  for (const entry of table.entries) {
    keys.add(setOf(entry.mod));
    keys.add(setOf(entry.mod, clientModLine(table, entry.minecraft)?.mod));
  }
  for (const line of table.client_mod?.lines ?? []) {
    keys.add(setOf(line.mod));
  }
  return keys;
}

// The site's line of the client mod names the loader that the game version needs; the
// numbers in the code are only the lowest bound for a launch without the table.
function floorOf(minecraft: string, table: SkinModTable | null): string {
  const line = clientModLine(table, minecraft)?.loader_version;
  const floor = fabricFloor(minecraft);
  return line === undefined ? floor : newerLoaderVersion(floor, line);
}

// One loader serves the whole launch: the newest of what each mod in it asks for, and never
// older than what fabric.modsFolder and the game version itself need.
function loaderVersionOf(
  floor: string,
  skins: SkinModEntry | null,
  clientMod: ClientModLine | null,
  catalogLoaderMin: string | null,
): string {
  const versions = [
    floor,
    skins?.loader_version,
    clientMod?.loader_version,
    catalogLoaderMin ?? undefined,
  ].filter((version) => version !== undefined);
  return versions.reduce(newerLoaderVersion);
}

// Counted again from what really went into the folder: a mod that fell out does not keep the
// loader it asked for.
export function placedRuntime(
  plan: SkinsPlan,
  roles: ReadonlySet<FabricModRole>,
  catalogLoaderMin: string | null,
): InstanceRuntime {
  return {
    ...plan.runtime,
    loaderVersion: loaderVersionOf(
      plan.floor,
      roles.has('skins') ? (plan.skins?.entry ?? null) : null,
      roles.has('client') ? plan.clientMod : null,
      roles.has('catalog') ? catalogLoaderMin : null,
    ),
  };
}

function clientModStatus(
  wanted: boolean,
  table: SkinModTable | null,
  line: ClientModLine | null,
): ClientModStatus {
  if (!wanted) {
    return 'off';
  }
  if (table === null) {
    return 'unavailable';
  }
  return line === null ? 'off' : 'on';
}

function isBlocked(request: SkinsRequest, run: ClientModRun): Promise<boolean> {
  return request.clientModBlocked === undefined
    ? Promise.resolve(false)
    : request.clientModBlocked(run).catch(() => false);
}

export async function planSkins(
  request: SkinsRequest | null,
  runtime: InstanceRuntime,
  catalogMods: CatalogFabricMods | null = null,
): Promise<PlannedSkins> {
  if (request === null) {
    return { status: null, clientMod: null, plan: null };
  }
  const catalog = catalogMods !== null && catalogMods.mods.length > 0 ? catalogMods : null;
  const fixed = {
    auth: request.auth,
    serverSkins: request.serverSkins,
    modpack: request.modpack,
    loader: runtime.loader,
    minecraft: runtime.minecraft,
  };
  const wanted = wantsClientMod(fixed);
  const withoutMods = (): Promise<boolean> => request.withoutMods().catch(() => false);
  const early = skinsOffBeforeTable({ ...fixed, withoutMods: await withoutMods() });
  if (early !== null && !wanted && catalog === null) {
    return { status: early, clientMod: 'off', plan: null };
  }
  const table = await request.table().catch(() => null);
  // The player may flip 'without mods' until this very step, and the table can take seconds:
  // the choice is read again so that the last answer wins.
  const decision =
    early !== null && !wanted
      ? ({ install: false, reason: early } as const)
      : decideSkins({ ...fixed, withoutMods: await withoutMods(), table });
  const due = wanted ? clientModLine(table, runtime.minecraft) : null;
  const run = due === null ? null : { minecraft: runtime.minecraft, sha256: due.mod.sha256 };
  const blocked = run !== null && (await isBlocked(request, run)) ? run : null;
  const clientMod = blocked === null ? due : null;
  const entry = decision.install ? decision.entry : null;
  const floor = floorOf(runtime.minecraft, table);
  const status = decision.install ? 'on' : decision.reason;
  const clientStatus = blocked === null ? clientModStatus(wanted, table, clientMod) : 'unavailable';
  const extra = blocked === null ? {} : { blocked };
  if (catalog === null && (table === null || (entry === null && clientMod === null))) {
    return { status, clientMod: clientStatus, plan: null, ...extra };
  }
  return {
    ...extra,
    status,
    clientMod: clientStatus,
    plan: {
      skins: entry === null || table === null ? null : { entry, serviceRoot: table.service_root },
      clientMod,
      catalog: catalog?.mods ?? [],
      floor,
      runtime: {
        minecraft: runtime.minecraft,
        loader: 'fabric',
        loaderVersion: loaderVersionOf(floor, entry, clientMod, catalog?.loaderMin ?? null),
      },
      keep: table === null ? null : fabricModsKeys(table),
    },
  };
}

function modsOf(plan: SkinsPlan): FabricMod[] {
  const mods: FabricMod[] = [];
  if (plan.skins !== null) {
    mods.push({ role: 'skins', file: plan.skins.entry.mod });
  }
  if (plan.clientMod !== null) {
    mods.push({ role: 'client', file: plan.clientMod.mod });
  }
  return [...mods, ...plan.catalog];
}

async function withSkinConfig(
  options: SkinFilesOptions,
  placed: PlacedMods,
): Promise<PlacedMods | null> {
  const { layout, instance, plan, fetch, signal, log } = options;
  if (plan.skins === null || !placed.roles.has('skins')) {
    return placed;
  }
  try {
    await writeSkinConfig(instance, plan.skins.serviceRoot);
    return placed;
  } catch (error) {
    signal.throwIfAborted();
    log(`skins: settings not written: ${String(error)}`);
  }
  const mods = modsOf(plan).filter(
    (mod) => mod.role !== 'skins' && (mod.role !== 'client' || placed.roles.has('client')),
  );
  return mods.length === 0 ? null : ensureFabricMods({ layout, mods, fetch, signal, log });
}

export async function placeSkinFiles(options: SkinFilesOptions): Promise<PlacedSkinFiles | null> {
  const { layout, plan, fetch, signal, log } = options;
  try {
    const placed = await ensureFabricMods({ layout, mods: modsOf(plan), fetch, signal, log });
    if (placed === null) {
      return null;
    }
    const settled = await withSkinConfig(options, placed);
    if (settled === null) {
      return null;
    }
    // Without the table the launcher does not know which sets are still of use: none is removed.
    if (plan.keep !== null) {
      await pruneSkinMods(layout, new Set([...plan.keep, path.basename(settled.dir)]));
    }
    return { modsDir: settled.dir, roles: settled.roles, slugs: settled.slugs };
  } catch (error) {
    signal.throwIfAborted();
    log(`skins: files not prepared: ${String(error)}`);
    return null;
  }
}

export function canPlayWithoutSkins(error: unknown, signal: AbortSignal): boolean {
  return !signal.aborted && !NOT_OPTIONAL.has(toLaunchError(error).code);
}
