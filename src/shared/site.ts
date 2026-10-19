import type { AccountResult, PlayBan, VotePause, VoteResult } from './account';
import type { AlertFeed, AlertSettings } from './alerts';
import type { LookPresets } from './look';
import type { OwnedServer, OwnedServerDetails } from './owner';
import type { ServerCard, ServerList } from './catalog';
import type { ReportDraft, ReportReason, ReportResult } from './report';
import type { Scene, SceneTime } from './scenes';
import type { SkinModTable } from './skin-mod';
import type { TelemetryPacket } from './telemetry';

export const SITE_API_BASE = 'https://mc-mon.ru/api/launcher/v1';
export const SITE_API_ENV = 'MCMONITOR_API_BASE';

export const SITE_PAGE_KEYS = [
  'terms',
  'privacy',
  'promote',
  'launcher',
  'rules',
  'about',
  'logins',
  'cabinet',
  'add_server',
] as const;
export const REPO_LINK_KEYS = ['source', 'issues'] as const;
export const SITE_LINK_KEYS = [...SITE_PAGE_KEYS, ...REPO_LINK_KEYS] as const;
export type SitePageKey = (typeof SITE_PAGE_KEYS)[number];
export type SiteLinkKey = (typeof SITE_LINK_KEYS)[number];
export type SiteLinks = Partial<Record<SiteLinkKey, string>>;

export interface SiteMeta {
  links: SiteLinks;
  connect: string | null;
  reportReasons: ReportReason[];
}

export const SERVER_SORTS = ['online', 'growth', 'new', 'rating', 'votes'] as const;
export type ServerSort = (typeof SERVER_SORTS)[number];

export const SERVER_ACCESS_FILTERS = ['all', 'license', 'nolicense'] as const;
export type ServerAccessFilter = (typeof SERVER_ACCESS_FILTERS)[number];

export const MAX_PER_PAGE = 50;
export const MAX_QUERY_LENGTH = 64;
export const MAX_LIVE_IDS = 20;

export interface ServerQuery {
  q?: string;
  version?: string;
  mode?: string[];
  access?: ServerAccessFilter;
  sort?: ServerSort;
  page?: number;
  per_page?: number;
}

export interface ServerLive {
  id: number;
  online: number;
  max: number | null;
  up: boolean;
  at: string;
}

export interface SceneFiles {
  layers: Record<string, string>;
  thumb: string | null;
}

export interface ServerPing {
  ms: number;
  online: number;
  max: number;
}

export interface TelemetryPreview {
  queued: number;
  packet: TelemetryPacket;
}

export type SiteErrorCode =
  | 'invalid-request'
  | 'offline'
  | 'timeout'
  | 'rate-limited'
  | 'not-found'
  | 'invalid-response'
  | 'server-error'
  | 'unauthorized'
  | 'blocked-host';

export interface SiteError {
  code: SiteErrorCode;
  status?: number;
  siteCode?: string;
  retryAfterS?: number;
  nextVoteAt?: string;
  reportedAt?: string;
  limit?: number;
  resetsAt?: string;
  nickChangeAt?: string;
  nick?: string;
  ban?: PlayBan;
  message?: string;
}

// `refreshing` marks an answer kept from an earlier run that the site is being asked about right
// now: it is old, but nothing says the site is out of reach.
export type SiteResult<T> =
  | { ok: true; value: T; stale: boolean; fetchedAt: string; refreshing?: boolean }
  | { ok: false; error: SiteError };

export type PingResult =
  | { ok: true; value: ServerPing }
  | { ok: false; error: { code: 'invalid-request' | 'unreachable' | 'timeout' } };

export type SiteChange =
  | {
      topic:
        | 'meta'
        | 'scenes'
        | 'skin-mod'
        | 'look-presets'
        | 'favorites'
        | 'alerts'
        | 'alert-settings'
        | 'owned-servers'
        | 'vote-pauses';
    }
  | { topic: 'servers'; query: ServerQuery }
  | { topic: 'server' | 'owned-server'; id: number }
  | { topic: 'live'; ids: number[] };

export interface SiteService {
  meta: (revalidate?: boolean) => Promise<SiteResult<SiteMeta>>;
  servers: (query: ServerQuery) => Promise<SiteResult<ServerList>>;
  server: (id: number) => Promise<SiteResult<ServerCard>>;
  live: (ids: number[]) => Promise<SiteResult<ServerLive[]>>;
  scenes: () => Promise<SiteResult<Scene[]>>;
  ensureScene: (scene: string, time: SceneTime) => Promise<SiteResult<SceneFiles>>;
  skinMod: () => Promise<SiteResult<SkinModTable>>;
  lookPresets: () => Promise<SiteResult<LookPresets>>;
  standardSkin: () => Promise<string | null>;
  ping: (address: string) => Promise<PingResult>;
  telemetryPreview: () => Promise<SiteResult<TelemetryPreview>>;
  favorites: () => Promise<AccountResult<number[]>>;
  setFavorite: (id: number, favorite: boolean) => Promise<AccountResult<boolean>>;
  vote: (id: number, nick: string) => Promise<AccountResult<VoteResult>>;
  report: (id: number, draft: ReportDraft) => Promise<ReportResult>;
  alerts: (after?: string) => Promise<AccountResult<AlertFeed>>;
  readAlerts: (ids?: number[]) => Promise<AccountResult<true>>;
  clearAlerts: () => Promise<AccountResult<true>>;
  setWatch: (id: number, watch: boolean) => Promise<AccountResult<boolean>>;
  alertSettings: () => Promise<AccountResult<AlertSettings>>;
  setAlertSettings: (settings: AlertSettings) => Promise<AccountResult<AlertSettings>>;
  ownedServers: () => Promise<AccountResult<OwnedServer[]>>;
  ownedServer: (id: number) => Promise<AccountResult<OwnedServerDetails>>;
  votePauses: () => Promise<AccountResult<VotePause[]>>;
  onChanged: (listener: (change: SiteChange) => void) => () => void;
}

export const CACHE_ORIGIN_PATH = '/cache';
export const LANDSCAPE_CACHE_PATH = `${CACHE_ORIGIN_PATH}/landscapes`;
export const ICON_CACHE_PATH = `${CACHE_ORIGIN_PATH}/icons`;
