import type { AlertItem } from './alerts';
import type { TopSlotTier } from './catalog';

export const OWNED_STATUSES = ['up', 'down'] as const;
export type OwnedStatus = (typeof OWNED_STATUSES)[number];

export const MAX_OWNED_SERVERS = 50;
export const MAX_OWNED_EVENTS = 20;

export interface OwnedServerRef {
  id: number;
  name: string;
  status: OwnedStatus;
}

export interface OwnedAttention {
  kind: string;
  at: string;
  title: string;
  tier?: TopSlotTier;
}

export interface OwnedTopSlot {
  tier: TopSlotTier;
  endsAt: string;
}

export interface OwnedServer extends OwnedServerRef {
  downSince: string | null;
  online: number | null;
  slots: number | null;
  version: string | null;
  checkedAt: string | null;
  rank: number | null;
  rankWeekAgo: number | null;
  votesMonth: number | null;
  points: number | null;
  pointsExpireAt: string | null;
  uptime30d: number | null;
  attention: OwnedAttention | null;
  topSlot: OwnedTopSlot | null;
}

export interface OwnedPeak {
  value: number;
  at: string;
}

export interface OwnedSources {
  launcherLaunches: number;
  addressCopies: number;
  siteClicks: number;
  widgetVotes: number | null;
}

export interface OwnedCount {
  total: number;
  fresh: number;
}

export interface OwnedServerDetails extends OwnedServer {
  onlineAvgDay: number | null;
  onlineAvgPrevDay: number | null;
  onlinePeakDay: OwnedPeak | null;
  downtimes30d: number | null;
  votesMonthChange: number | null;
  sources7d: OwnedSources | null;
  votifier: { ok: boolean; lastErrorAt: string | null } | null;
  reviews: OwnedCount | null;
  complaints: OwnedCount | null;
  events: AlertItem[];
}
