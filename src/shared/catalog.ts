import type { ServerMods } from './mods';
import type { ServerReport } from './report';
import type { ServerAddress } from './server-address';

export type { ServerAddress };

export type Edition = 'java' | 'bedrock';
export type ServerStatus = 'online' | 'offline';
export const TOP_SLOT_TIERS = ['diamond', 'gold'] as const;
export type TopSlotTier = (typeof TOP_SLOT_TIERS)[number];
export type CoverTime = 'day' | 'sunset' | 'night' | 'auto';

export interface VersionRange {
  from: string;
  to: string;
}

export interface ServerCover {
  scene: string;
  time: CoverTime;
}

export interface ServerAccess {
  license: boolean;
  nick: boolean;
}

export interface TopSlot {
  tier: TopSlotTier;
}

export interface DirectLaunch {
  kind: 'direct';
  minecraft: string;
  skins?: boolean;
  modpack?: boolean;
  mods?: ServerMods;
  modsUnreadable?: true;
}

export interface OwnLauncher {
  kind: 'own_launcher';
  url: string;
  label: string;
}

export interface NoLaunch {
  kind: 'none';
}

export type ServerLaunch = DirectLaunch | OwnLauncher | NoLaunch;
export type LaunchKind = ServerLaunch['kind'];

// Where the site reached the server at its last check: only for the launcher's own ping,
// never for the game's connection.
export interface PingTarget {
  ip: string;
  port: number;
  checkedAt: string;
}

export interface ServerRow {
  id: number;
  slug: string;
  name: string;
  address: ServerAddress;
  edition: Edition;
  description: string;
  tags: string[];
  versions: VersionRange | null;
  status: ServerStatus;
  online: number;
  max_players: number | null;
  rank: number | null;
  points: number;
  unstable: boolean;
  weekly_trend: number | null;
  votes_month: number;
  icon_url: string | null;
  cover: ServerCover;
  access: ServerAccess;
  is_verified: boolean;
  wipe_label: string | null;
  down_since?: string | null;
  topSlot: TopSlot | null;
  launch: ServerLaunch;
  site_url: string;
  pingTarget?: PingTarget | null;
}

export interface ServerListMeta {
  page: number;
  per_page: number;
  total: number;
  online_total?: number;
  updated_at?: string;
}

export interface ServerList {
  data: ServerRow[];
  topSlots: Record<TopSlotTier, ServerRow[]>;
  topSlotsFree: Record<TopSlotTier, number>;
  meta: ServerListMeta;
}

export interface OnlinePoint {
  at: string;
  online: number;
}

export interface ServerLinks {
  site?: string;
  discord?: string;
  telegram?: string;
  vk?: string;
  youtube?: string;
  tiktok?: string;
}

export interface ServerCard extends ServerRow {
  description_md: string;
  rules_md: string | null;
  links: ServerLinks;
  language: string | null;
  added_at: string | null;
  uptime_30d: number | null;
  uptime_90d: number | null;
  chart_24h: OnlinePoint[];
  peak_24h: OnlinePoint | null;
  last_outage: { at: string; seconds: number } | null;
  votes: { month: number; today: number };
  my_vote?: MyVote;
  my_watch?: boolean;
  downtimes: Downtime[];
  report: ServerReport | null;
}

export interface Downtime {
  from: string;
  to: string | null;
}

export interface MyVote {
  can_vote_at: string | null;
}
