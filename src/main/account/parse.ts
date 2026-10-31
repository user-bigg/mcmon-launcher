import {
  MAX_SITE_NICKS,
  type PinnedNick,
  type SiteNick,
  type VotePause,
  type VoteResult,
} from '@shared/account';
import {
  MAX_ALERT_CURSOR_LENGTH,
  MAX_ALERT_ID,
  MAX_ALERT_ITEMS,
  MAX_ALERT_TITLE_LENGTH,
  PLAYER_ALERT_KINDS,
  type AlertFeed,
  type AlertItem,
  type AlertServer,
  type AlertSettings,
} from '@shared/alerts';
import { TOP_SLOT_TIERS, type TopSlotTier } from '@shared/catalog';
import {
  MAX_OWNED_EVENTS,
  MAX_OWNED_SERVERS,
  OWNED_STATUSES,
  type OwnedAttention,
  type OwnedCount,
  type OwnedServer,
  type OwnedServerDetails,
  type OwnedServerRef,
  type OwnedSources,
  type OwnedTopSlot,
} from '@shared/owner';
import { isValidNick, isValidServerId } from '@shared/launch';
import { isPresetId, type WornCape, type WornSkin } from '@shared/look';
import type { MyReport } from '@shared/report';
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
  type Fields,
} from '../site/guards';
import { wornCape, wornSkin, type LocalTexture } from '../site/look';

export interface SessionUser {
  id: number;
  name: string;
  avatarUrl: string | null;
}

export interface Profile extends SessionUser {
  nick: PinnedNick | null;
  nicks: SiteNick[];
  skin: WornSkin | null;
  cape: WornCape | null;
  createdAt: string | null;
  votesMonth: number;
  favoritesCount: number;
  hoursPlayed: number | null;
  trusted: boolean;
  trustedReason: string | null;
  unreadAlerts: number;
  ownedServers: OwnedServerRef[];
}

export interface IssuedToken {
  token: string;
  expiresAt: string | null;
  user: SessionUser;
}

const MAX_NAME_LENGTH = 255;
const MAX_REASON_LENGTH = 200;
const MAX_COUNT = 10_000_000;
const MAX_USER_ID = Number.MAX_SAFE_INTEGER;
const MAX_FAVORITES = 1000;

const TOKEN = /^\d{1,20}\|[A-Za-z0-9_]{16,256}$/;

export function isLauncherToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

export function parseSessionUser(value: unknown): SessionUser | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = integer(value.id, 1, MAX_USER_ID);
  const name = line(value.name, MAX_NAME_LENGTH);
  if (id === null || name === null || name.trim() === '') {
    return null;
  }
  return { id, name, avatarUrl: httpsUrl(value.avatar_url) };
}

export function parseIssuedToken(value: unknown): IssuedToken | null {
  if (!isRecord(value) || !isLauncherToken(value.token)) {
    return null;
  }
  const user = parseSessionUser(value.user);
  return user === null ? null : { token: value.token, expiresAt: isoTime(value.expires_at), user };
}

export function sessionUserBody(user: SessionUser): Record<string, unknown> {
  return { id: user.id, name: user.name, avatar_url: user.avatarUrl };
}

function nickName(value: unknown): string | null {
  return typeof value === 'string' && isValidNick(value) ? value : null;
}

// A site that has not shipped pinned nicknames sends no 'nick' field at all; null means the
// player has not picked one yet.
export function parsePinnedNick(value: unknown): PinnedNick | null {
  if (!isRecord(value) || !('nick' in value)) {
    return null;
  }
  return { name: nickName(value.nick), changeAt: isoTime(value.nick_change_at) };
}

export function parseNickChange(value: unknown): PinnedNick | null {
  const pinned = parsePinnedNick(value);
  return pinned?.name == null ? null : pinned;
}

export interface PlayAllowed {
  code: string | null;
}

const PLAY_CODE = /^[\x21-\x7e]{32}$/;

// A code that is not what the site API promises is no code: the game starts unconfirmed.
export function parsePlayAllowed(value: unknown): PlayAllowed | null {
  if (!isRecord(value) || value.ok !== true) {
    return null;
  }
  const code = value.play_code;
  return { code: typeof code === 'string' && PLAY_CODE.test(code) ? code : null };
}

const SAME_ADDRESS: LocalTexture = (remote) => remote;

function siteNick(value: unknown, local: LocalTexture): SiteNick | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = nickName(value.name);
  if (name === null) {
    return null;
  }
  const cape = value.cape;
  return {
    name,
    avatar: value.avatar === true,
    skin: wornSkin(value.skin, local),
    capeId: typeof cape === 'string' && isPresetId(cape) ? cape : null,
  };
}

// The avatar nickname goes first, as the site sends it; an older site sends no list.
export function siteNicks(value: unknown, local: LocalTexture = SAME_ADDRESS): SiteNick[] {
  const nicks = each(value, MAX_SITE_NICKS, (item) => siteNick(item, local));
  const seen = new Set<string>();
  return nicks.filter((item) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function parseSiteNick(value: unknown): SiteNick | null {
  return siteNick(value, SAME_ADDRESS);
}

export function parseProfile(value: unknown, local: LocalTexture = SAME_ADDRESS): Profile | null {
  const user = parseSessionUser(value);
  if (user === null || !isRecord(value)) {
    return null;
  }
  const trusted = bool(value.trusted);
  if (trusted === null) {
    return null;
  }
  return {
    ...user,
    nick: parsePinnedNick(value),
    nicks: siteNicks(value.nicks, local),
    skin: wornSkin(value.skin, local),
    cape: wornCape(value.cape, local),
    createdAt: isoTime(value.created_at),
    votesMonth: integer(value.votes_month, 0, MAX_COUNT) ?? 0,
    favoritesCount: integer(value.favorites_count, 0, MAX_COUNT) ?? 0,
    hoursPlayed: integer(value.hours_played, 0, MAX_COUNT),
    trusted,
    trustedReason: trusted ? null : line(value.trusted_reason, MAX_REASON_LENGTH),
    unreadAlerts: integer(value.unread_alerts, 0, MAX_COUNT) ?? 0,
    ownedServers: each(value.owned_servers, MAX_OWNED_SERVERS, ownedRef),
  };
}

export function parseFavoriteIds(value: unknown): number[] | null {
  if (!isRecord(value) || !Array.isArray(value.ids)) {
    return null;
  }
  const ids = list(value.ids).filter((id): id is number => isValidServerId(id));
  return [...new Set(ids)].slice(0, MAX_FAVORITES);
}

export function parseFavoriteFlag(value: unknown): boolean | null {
  return isRecord(value) ? bool(value.favorite) : null;
}

export function parseVoteResult(value: unknown): VoteResult | null {
  if (!isRecord(value) || value.ok !== true) {
    return null;
  }
  const nextVoteAt = isoTime(value.next_vote_at);
  const weight = value.weight === 2 ? 2 : value.weight === 1 ? 1 : null;
  return nextVoteAt === null || weight === null ? null : { nextVoteAt, weight };
}

export function parseReportResult(value: unknown): MyReport | null {
  const mine = isRecord(value) && isRecord(value.my_report) ? value.my_report : null;
  const at = mine === null ? null : isoTime(mine.at);
  return at === null ? null : { at };
}

export function parseEmpty(): true {
  return true;
}

const MAX_KIND_LENGTH = 64;
const MAX_VERSION_LENGTH = 64;
const MAX_PERCENT = 100_000;

function each<T>(value: unknown, max: number, parse: (item: unknown) => T | null): T[] {
  return list(value)
    .slice(0, max)
    .flatMap((item) => {
      const parsed = parse(item);
      return parsed === null ? [] : [parsed];
    });
}

function count(value: unknown): number | null {
  return integer(value, 0, MAX_COUNT);
}

function rounded(value: unknown): number | null {
  const parsed = fraction(value, 0, MAX_COUNT);
  return parsed === null ? null : Math.round(parsed);
}

function text(value: unknown): string | null {
  const parsed = line(value, MAX_ALERT_TITLE_LENGTH);
  return parsed === null || parsed.trim() === '' ? null : parsed.trim();
}

function title(payload: unknown): string | null {
  return isRecord(payload) ? text(payload.title) : null;
}

function ownerTitle(payload: unknown): string | null {
  return isRecord(payload) ? (text(payload.short) ?? text(payload.title)) : null;
}

function alertServer(value: unknown): AlertServer | null {
  if (!isRecord(value) || !isValidServerId(value.id)) {
    return null;
  }
  const name = line(value.name, MAX_NAME_LENGTH);
  return name === null || name.trim() === '' ? null : { id: value.id, name };
}

function payloadTier(payload: unknown): { tier?: TopSlotTier } {
  const tier = isRecord(payload) ? oneOf(payload.tier, TOP_SLOT_TIERS) : null;
  return tier === null ? {} : { tier };
}

function alertItem(value: unknown, titleOf: typeof title = title): AlertItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = integer(value.id, 1, MAX_ALERT_ID);
  const kind = line(value.kind, MAX_KIND_LENGTH);
  const at = isoTime(value.at);
  const text = titleOf(value.payload);
  if (id === null || kind === null || at === null || text === null) {
    return null;
  }
  return {
    id,
    kind,
    server: alertServer(value.server),
    at,
    read: bool(value.read) ?? false,
    title: text,
    ...payloadTier(value.payload),
  };
}

export function parseAlertFeed(value: unknown): AlertFeed | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  const items = each(value.items, MAX_ALERT_ITEMS, alertItem);
  const cursor = line(value.next, MAX_ALERT_CURSOR_LENGTH);
  return {
    items,
    unread: count(value.unread) ?? items.filter((item) => !item.read).length,
    next: cursor === null || cursor === '' ? null : cursor,
  };
}

export function parseAlertSettings(value: unknown): AlertSettings | null {
  if (!isRecord(value)) {
    return null;
  }
  const flags = PLAYER_ALERT_KINDS.map((kind) => bool(value[kind]) ?? true);
  return {
    favorite_wipe: flags[0] ?? true,
    watched_up: flags[1] ?? true,
    server_removed: flags[2] ?? true,
  };
}

export function parseWatchFlag(value: unknown): boolean | null {
  return isRecord(value) ? bool(value.watch) : null;
}

function ownedRef(value: unknown): OwnedServerRef | null {
  if (!isRecord(value) || !isValidServerId(value.id)) {
    return null;
  }
  const name = line(value.name, MAX_NAME_LENGTH);
  return name === null || name.trim() === ''
    ? null
    : { id: value.id, name, status: oneOf(value.status, OWNED_STATUSES) ?? 'down' };
}

function attention(value: unknown): OwnedAttention | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = line(value.kind, MAX_KIND_LENGTH);
  const at = isoTime(value.at);
  const text = ownerTitle(value.payload);
  return kind === null || at === null || text === null
    ? null
    : { kind, at, title: text, ...payloadTier(value.payload) };
}

function ownedTopSlot(value: unknown): OwnedTopSlot | null {
  if (!isRecord(value)) {
    return null;
  }
  const tier = oneOf(value.tier, TOP_SLOT_TIERS);
  const endsAt = isoTime(value.ends_at);
  return tier === null || endsAt === null ? null : { tier, endsAt };
}

function ownedServer(value: unknown): OwnedServer | null {
  const ref = ownedRef(value);
  if (ref === null || !isRecord(value)) {
    return null;
  }
  return {
    ...ref,
    downSince: isoTime(value.down_since),
    online: count(value.online),
    slots: count(value.slots),
    version: line(value.version, MAX_VERSION_LENGTH),
    checkedAt: isoTime(value.checked_at),
    rank: integer(value.rank, 1, MAX_COUNT),
    rankWeekAgo: integer(value.rank_week_ago, 1, MAX_COUNT),
    votesMonth: count(value.votes_month),
    points: count(value.points),
    pointsExpireAt: isoTime(value.points_expire_at),
    uptime30d: fraction(value.uptime_30d, 0, 1),
    attention: attention(value.attention),
    topSlot: ownedTopSlot(value.top_slot),
  };
}

export function parseOwnedServers(value: unknown): OwnedServer[] | null {
  return isRecord(value) && Array.isArray(value.items)
    ? each(value.items, MAX_OWNED_SERVERS, ownedServer)
    : null;
}

function ownedCount(value: unknown): OwnedCount | null {
  const total = isRecord(value) ? count(value.total) : null;
  return total === null || !isRecord(value) ? null : { total, fresh: count(value.new) ?? 0 };
}

function sources(value: unknown): OwnedSources | null {
  if (!isRecord(value)) {
    return null;
  }
  const fields: Fields = value;
  return {
    launcherLaunches: count(fields.launcher_launches) ?? 0,
    addressCopies: count(fields.address_copies) ?? 0,
    siteClicks: count(fields.site_clicks) ?? 0,
    widgetVotes: count(fields.widget_votes),
  };
}

function peak(value: unknown): OwnedServerDetails['onlinePeakDay'] {
  const top = isRecord(value) ? count(value.online) : null;
  const at = isRecord(value) ? isoTime(value.at) : null;
  return top === null || at === null ? null : { value: top, at };
}

function votifier(value: unknown): OwnedServerDetails['votifier'] {
  const ok = isRecord(value) ? bool(value.ok) : null;
  return ok === null || !isRecord(value) ? null : { ok, lastErrorAt: isoTime(value.last_error_at) };
}

export function parseOwnedServer(value: unknown): OwnedServerDetails | null {
  const server = ownedServer(value);
  if (server === null || !isRecord(value)) {
    return null;
  }
  return {
    ...server,
    onlineAvgDay: rounded(value.online_avg_day),
    onlineAvgPrevDay: rounded(value.online_avg_prev_day),
    onlinePeakDay: peak(value.online_peak_day),
    downtimes30d: count(value.downtimes_30d),
    votesMonthChange: integer(value.votes_month_change, -100, MAX_PERCENT),
    sources7d: sources(value.sources_7d),
    votifier: votifier(value.votifier),
    reviews: ownedCount(value.reviews),
    complaints: ownedCount(value.complaints),
    events: each(value.events, MAX_OWNED_EVENTS, (item) => alertItem(item, ownerTitle)),
  };
}

const MAX_VOTE_PAUSES = 500;

function votePause(value: unknown): VotePause | null {
  if (!isRecord(value) || !isValidServerId(value.server_id)) {
    return null;
  }
  const canVoteAt = isoTime(value.can_vote_at);
  return canVoteAt === null ? null : { serverId: value.server_id, canVoteAt };
}

export function parseVotePauses(value: unknown): VotePause[] | null {
  return isRecord(value) && Array.isArray(value.items)
    ? each(value.items, MAX_VOTE_PAUSES, votePause)
    : null;
}
