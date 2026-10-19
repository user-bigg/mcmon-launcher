import type { ServerLaunch } from './catalog';
import type { SiteResult } from './site';
import {
  compareParts,
  isLoaderTriple,
  newerLoaderVersion,
  releaseParts,
  SKIN_LOADER_MIN_VERSION,
} from './skin-mod';

export const MOD_KINDS = ['mod', 'shader_pack'] as const;
export type ModKind = (typeof MOD_KINDS)[number];

export const MOD_GROUPS = [
  'optimization',
  'graphics',
  'interface',
  'cosmetics',
  'sound',
  'server',
] as const;
export type ModGroup = (typeof MOD_GROUPS)[number];

export const MOD_CHANNELS = ['release', 'beta'] as const;
export type ModChannel = (typeof MOD_CHANNELS)[number];

export const SHADER_CHOICES = ['off', 'light', 'beautiful'] as const;
export type ShaderChoice = (typeof SHADER_CHOICES)[number];

export const MOD_STATES = ['on', 'off_by_player', 'forbidden', 'no_file', 'failed'] as const;
export type ModState = (typeof MOD_STATES)[number];

export const MAX_MOD_BYTES = 100 * 1024 * 1024;
export const MAX_SERVER_MOD_SLUGS = 256;
export const MAX_ENABLED_MODS = 256;
export const MAX_SERVERS_WITH_CHOICES = 2000;
export const MAX_SHADER_OPTIONS = 32;

export const MOD_FILE_EXTENSION: Readonly<Record<ModKind, string>> = {
  mod: '.jar',
  shader_pack: '.zip',
};

const SLUG = /^[a-z0-9_-]{1,64}$/;
const MOD_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const OPTION_PART = /^[A-Za-z0-9_.]{1,64}$/;
// Win32 opens a device for these names whatever the extension: con.jar is the console.
const WINDOWS_DEVICES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/gu;

// Fabric Loader reads fabric.modsFolder from 0.15.0 on, and 26.1 itself asks for 0.18.4.
const FABRIC_GAME_MINIMUMS: readonly { from: readonly number[]; loader: string }[] = [
  { from: [26, 1], loader: '0.18.4' },
];
const FABRIC_FLOOR = SKIN_LOADER_MIN_VERSION.join('.');

export function isModSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value) && !WINDOWS_DEVICES.test(value);
}

export function isModVersion(value: unknown): value is string {
  return typeof value === 'string' && MOD_VERSION.test(value) && !value.includes('..');
}

export function isShaderOptions(value: Readonly<Record<string, unknown>>): boolean {
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.length <= MAX_SHADER_OPTIONS &&
    entries.every(
      ([key, item]) => OPTION_PART.test(key) && typeof item === 'string' && OPTION_PART.test(item),
    )
  );
}

// A text that is too long is cut at a word and marked, so that a longer line from the site
// does not take the mod and every server that needs it out of the launcher.
export function clipText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').replace(UNPRINTABLE, '').trim();
  const chars = Array.from(clean);
  if (chars.length <= max) {
    return clean;
  }
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > cut.length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface ModFile {
  minecraft: string;
  loader: 'fabric' | null;
  loader_min: string | null;
  version: string;
  channel: ModChannel;
  urls: string[];
  sha256: string;
  size: number;
  requires: string[];
}

export interface CatalogMod {
  slug: string;
  kind: ModKind;
  title: string;
  short: string;
  summary: string;
  group: ModGroup;
  player: boolean;
  server: boolean;
  often_forbidden: boolean;
  requires: string[];
  modrinth_id: string;
  license: string;
  source_url: string | null;
  credit: string | null;
  options: Record<string, string> | null;
  files: ModFile[];
}

export interface ShaderPacks {
  light: string;
  beautiful: string;
}

export interface ModCatalog {
  updated_at: string | null;
  mods: CatalogMod[];
  shaders: ShaderPacks | null;
}

export interface ServerMods {
  required: string[];
  optional: string[];
  forbidden: string[];
}

export const NO_SERVER_MODS: Readonly<ServerMods> = { required: [], optional: [], forbidden: [] };

// A required entry the launcher cannot read stays in the list as a mod that is in no catalog,
// so the server is still refused instead of entered without it.
export const UNREADABLE_REQUIRED = '';

export type ServerModsSource =
  { state: 'known'; mods: ServerMods; modpack: boolean } | { state: 'unknown' };

export function serverModsOf(launch: ServerLaunch | null): ServerModsSource {
  if (launch?.kind !== 'direct' || launch.modsUnreadable === true) {
    return { state: 'unknown' };
  }
  if (launch.modpack === true) {
    return { state: 'known', mods: NO_SERVER_MODS, modpack: true };
  }
  return { state: 'known', mods: launch.mods ?? NO_SERVER_MODS, modpack: false };
}

export interface ModChoices {
  enabled: string[];
  shaders: ShaderChoice;
  optionalOff: Record<string, string[]>;
}

export const DEFAULT_MOD_CHOICES: Readonly<ModChoices> = {
  enabled: [],
  shaders: 'off',
  optionalOff: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function slugList(value: unknown, max: number): string[] {
  const slugs = Array.isArray(value) ? value.filter(isModSlug) : [];
  return [...new Set(slugs)].slice(0, max);
}

export function isShaderChoice(value: unknown): value is ShaderChoice {
  return typeof value === 'string' && (SHADER_CHOICES as readonly string[]).includes(value);
}

const SERVER_KEY = /^[1-9]\d{0,11}$/;

function optionalOffOf(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [key, slugs] of Object.entries(value).slice(0, MAX_SERVERS_WITH_CHOICES)) {
    const list = slugList(slugs, MAX_SERVER_MOD_SLUGS);
    if (SERVER_KEY.test(key) && list.length > 0) {
      result[key] = list;
    }
  }
  return result;
}

export function normalizeModChoices(value: unknown): ModChoices {
  const source = isRecord(value) ? value : {};
  return {
    enabled: slugList(source.enabled, MAX_ENABLED_MODS),
    shaders: isShaderChoice(source.shaders) ? source.shaders : 'off',
    optionalOff: optionalOffOf(source.optionalOff),
  };
}

export function serverKey(serverId: number): string {
  return String(serverId);
}

export function optionalOffFor(choices: ModChoices, serverId: number | null): string[] {
  return serverId === null ? [] : (choices.optionalOff[serverKey(serverId)] ?? []);
}

export function fabricFloor(minecraft: string): string {
  const game = releaseParts(minecraft);
  const minimums = FABRIC_GAME_MINIMUMS.filter(
    (item) => game !== null && compareParts(game, item.from) >= 0,
  ).map((item) => item.loader);
  return [FABRIC_FLOOR, ...minimums].reduce(newerLoaderVersion);
}

export function modFileFor(mod: CatalogMod, minecraft: string): ModFile | null {
  const file = mod.files.find((item) => item.minecraft === minecraft);
  return file === undefined || file.urls.length === 0 ? null : file;
}

// Where catalog mods go: a catalog server with a plain game, and a server with its own modpack
// (none).
export const MODS_PLACES = ['server', 'modpack'] as const;
export type ModsPlace = (typeof MODS_PLACES)[number];

export type ModRole = 'required' | 'optional' | 'player' | 'shaders';

export interface ModsQuestion {
  catalog: ModCatalog | null;
  minecraft: string;
  place: ModsPlace;
  server: ServerMods;
  enabled: readonly string[];
  shaders: ShaderChoice;
  optionalOff: readonly string[];
}

export interface ModsEntry {
  slug: string;
  role: ModRole;
  state: ModState;
  needs: string[];
}

export interface ModPick {
  mod: CatalogMod;
  file: ModFile;
}

export interface ModsRefusal {
  kind: 'missing' | 'failed';
  slugs: string[];
}

export interface ModsPlan {
  minecraft: string;
  entries: ModsEntry[];
  installs: ModPick[];
  refused: ModsRefusal | null;
  shaderPack: string | null;
  catalogMissing: boolean;
}

type Blocked = 'no_file' | 'forbidden';

type Closure = { ok: true; slugs: string[] } | { ok: false; state: Blocked };

interface Walk {
  mods: ReadonlyMap<string, CatalogMod>;
  minecraft: string;
  order: string[];
  visiting: Set<string>;
  failed: Set<string>;
}

function catalogIndex(catalog: ModCatalog | null): Map<string, CatalogMod> {
  return new Map((catalog?.mods ?? []).map((mod) => [mod.slug, mod]));
}

// A ban is checked against everything the mod needs on any game version, as the site does,
// so that a forbidden mod cannot come in through one version of a mod and not another.
function bannedChain(
  slug: string,
  mods: ReadonlyMap<string, CatalogMod>,
  forbidden: ReadonlySet<string>,
  seen: Set<string>,
): boolean {
  if (forbidden.has(slug)) {
    return true;
  }
  if (seen.has(slug)) {
    return false;
  }
  seen.add(slug);
  return (mods.get(slug)?.requires ?? []).some((need) => bannedChain(need, mods, forbidden, seen));
}

function walk(slug: string, context: Walk): boolean {
  if (context.order.includes(slug)) {
    return true;
  }
  if (context.failed.has(slug) || context.visiting.has(slug)) {
    return false;
  }
  const mod = context.mods.get(slug);
  const file = mod === undefined ? null : modFileFor(mod, context.minecraft);
  context.visiting.add(slug);
  const good = file?.requires.every((need) => walk(need, context)) === true;
  context.visiting.delete(slug);
  if (good) {
    context.order.push(slug);
  } else {
    context.failed.add(slug);
  }
  return good;
}

function closureOf(
  slug: string,
  mods: ReadonlyMap<string, CatalogMod>,
  minecraft: string,
  forbidden: ReadonlySet<string>,
): Closure {
  if (bannedChain(slug, mods, forbidden, new Set())) {
    return { ok: false, state: 'forbidden' };
  }
  const order: string[] = [];
  const good = walk(slug, { mods, minecraft, order, visiting: new Set(), failed: new Set() });
  return good ? { ok: true, slugs: order } : { ok: false, state: 'no_file' };
}

function installsOf(
  entries: readonly ModsEntry[],
  mods: ReadonlyMap<string, CatalogMod>,
  minecraft: string,
): ModPick[] {
  const picks: ModPick[] = [];
  const seen = new Set<string>();
  for (const entry of entries.filter((item) => item.state === 'on')) {
    for (const slug of entry.needs.filter((item) => !seen.has(item))) {
      const mod = mods.get(slug);
      const file = mod === undefined ? null : modFileFor(mod, minecraft);
      if (mod !== undefined && file !== null) {
        seen.add(slug);
        picks.push({ mod, file });
      }
    }
  }
  return picks;
}

function refusalOf(entries: readonly ModsEntry[]): ModsRefusal | null {
  const required = entries.filter((entry) => entry.role === 'required' && entry.state !== 'on');
  if (required.length === 0) {
    return null;
  }
  const missing = required.filter((entry) => entry.state !== 'failed');
  return missing.length > 0
    ? { kind: 'missing', slugs: missing.map((entry) => entry.slug) }
    : { kind: 'failed', slugs: required.map((entry) => entry.slug) };
}

function shaderPackOf(entries: readonly ModsEntry[]): string | null {
  return entries.find((entry) => entry.role === 'shaders' && entry.state === 'on')?.slug ?? null;
}

function finish(
  minecraft: string,
  entries: ModsEntry[],
  mods: ReadonlyMap<string, CatalogMod>,
  catalogMissing = false,
): ModsPlan {
  return {
    minecraft,
    entries,
    installs: installsOf(entries, mods, minecraft),
    refused: refusalOf(entries),
    shaderPack: shaderPackOf(entries),
    catalogMissing,
  };
}

function forbiddenOf(question: ModsQuestion, mods: ReadonlyMap<string, CatalogMod>): Set<string> {
  return new Set(question.server.forbidden.filter((slug) => mods.get(slug)?.player === true));
}

function isPlayerMod(mod: CatalogMod | undefined): mod is CatalogMod {
  return mod !== undefined && mod.player && mod.kind === 'mod';
}

function shaderSlug(question: ModsQuestion): string | null {
  const packs = question.catalog?.shaders ?? null;
  return packs === null || question.shaders === 'off' ? null : packs[question.shaders];
}

// The catalog did not come at all: nothing is known about the mods, nothing is installed and
// nothing is reported, and a server that needs one asks to retry.
function withoutCatalog(question: ModsQuestion): ModsPlan {
  const entries = [...new Set(question.server.required)].map((slug): ModsEntry => ({
    slug,
    role: 'required',
    state: 'failed',
    needs: [],
  }));
  return finish(question.minecraft, entries, new Map(), true);
}

export function planMods(question: ModsQuestion): ModsPlan | null {
  if (question.place === 'modpack') {
    return null;
  }
  if (question.catalog === null) {
    return withoutCatalog(question);
  }
  const mods = catalogIndex(question.catalog);
  const forbidden = forbiddenOf(question, mods);
  const entries: ModsEntry[] = [];
  const has = (slug: string): boolean => entries.some((entry) => entry.slug === slug);
  const resolve = (slug: string, role: ModRole): void => {
    const closure = closureOf(slug, mods, question.minecraft, forbidden);
    entries.push(
      closure.ok
        ? { slug, role, state: 'on', needs: closure.slugs }
        : { slug, role, state: closure.state, needs: [] },
    );
  };
  for (const slug of question.server.required.filter((item) => !has(item))) {
    resolve(slug, 'required');
  }
  for (const slug of question.server.optional.filter((item) => mods.has(item) && !has(item))) {
    if (question.optionalOff.includes(slug)) {
      entries.push({ slug, role: 'optional', state: 'off_by_player', needs: [] });
    } else {
      resolve(slug, 'optional');
    }
  }
  for (const slug of question.enabled.filter((item) => isPlayerMod(mods.get(item)) && !has(item))) {
    resolve(slug, 'player');
  }
  const pack = shaderSlug(question);
  if (pack !== null && mods.has(pack) && !has(pack)) {
    resolve(pack, 'shaders');
  }
  return finish(question.minecraft, entries, mods);
}

// A file that did not come takes down every mod that needs it, and the mods that are left
// still form a set where each dependency is present.
export function withFailures(
  plan: ModsPlan,
  catalog: ModCatalog | null,
  failed: ReadonlySet<string>,
): ModsPlan {
  if (failed.size === 0) {
    return plan;
  }
  const entries = plan.entries.map((entry) =>
    entry.state === 'on' && entry.needs.some((slug) => failed.has(slug))
      ? { ...entry, state: 'failed' as const, needs: [] }
      : entry,
  );
  return finish(plan.minecraft, entries, catalogIndex(catalog), plan.catalogMissing);
}

export function modsLoaderMin(plan: ModsPlan | null): string | null {
  const versions = (plan?.installs ?? []).flatMap(({ file }) =>
    file.loader_min !== null && isLoaderTriple(file.loader_min) ? [file.loader_min] : [],
  );
  const needsFabric = (plan?.installs ?? []).some(({ mod }) => mod.kind === 'mod');
  return needsFabric ? [FABRIC_FLOOR, ...versions].reduce(newerLoaderVersion) : null;
}

export interface TelemetryMod {
  slug: string;
  state: ModState;
  version?: string;
}

// A mod that is in the game is on, also when it came only as a dependency of another one.
export function telemetryMods(plan: ModsPlan | null): TelemetryMod[] {
  if (plan === null || plan.catalogMissing) {
    return [];
  }
  const versions = new Map(plan.installs.map(({ mod, file }) => [mod.slug, file.version]));
  const seen = new Set<string>();
  const result: TelemetryMod[] = [];
  for (const entry of plan.entries) {
    if (seen.has(entry.slug)) {
      continue;
    }
    seen.add(entry.slug);
    const version = versions.get(entry.slug);
    result.push(
      version === undefined
        ? { slug: entry.slug, state: entry.state === 'on' ? 'failed' : entry.state }
        : { slug: entry.slug, state: 'on', version },
    );
  }
  return result;
}

export interface ModLabel {
  slug: string;
  short: string | null;
  title: string | null;
}

export function modLabels(catalog: ModCatalog | null, slugs: readonly string[]): ModLabel[] {
  const mods = catalogIndex(catalog);
  return slugs.map((slug) => {
    const mod = mods.get(slug);
    return { slug, short: mod?.short ?? null, title: mod?.title ?? null };
  });
}

export interface ModStep {
  slug: string;
  short: string;
  title: string;
  credit: string | null;
  kind: ModKind;
  version: string;
  channel: ModChannel;
  size: number;
  bytesDone: number;
  role: ModRole | 'dependency';
  dependencyOf: string[];
  status: 'wait' | 'active' | 'done' | 'failed' | 'skipped';
  fromDisk: boolean;
}

export interface ModsStepState {
  steps: ModStep[];
  skipped: { slug: string; short: string; title: string; state: ModState; role: ModRole }[];
}

export function modSteps(plan: ModsPlan, catalog: ModCatalog | null): ModsStepState {
  const mods = catalogIndex(catalog);
  const roles = new Map(plan.entries.map((entry) => [entry.slug, entry.role]));
  const steps = plan.installs.map(({ mod, file }): ModStep => {
    const role = roles.get(mod.slug);
    return {
      slug: mod.slug,
      short: mod.short,
      title: mod.title,
      credit: mod.credit,
      kind: mod.kind,
      version: file.version,
      channel: file.channel,
      size: file.size,
      bytesDone: 0,
      role: role ?? 'dependency',
      dependencyOf: plan.entries
        .filter((entry) => entry.slug !== mod.slug && entry.needs.includes(mod.slug))
        .map((entry) => entry.slug),
      status: 'wait',
      fromDisk: false,
    };
  });
  const skipped = plan.entries.flatMap((entry) => {
    const mod = mods.get(entry.slug);
    return entry.state === 'on' || mod === undefined
      ? []
      : [
          {
            slug: entry.slug,
            short: mod.short,
            title: mod.title,
            state: entry.state,
            role: entry.role,
          },
        ];
  });
  return { steps, skipped };
}

export interface ModChoicesPatch {
  enabled?: string[];
  shaders?: ShaderChoice;
}

export interface CatalogModView {
  slug: string;
  title: string;
  short: string;
  summary: string;
  credit: string | null;
  group: ModGroup;
  server: boolean;
  often_forbidden: boolean;
  license: string;
  source_url: string | null;
  enabled: boolean;
  available: boolean;
  version: string | null;
  channel: ModChannel | null;
  size: number | null;
  totalSize: number | null;
}

export interface ShaderPackView {
  choice: Exclude<ShaderChoice, 'off'>;
  slug: string;
  title: string;
  summary: string;
  credit: string | null;
  license: string;
  source_url: string | null;
  available: boolean;
  version: string | null;
  channel: ModChannel | null;
  size: number | null;
  totalSize: number | null;
}

export interface ModCreditView {
  slug: string;
  kind: ModKind;
  title: string;
  credit: string | null;
  license: string;
  source_url: string | null;
  modrinth_id: string;
}

export interface ModsCatalogView {
  minecraft: string | null;
  groups: { group: ModGroup; mods: CatalogModView[] }[];
  shaders: { choice: ShaderChoice; packs: ShaderPackView[]; needs: string[] } | null;
  enabledCount: number;
  credits: ModCreditView[];
}

export interface ServerModsQuery {
  serverId: number;
  minecraft: string;
}

export type ServerModRole = ModRole | 'forbidden';

export interface ServerModView {
  slug: string;
  role: ServerModRole;
  short: string;
  title: string;
  credit: string | null;
  state: ModState;
  enabled: boolean;
  available: boolean;
  version: string | null;
  channel: ModChannel | null;
  size: number | null;
  totalSize: number | null;
}

export interface ServerModsView {
  serverId: number;
  minecraft: string;
  known: boolean;
  installs: boolean;
  mods: ServerModView[];
  unknownRequired: string[];
}

export type ModsErrorCode = 'invalid-request' | 'failed';

export type ModsResult<T> = { ok: true; value: T } | { ok: false; error: { code: ModsErrorCode } };

export interface ModsService {
  catalog: (minecraft?: string) => Promise<SiteResult<ModsCatalogView>>;
  choices: () => Promise<ModsResult<ModChoices>>;
  setChoices: (patch: ModChoicesPatch) => Promise<ModsResult<ModChoices>>;
  serverPlan: (query: ServerModsQuery) => Promise<SiteResult<ServerModsView>>;
  setServerOptional: (
    serverId: number,
    slug: string,
    on: boolean,
  ) => Promise<ModsResult<ModChoices>>;
}

function sizeOf(
  slug: string,
  mods: ReadonlyMap<string, CatalogMod>,
  minecraft: string | null,
): Pick<CatalogModView, 'available' | 'version' | 'channel' | 'size' | 'totalSize'> {
  const mod = mods.get(slug);
  const file = mod === undefined || minecraft === null ? null : modFileFor(mod, minecraft);
  const closure = minecraft === null ? null : closureOf(slug, mods, minecraft, new Set<string>());
  const total =
    closure?.ok === true
      ? closure.slugs.reduce((sum, item) => {
          const need = mods.get(item);
          return sum + (need === undefined ? 0 : (modFileFor(need, minecraft ?? '')?.size ?? 0));
        }, 0)
      : null;
  return {
    available: closure?.ok === true,
    version: file?.version ?? null,
    channel: file?.channel ?? null,
    size: file?.size ?? null,
    totalSize: total,
  };
}

export function newestMinecraft(catalog: ModCatalog): string | null {
  const mods = catalogIndex(catalog);
  const none = new Set<string>();
  let best: { version: string; parts: number[] } | null = null;
  for (const mod of catalog.mods) {
    for (const { minecraft } of mod.files) {
      const parts = releaseParts(minecraft);
      if (parts === null || (best !== null && compareParts(parts, best.parts) <= 0)) {
        continue;
      }
      if (closureOf(mod.slug, mods, minecraft, none).ok) {
        best = { version: minecraft, parts };
      }
    }
  }
  return best?.version ?? null;
}

// With no row picked for the game version the pack still sits next to what it needs on any
// version, so the shaders block does not move around the screen.
function packNeeds(mod: CatalogMod | undefined, minecraft: string | null): string[] {
  const file = mod === undefined || minecraft === null ? null : modFileFor(mod, minecraft);
  return file?.requires ?? mod?.requires ?? [];
}

export function catalogView(
  catalog: ModCatalog,
  choices: ModChoices,
  minecraft: string | null,
): ModsCatalogView {
  const mods = catalogIndex(catalog);
  const groups = MOD_GROUPS.map((group) => ({
    group,
    mods: catalog.mods
      .filter((mod) => mod.group === group && isPlayerMod(mod))
      .map((mod): CatalogModView => ({
        slug: mod.slug,
        title: mod.title,
        short: mod.short,
        summary: mod.summary,
        credit: mod.credit,
        group: mod.group,
        server: mod.server,
        often_forbidden: mod.often_forbidden,
        license: mod.license,
        source_url: mod.source_url,
        enabled: choices.enabled.includes(mod.slug),
        ...sizeOf(mod.slug, mods, minecraft),
      })),
  })).filter((group) => group.mods.length > 0);
  const packs = catalog.shaders;
  const shaderViews =
    packs === null
      ? null
      : (['light', 'beautiful'] as const).flatMap((choice): ShaderPackView[] => {
          const mod = mods.get(packs[choice]);
          return mod === undefined
            ? []
            : [
                {
                  choice,
                  slug: mod.slug,
                  title: mod.title,
                  summary: mod.summary,
                  credit: mod.credit,
                  license: mod.license,
                  source_url: mod.source_url,
                  ...sizeOf(mod.slug, mods, minecraft),
                },
              ];
        });
  const needs = [
    ...new Set((shaderViews ?? []).flatMap((pack) => packNeeds(mods.get(pack.slug), minecraft))),
  ];
  return {
    minecraft,
    groups,
    shaders: shaderViews === null ? null : { choice: choices.shaders, packs: shaderViews, needs },
    enabledCount: groups.flatMap((group) => group.mods).filter((mod) => mod.enabled).length,
    credits: catalog.mods.map((mod) => ({
      slug: mod.slug,
      kind: mod.kind,
      title: mod.title,
      credit: mod.credit,
      license: mod.license,
      source_url: mod.source_url,
      modrinth_id: mod.modrinth_id,
    })),
  };
}

function serverRoleOf(entry: ModsEntry): ServerModRole {
  return entry.state === 'forbidden' && entry.role === 'player' ? 'forbidden' : entry.role;
}

export function serverModsView(
  query: ServerModsQuery,
  source: ServerModsSource,
  catalog: ModCatalog | null,
  choices: ModChoices,
): ServerModsView {
  if (source.state === 'unknown') {
    return { ...query, known: false, installs: false, mods: [], unknownRequired: [] };
  }
  const server = source.mods;
  const plan = planMods({
    catalog,
    minecraft: query.minecraft,
    place: source.modpack ? 'modpack' : 'server',
    server,
    enabled: choices.enabled,
    shaders: choices.shaders,
    optionalOff: optionalOffFor(choices, query.serverId),
  });
  const mods = catalogIndex(catalog);
  const listed = new Map<string, ServerModView>();
  const view = (
    slug: string,
    role: ServerModRole,
    state: ModState,
    enabled: boolean,
  ): ServerModView | null => {
    const mod = mods.get(slug);
    return mod === undefined
      ? null
      : {
          slug,
          role,
          short: mod.short,
          title: mod.title,
          credit: mod.credit,
          state,
          enabled,
          ...sizeOf(slug, mods, query.minecraft),
        };
  };
  for (const entry of plan?.entries ?? []) {
    const item = view(
      entry.slug,
      serverRoleOf(entry),
      entry.state,
      entry.state !== 'off_by_player',
    );
    if (item !== null) {
      listed.set(entry.slug, item);
    }
  }
  if (plan !== null) {
    for (const slug of server.forbidden.filter((item) => mods.get(item)?.player === true)) {
      const item = view(slug, 'forbidden', 'forbidden', choices.enabled.includes(slug));
      if (item !== null && !listed.has(slug)) {
        listed.set(slug, item);
      }
    }
  }
  return {
    serverId: query.serverId,
    minecraft: query.minecraft,
    known: true,
    installs: plan !== null,
    mods: [...listed.values()],
    unknownRequired:
      catalog === null || plan === null ? [] : server.required.filter((slug) => !mods.has(slug)),
  };
}
