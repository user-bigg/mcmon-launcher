import type { InstanceRuntime } from '@shared/instance';
import {
  DEFAULT_MOD_CHOICES,
  modFileFor,
  modLabels,
  modsLoaderMin,
  modSteps,
  planMods,
  withFailures,
  NO_SERVER_MODS,
  type ModCatalog,
  type ModsPlace,
  type ModsPlan,
  type ServerMods,
  type ServerModsSource,
  type ShaderChoice,
} from '@shared/mods';
import { failure } from '../errors';
import type { GameLayout } from '../layout';
import type { Operation } from '../operation';
import type { ModFetch } from '../skins/mod-file';
import type { CatalogFabricMods } from '../skins/variant';
import { obtainModFiles, storedModFile, type ModProgress } from './files';
import { setUpShaders } from './shaders';

export interface PlayerModChoices {
  enabled: string[];
  shaders: ShaderChoice;
  optionalOff: string[];
}

export interface ModsRequest {
  modpack: boolean;
  server: () => Promise<ServerModsSource>;
  catalog: () => Promise<ModCatalog | null>;
  choices: () => Promise<PlayerModChoices>;
}

export interface ModsProfile {
  runtime: InstanceRuntime;
}

export interface CatalogRun {
  plan: ModsPlan;
  catalog: ModCatalog | null;
}

export interface CatalogModsOptions {
  layout: GameLayout;
  fetch: ModFetch;
  operation: Operation;
  log: (message: string) => void;
}

const NO_CHOICES: PlayerModChoices = {
  enabled: DEFAULT_MOD_CHOICES.enabled,
  shaders: DEFAULT_MOD_CHOICES.shaders,
  optionalOff: [],
};

function refuseIfNeeded(run: CatalogRun): CatalogRun {
  const refused = run.plan.refused;
  if (refused === null) {
    return run;
  }
  const mods = modLabels(run.catalog, refused.slugs);
  throw failure(
    refused.kind === 'missing'
      ? { code: 'mods-required-missing', mods }
      : { code: 'mods-required-failed', mods },
  );
}

function progressOf(operation: Operation): ModProgress {
  return {
    active: (slug): void => {
      operation.modStep(slug, { status: 'active' });
    },
    bytes: (slug, done): void => {
      operation.modStep(slug, { bytesDone: done });
    },
    done: (slug, fromDisk): void => {
      operation.modStep(slug, { status: 'done', fromDisk });
    },
    failed: (slug): void => {
      operation.modStep(slug, { status: 'failed' });
    },
  };
}

// A file that came but is no longer needed did not fail: it is only left out of this game.
function markLeftOut(run: CatalogRun, operation: Operation): void {
  const kept = new Set(run.plan.installs.map(({ mod }) => mod.slug));
  for (const step of operation.progress.snapshot().mods?.steps ?? []) {
    if (!kept.has(step.slug) && step.status !== 'failed' && step.status !== 'skipped') {
      operation.modStep(step.slug, { status: 'skipped' });
    }
  }
}

export function lose(
  run: CatalogRun,
  slugs: ReadonlySet<string>,
  operation: Operation,
): CatalogRun {
  const next = { ...run, plan: withFailures(run.plan, run.catalog, slugs) };
  markLeftOut(next, operation);
  return refuseIfNeeded(next);
}

export function loseAll(run: CatalogRun, operation: Operation): CatalogRun {
  return lose(run, new Set(run.plan.installs.map(({ mod }) => mod.slug)), operation);
}

interface Place {
  place: ModsPlace;
  server: ServerMods;
}

// A catalog server whose mods the launcher cannot learn is not entered blind: its bans and
// required mods are unknown.
async function placeOf(request: ModsRequest): Promise<Place> {
  if (request.modpack) {
    return { place: 'modpack', server: NO_SERVER_MODS };
  }
  const source = await request.server().catch((): ServerModsSource => ({ state: 'unknown' }));
  if (source.state === 'unknown') {
    throw failure({ code: 'mods-server-unknown' });
  }
  return { place: source.modpack ? 'modpack' : 'server', server: source.mods };
}

// Mods come only into a plain game: a server on a loader of its own is not given Fabric. The
// plan is made before Java and the game download, so a server that cannot be entered says so
// at once.
export async function planCatalogMods(
  request: ModsRequest | null,
  profile: ModsProfile,
  operation: Operation,
): Promise<CatalogRun | null> {
  if (request === null || profile.runtime.loader !== 'vanilla') {
    return null;
  }
  const { place, server } = await placeOf(request);
  if (place === 'modpack') {
    return null;
  }
  const [catalog, choices] = await Promise.all([
    request.catalog().catch(() => null),
    request.choices().catch(() => NO_CHOICES),
  ]);
  operation.signal.throwIfAborted();
  const plan = planMods({
    catalog,
    minecraft: profile.runtime.minecraft,
    place,
    server,
    ...choices,
  });
  return plan === null ? null : refuseIfNeeded({ plan, catalog });
}

function optionalLost(run: CatalogRun, failed: ReadonlySet<string>): string[] {
  const plan = withFailures(run.plan, run.catalog, failed);
  return plan.refused === null
    ? plan.entries
        .filter((entry) => entry.role === 'optional' && entry.state === 'failed')
        .map((entry) => entry.slug)
    : [];
}

// An optional mod of the server that did not come stops the launch until the player says
// whether to try again or to play without it; a required one refuses at once.
export async function obtainCatalogMods(
  run: CatalogRun | null,
  options: CatalogModsOptions,
): Promise<CatalogRun | null> {
  if (run === null) {
    return null;
  }
  const { operation } = options;
  operation.planMods(modSteps(run.plan, run.catalog));
  const fetchPicks = (picks: CatalogRun['plan']['installs']): Promise<Set<string>> =>
    obtainModFiles({
      layout: options.layout,
      picks,
      fetch: options.fetch,
      signal: operation.signal,
      log: options.log,
      progress: progressOf(operation),
    });
  let failed = await fetchPicks(run.plan.installs);
  for (;;) {
    const lost = optionalLost(run, failed);
    if (lost.length === 0) {
      break;
    }
    const answer = await operation.askMods(modLabels(run.catalog, lost));
    if (answer === 'without') {
      break;
    }
    const again = run.plan.installs.filter(({ mod }) => failed.has(mod.slug));
    for (const { mod } of again) {
      operation.modStep(mod.slug, { status: 'wait', bytesDone: 0 });
    }
    failed = await fetchPicks(again);
  }
  return lose(run, failed, operation);
}

export function fabricCatalog(
  run: CatalogRun | null,
  layout: GameLayout,
): CatalogFabricMods | null {
  if (run === null) {
    return null;
  }
  const loaderMin = modsLoaderMin(run.plan);
  const mods = run.plan.installs
    .filter(({ mod }) => mod.kind === 'mod')
    .map((pick) => ({
      role: 'catalog' as const,
      slug: pick.mod.slug,
      file: pick.file,
      stored: storedModFile(layout, pick),
    }));
  return loaderMin === null || mods.length === 0 ? null : { mods, loaderMin };
}

function irisSlugs(run: CatalogRun): Set<string> {
  return new Set(
    (run.catalog?.mods ?? [])
      .filter((mod) => mod.kind === 'shader_pack')
      .flatMap((mod) => modFileFor(mod, run.plan.minecraft)?.requires ?? []),
  );
}

export async function placeRunShaders(
  run: CatalogRun,
  layout: GameLayout,
  instance: string,
  withFabric: boolean,
  log: (message: string) => void,
): Promise<void> {
  const pick = withFabric
    ? run.plan.installs.find(({ mod }) => mod.slug === run.plan.shaderPack)
    : undefined;
  const iris = irisSlugs(run);
  await setUpShaders({
    instance,
    pack: pick === undefined ? null : { pick, stored: storedModFile(layout, pick) },
    ownPacks: (run.catalog?.mods ?? [])
      .filter((mod) => mod.kind === 'shader_pack')
      .map((mod) => mod.slug),
    iris: withFabric && run.plan.installs.some(({ mod }) => iris.has(mod.slug)),
    log,
  });
}
