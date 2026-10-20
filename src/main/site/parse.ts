import { BlockList, isIP } from 'node:net';
import type {
  Downtime,
  OnlinePoint,
  PingTarget,
  ServerAccess,
  ServerCard,
  ServerLaunch,
  ServerLinks,
  ServerList,
  ServerRow,
  VersionRange,
} from '@shared/catalog';
import { TOP_SLOT_TIERS } from '@shared/catalog';
import { isValidCover } from '@shared/instance';
import { isValidServerId, isValidVersionId } from '@shared/launch';
import {
  isModSlug,
  MAX_SERVER_MOD_SLUGS,
  UNREADABLE_REQUIRED,
  type ServerMods,
} from '@shared/mods';
import {
  LAYER_ANIMATIONS,
  LAYER_NAME_PATTERN,
  SCENE_KEY_PATTERN,
  SCENE_MOODS,
  SCENE_PURPOSES,
  SCENE_TIMES,
  type LayerAnimation,
  type Scene,
  type SceneLayer,
  type SceneTime,
} from '@shared/scenes';
import {
  isReportReason,
  MAX_REPORT_REASONS,
  type MyReport,
  type ReportReason,
  type ServerReport,
} from '@shared/report';
import { parseServerAddress, type ServerAddress } from '@shared/server-address';
import { SITE_LINK_KEYS, type ServerLive, type SiteLinks, type SiteMeta } from '@shared/site';
import {
  bool,
  fraction,
  httpsUrl,
  integer,
  isoTime,
  isRecord,
  line,
  list,
  oneOf,
  text,
  type Fields,
} from './guards';

export type ParseLog = (message: string) => void;

const MAX_COUNT = 10_000_000;
const MAX_FREE_TOP_SLOTS = 100;
const MAX_ROWS = 200;
const MAX_SCENES = 500;
const MAX_LAYERS = 32;
const SCENE_COLUMNS = 384;
const MAX_CHART_POINTS = 2000;
const MAX_REASON_LABEL = 80;
const TAG = /^[a-z0-9_-]{1,32}$/;
const SKY = /^#[0-9a-fA-F]{6}$/;
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const LINK_KEYS = [
  'site',
  'discord',
  'telegram',
  'vk',
  'youtube',
  'tiktok',
] as const satisfies readonly (keyof ServerLinks)[];
const DEFAULT_COVER = { scene: 'plains', time: 'auto' } as const;
const DEFAULT_ACCESS: ServerAccess = { license: true, nick: false };

export interface SceneSources {
  layers: Record<SceneTime, Record<string, string>>;
  thumbs: Record<SceneTime, string | null>;
}

export interface ParsedScene {
  scene: Scene;
  sources: SceneSources;
}

function version(value: unknown): string | null {
  const parsed = line(value, 64);
  return parsed !== null && isValidVersionId(parsed) ? parsed : null;
}

function versions(value: unknown): VersionRange | null {
  if (!isRecord(value)) {
    return null;
  }
  const from = version(value.from);
  const to = version(value.to);
  return from === null || to === null ? null : { from, to };
}

function address(value: unknown): ServerAddress | null {
  if (!isRecord(value)) {
    return null;
  }
  const host = line(value.host, 253);
  const port = value.port === null ? null : integer(value.port, 1, 65535);
  if (host === null || (port === null && value.port !== null)) {
    return null;
  }
  return parseServerAddress(port === null ? host : `${host}:${String(port)}`);
}

// Written as octets: the publish check reads a dotted private address as a leaked one.
const LOCAL_V4: readonly (readonly [readonly number[], number])[] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 168, 0, 0], 16],
  [[224, 0, 0, 0], 3],
];
const LOCAL_V6: readonly (readonly [string, number])[] = [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

function localNetworks(): BlockList {
  const list = new BlockList();
  for (const [octets, prefix] of LOCAL_V4) {
    list.addSubnet(octets.join('.'), prefix, 'ipv4');
  }
  for (const [network, prefix] of LOCAL_V6) {
    list.addSubnet(network, prefix, 'ipv6');
  }
  return list;
}

const LOCAL_NETWORKS = localNetworks();

// The site's check is followed by every player's launcher: an address of a home or provider
// network would send a status request into the player's own network, so only public ones go.
// BlockList matches an IPv4 address against IPv6 subnets of mapped addresses, so the mapped
// form is refused by its prefix instead of a ::ffff:0:0/96 subnet.
function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0 || (family === 6 && /^::ffff:/i.test(ip))) {
    return false;
  }
  return !LOCAL_NETWORKS.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

function pingTarget(value: unknown): PingTarget | null {
  if (!isRecord(value)) {
    return null;
  }
  const raw = line(value.ip, 64);
  const port = integer(value.port, 1, 65535);
  const checkedAt = isoTime(value.checked_at);
  if (raw === null || port === null || checkedAt === null) {
    return null;
  }
  const ip = /^\[(.*)\]$/.exec(raw)?.[1] ?? raw;
  return isPublicIp(ip) ? { ip, port, checkedAt } : null;
}

type ServerModsField = { mods: ServerMods } | { unreadable: true } | null;

function modList(value: unknown, keepUnreadable: boolean): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_SERVER_MOD_SLUGS) {
    return null;
  }
  const slugs = keepUnreadable
    ? value.map((item) => (isModSlug(item) ? item : UNREADABLE_REQUIRED))
    : value.filter(isModSlug);
  return [...new Set(slugs)];
}

// A list the site left out is an empty one; a list the launcher cannot trust makes the mods
// of the server unknown, and a bad slug among the required ones is a mod nobody can install.
function serverMods(value: unknown): ServerModsField {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return { unreadable: true };
  }
  const required = modList(value.required, true);
  const optional = modList(value.optional, false);
  const forbidden = modList(value.forbidden, false);
  if (required === null || optional === null || forbidden === null) {
    return { unreadable: true };
  }
  const empty = [required, optional, forbidden].every((list) => list.length === 0);
  return empty ? null : { mods: { required, optional, forbidden } };
}

function launch(value: unknown): ServerLaunch {
  if (!isRecord(value)) {
    return { kind: 'none' };
  }
  if (value.kind === 'direct') {
    const minecraft = version(value.minecraft);
    if (minecraft === null) {
      return { kind: 'none' };
    }
    const skins = bool(value.skins);
    const modpack = bool(value.modpack);
    const mods = modpack === true ? null : serverMods(value.mods);
    return {
      kind: 'direct',
      minecraft,
      ...(skins === null ? {} : { skins }),
      ...(modpack === null ? {} : { modpack }),
      ...(mods === null ? {} : 'mods' in mods ? { mods: mods.mods } : { modsUnreadable: true }),
      ...(value.launcher_only === true ? { launcherOnly: true } : {}),
    };
  }
  if (value.kind === 'own_launcher') {
    const url = httpsUrl(value.url);
    const label = line(value.label, 80);
    return url === null || label === null ? { kind: 'none' } : { kind: 'own_launcher', url, label };
  }
  return { kind: 'none' };
}

function access(value: unknown): ServerAccess {
  if (!isRecord(value)) {
    return DEFAULT_ACCESS;
  }
  return {
    license: bool(value.license) ?? DEFAULT_ACCESS.license,
    nick: bool(value.nick) ?? DEFAULT_ACCESS.nick,
  };
}

function tags(value: unknown): string[] {
  return list(value)
    .filter((tag): tag is string => typeof tag === 'string' && TAG.test(tag))
    .slice(0, 16);
}

function rank(value: unknown): number | null {
  return value === null ? null : integer(value, 1, MAX_COUNT);
}

function topSlot(value: unknown): ServerRow['topSlot'] {
  if (!isRecord(value)) {
    return null;
  }
  const tier = oneOf(value.tier, TOP_SLOT_TIERS);
  return tier === null ? null : { tier };
}

function rowFields(value: Fields): ServerRow | null {
  const id = isValidServerId(value.id) ? value.id : null;
  const name = line(value.name, 120);
  const where = address(value.address);
  const edition = oneOf(value.edition, ['java', 'bedrock'] as const);
  if (id === null || name === null || name.trim() === '' || where === null || edition === null) {
    return null;
  }
  return {
    id,
    slug: line(value.slug, 120) ?? '',
    name,
    address: where,
    pingTarget: isRecord(value.address) ? pingTarget(value.address.ping) : null,
    edition,
    description: line(value.description, 400) ?? '',
    tags: tags(value.tags),
    versions: versions(value.versions),
    status: value.status === 'online' ? 'online' : 'offline',
    online: integer(value.online, 0, MAX_COUNT) ?? 0,
    max_players: integer(value.max_players, 0, MAX_COUNT),
    rank: rank(value.rank),
    points: integer(value.points, -MAX_COUNT, MAX_COUNT) ?? 0,
    unstable: bool(value.unstable) ?? false,
    weekly_trend: integer(value.weekly_trend, -MAX_COUNT, MAX_COUNT),
    votes_month: integer(value.votes_month, 0, MAX_COUNT) ?? 0,
    icon_url: httpsUrl(value.icon_url),
    cover: isValidCover(value.cover) ? { ...value.cover } : { ...DEFAULT_COVER },
    access: access(value.access),
    is_verified: bool(value.is_verified) ?? false,
    wipe_label: line(value.wipe_label, 80),
    down_since: isoTime(value.down_since),
    topSlot: topSlot(value.top_slot),
    launch: launch(value.launch),
    site_url: httpsUrl(value.site_url) ?? '',
  };
}

export function parseServerRow(value: unknown): ServerRow | null {
  return isRecord(value) ? rowFields(value) : null;
}

function rows(value: unknown, where: string, log: ParseLog): ServerRow[] {
  const items = list(value).slice(0, MAX_ROWS);
  return items.flatMap((item, index) => {
    const row = parseServerRow(item);
    if (row === null) {
      log(`site: skipped ${where}[${String(index)}]`);
      return [];
    }
    return [row];
  });
}

export function parseServerList(value: unknown, log: ParseLog): ServerList | null {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return null;
  }
  const topSlots = isRecord(value.top_slots) ? value.top_slots : {};
  const free = isRecord(value.top_slots_free) ? value.top_slots_free : {};
  const meta = isRecord(value.meta) ? value.meta : {};
  const data = rows(value.data, 'data', log);
  const onlineTotal = integer(meta.online_total, 0, MAX_COUNT * 10);
  const updatedAt = isoTime(meta.updated_at);
  return {
    data,
    topSlots: {
      diamond: rows(topSlots.diamond, 'top_slots.diamond', log),
      gold: rows(topSlots.gold, 'top_slots.gold', log),
    },
    topSlotsFree: {
      diamond: integer(free.diamond, 0, MAX_FREE_TOP_SLOTS) ?? 0,
      gold: integer(free.gold, 0, MAX_FREE_TOP_SLOTS) ?? 0,
    },
    meta: {
      page: integer(meta.page, 1, MAX_COUNT) ?? 1,
      per_page: integer(meta.per_page, 1, MAX_ROWS) ?? data.length,
      total: integer(meta.total, 0, MAX_COUNT) ?? data.length,
      ...(onlineTotal === null ? {} : { online_total: onlineTotal }),
      ...(updatedAt === null ? {} : { updated_at: updatedAt }),
    },
  };
}

function point(value: unknown): OnlinePoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const at = isoTime(value.at);
  const online = integer(value.online, 0, MAX_COUNT);
  return at === null || online === null ? null : { at, online };
}

function links(value: unknown): ServerLinks {
  if (!isRecord(value)) {
    return {};
  }
  const entries = LINK_KEYS.flatMap((key) => {
    const url = httpsUrl(value[key]);
    return url === null ? [] : [[key, url] as const];
  });
  return Object.fromEntries(entries);
}

function outage(value: unknown): ServerCard['last_outage'] {
  if (!isRecord(value)) {
    return null;
  }
  const at = isoTime(value.at);
  const seconds = integer(value.seconds, 0, MAX_COUNT * 100);
  return at === null || seconds === null ? null : { at, seconds };
}

function votes(value: unknown): ServerCard['votes'] {
  const fields = isRecord(value) ? value : {};
  return {
    month: integer(fields.month, 0, MAX_COUNT) ?? 0,
    today: integer(fields.today, 0, MAX_COUNT) ?? 0,
  };
}

export function parseServerCard(value: unknown): ServerCard | null {
  if (!isRecord(value)) {
    return null;
  }
  const row = rowFields(value);
  if (row === null) {
    return null;
  }
  return {
    ...row,
    description_md: text(value.description_md, 20_000) ?? '',
    rules_md: text(value.rules_md, 20_000),
    links: links(value.links),
    language: line(value.language, 16),
    added_at: isoTime(value.added_at),
    uptime_30d: fraction(value.uptime_30d, 0, 1),
    uptime_90d: fraction(value.uptime_90d, 0, 1),
    chart_24h: list(value.chart_24h)
      .slice(0, MAX_CHART_POINTS)
      .flatMap((item) => {
        const parsed = point(item);
        return parsed === null ? [] : [parsed];
      }),
    peak_24h: point(value.peak_24h),
    last_outage: outage(value.last_outage),
    votes: votes(value.votes),
    ...myVote(value.my_vote),
    ...myWatch(value.my_watch),
    downtimes: downtimes(value.downtimes),
    report: serverReport(value),
  };
}

function myVote(value: unknown): Pick<ServerCard, 'my_vote'> {
  if (!isRecord(value)) {
    return {};
  }
  const raw = value.can_vote_at;
  const at = isoTime(raw);
  return at === null && raw !== null && raw !== undefined ? {} : { my_vote: { can_vote_at: at } };
}

function myWatch(value: unknown): Pick<ServerCard, 'my_watch'> {
  const watch = bool(value);
  return watch === null ? {} : { my_watch: watch };
}

const MAX_DOWNTIMES = 200;

function downtimes(value: unknown): Downtime[] {
  return list(value)
    .slice(0, MAX_DOWNTIMES)
    .flatMap((item) => {
      const from = isRecord(item) ? isoTime(item.from) : null;
      return from === null || !isRecord(item) ? [] : [{ from, to: isoTime(item.to) }];
    });
}

function myReport(value: unknown): MyReport | null {
  const at = isRecord(value) ? isoTime(value.at) : null;
  return at === null ? null : { at };
}

function serverReport(card: Fields): ServerReport | null {
  if (!('can_report' in card) && !('my_report' in card)) {
    return null;
  }
  return { mine: myReport(card.my_report), allowed: bool(card.can_report) ?? false };
}

const PERSONAL_KEYS = ['my_vote', 'my_watch', 'my_report', 'can_report'] as const;

export function withoutPersonal(body: unknown): unknown {
  if (!isRecord(body) || !PERSONAL_KEYS.some((key) => key in body)) {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !(PERSONAL_KEYS as readonly string[]).includes(key)),
  );
}

export function parseLive(value: unknown, id: number): ServerLive | null {
  if (!isRecord(value)) {
    return null;
  }
  const online = integer(value.online, 0, MAX_COUNT);
  const up = bool(value.up);
  const at = isoTime(value.at);
  if (online === null || up === null || at === null) {
    return null;
  }
  return { id, online, max: integer(value.max, 0, MAX_COUNT), up, at };
}

export function parseLiveBatch(value: unknown, log: ParseLog): ServerLive[] | null {
  const items = isRecord(value) ? value.data : value;
  if (!Array.isArray(items)) {
    return null;
  }
  return items.flatMap((item, index) => {
    const id = isRecord(item) && isValidServerId(item.id) ? item.id : null;
    const live = id === null ? null : parseLive(item, id);
    if (live === null) {
      log(`site: skipped live[${String(index)}]`);
      return [];
    }
    return [live];
  });
}

export function parseMeta(value: unknown): SiteMeta | null {
  if (!isRecord(value)) {
    return null;
  }
  const source = isRecord(value.links) ? value.links : {};
  const entries = SITE_LINK_KEYS.flatMap((key) => {
    const url = httpsUrl(source[key]);
    return url === null ? [] : [[key, url] as const];
  });
  const result: SiteLinks = Object.fromEntries(entries);
  return {
    links: result,
    connect: httpsUrl(source.connect),
    reportReasons: reportReasons(value.report_reasons),
  };
}

function reportReason(value: unknown): ReportReason | null {
  if (!isRecord(value) || !isReportReason(value.code)) {
    return null;
  }
  const label = line(value.label, MAX_REASON_LABEL)?.trim() ?? '';
  return label === '' ? null : { code: value.code, label };
}

function reportReasons(value: unknown): ReportReason[] {
  const seen = new Set<string>();
  return list(value)
    .flatMap((item) => {
      const reason = reportReason(item);
      if (reason === null || seen.has(reason.code)) {
        return [];
      }
      seen.add(reason.code);
      return [reason];
    })
    .slice(0, MAX_REPORT_REASONS);
}

function perTime<T>(
  value: unknown,
  read: (item: unknown) => T | null,
): Record<SceneTime, T> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Partial<Record<SceneTime, T>> = {};
  for (const time of SCENE_TIMES) {
    const parsed = read(value[time]);
    if (parsed === null) {
      return null;
    }
    result[time] = parsed;
  }
  return result as Record<SceneTime, T>;
}

interface SourcedLayer extends SceneLayer {
  url: string;
}

// Shorter cycles turn flash/blip layers into strobing, which is unsafe for photosensitive players.
const MIN_ANIM_SECONDS = 0.2;
const MAX_ANIM_SECONDS = 3600;
const MAX_ANIM_STEPS = 10_000;
const DEFAULT_AMPLITUDE = 2;

function direction(value: unknown): 1 | -1 | null {
  if (value === undefined) {
    return 1;
  }
  return value === 1 || value === -1 ? value : null;
}

function withDefault<T>(value: unknown, fallback: T, read: (item: unknown) => T | null): T | null {
  return value === undefined ? fallback : read(value);
}

function animation(value: unknown): LayerAnimation | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }
  const still = withDefault(value.still, 1, (item) => fraction(item, 0, 1));
  if (still === null) {
    return undefined;
  }
  const type = oneOf(value.type, LAYER_ANIMATIONS);
  const dur = fraction(value.dur, MIN_ANIM_SECONDS, MAX_ANIM_SECONDS);
  const delay = withDefault(value.delay, 0, (item) =>
    fraction(item, -MAX_ANIM_SECONDS, MAX_ANIM_SECONDS),
  );
  const amp = withDefault(value.amp, DEFAULT_AMPLITUDE, (item) => fraction(item, 0, SCENE_COLUMNS));
  const dir = direction(value.dir);
  const steps = withDefault(value.steps, 0, (item) => integer(item, 0, MAX_ANIM_STEPS));
  if (
    type === null ||
    dur === null ||
    delay === null ||
    amp === null ||
    dir === null ||
    steps === null
  ) {
    return { type: 'still', dur: 0, delay: 0, amp: DEFAULT_AMPLITUDE, dir: 1, still };
  }
  return { type, dur, delay, amp, dir, still, ...optional('steps', steps > 0 ? steps : null) };
}

function layer(value: unknown): SourcedLayer | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = typeof value.name === 'string' && LAYER_NAME_PATTERN.test(value.name);
  const depth = fraction(value.depth, 0, 2);
  const url = httpsUrl(value.url);
  return !name || depth === null || url === null
    ? null
    : { name: value.name as string, depth, url, ...optional('anim', animation(value.anim)) };
}

function sceneLayer({ name, depth, anim }: SourcedLayer): SceneLayer {
  return { name, depth, ...optional('anim', anim) };
}

function layers(value: unknown): SourcedLayer[] | null {
  const items = list(value).slice(0, MAX_LAYERS);
  const parsed = items.flatMap((item) => {
    const one = layer(item);
    return one === null ? [] : [one];
  });
  const unique = new Set(parsed.map((item) => item.name));
  return parsed.length === 0 || unique.size !== parsed.length ? null : parsed;
}

function dates(value: unknown): Scene['dates'] {
  if (!isRecord(value)) {
    return undefined;
  }
  const from = typeof value.from === 'string' && MONTH_DAY.test(value.from) ? value.from : null;
  const to = typeof value.to === 'string' && MONTH_DAY.test(value.to) ? value.to : null;
  return from === null || to === null ? undefined : { from, to };
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function clockWindow(value: unknown): Scene['time'] {
  if (!isRecord(value)) {
    return undefined;
  }
  const from = typeof value.from === 'string' && CLOCK.test(value.from) ? value.from : null;
  const to = typeof value.to === 'string' && CLOCK.test(value.to) ? value.to : null;
  return from === null || to === null ? undefined : { from, to };
}

function optional<K extends string, V>(key: K, value: V | null | undefined): Partial<Record<K, V>> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function sceneOf(value: unknown): ParsedScene | null {
  if (!isRecord(value)) {
    return null;
  }
  const key = typeof value.key === 'string' && SCENE_KEY_PATTERN.test(value.key) ? value.key : null;
  const purpose = oneOf(value.purpose, SCENE_PURPOSES);
  const skies = perTime(value.skies, (item) =>
    typeof item === 'string' && SKY.test(item) ? item : null,
  );
  const sourced = perTime(value.layers, layers);
  if (key === null || purpose === null || skies === null || sourced === null) {
    return null;
  }
  const thumbs = isRecord(value.thumbs) ? value.thumbs : {};
  const moods = list(value.moods).filter((mood) => oneOf(mood, SCENE_MOODS) !== null);
  const scene: Scene = {
    key,
    name: line(value.name, 80) ?? key,
    pack: line(value.pack, 32) ?? '',
    purpose,
    focus: fraction(value.focus, 0, 1) ?? 0.5,
    skies,
    layers: perTimeMap(sourced, (items) => items.map(sceneLayer)),
    ...optional('in_library', bool(value.in_library)),
    ...optional('hour', purpose === 'pulse' ? integer(value.hour, 0, 23) : null),
    ...optional('dates', purpose === 'holiday' ? dates(value.dates) : undefined),
    ...optional('time', purpose === 'holiday' ? clockWindow(value.time) : undefined),
    ...optional('priority', purpose === 'holiday' ? integer(value.priority, -1000, 1000) : null),
    ...optional('moods', purpose === 'mood' ? (moods as Scene['moods']) : undefined),
  };
  return {
    scene,
    sources: {
      layers: perTimeMap(sourced, (items) =>
        Object.fromEntries(items.map((item) => [item.name, item.url])),
      ),
      thumbs: {
        day: httpsUrl(thumbs.day),
        sunset: httpsUrl(thumbs.sunset),
        night: httpsUrl(thumbs.night),
      },
    },
  };
}

function perTimeMap<A, B>(
  source: Record<SceneTime, A>,
  map: (value: A) => B,
): Record<SceneTime, B> {
  return { day: map(source.day), sunset: map(source.sunset), night: map(source.night) };
}

export function parseScenes(value: unknown, log: ParseLog): ParsedScene[] | null {
  const items = isRecord(value) ? value.data : value;
  if (!Array.isArray(items)) {
    return null;
  }
  const seen = new Set<string>();
  return items.slice(0, MAX_SCENES).flatMap((item, index) => {
    const parsed = sceneOf(item);
    if (parsed === null || seen.has(parsed.scene.key)) {
      log(`site: skipped scenes[${String(index)}]`);
      return [];
    }
    seen.add(parsed.scene.key);
    return [parsed];
  });
}

export interface SiteErrorBody {
  code: string;
  message: string;
}

export function parseErrorBody(value: unknown): SiteErrorBody | null {
  if (!isRecord(value) || !isRecord(value.error)) {
    return null;
  }
  const code = line(value.error.code, 64);
  return code === null || !/^[a-z0-9_]+$/.test(code)
    ? null
    : { code, message: line(value.error.message, 500) ?? '' };
}
