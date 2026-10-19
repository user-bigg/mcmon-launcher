import type { TopSlotTier } from './catalog';
export const PLAYER_ALERT_KINDS = ['favorite_wipe', 'watched_up', 'server_removed'] as const;
export type PlayerAlertKind = (typeof PLAYER_ALERT_KINDS)[number];
export type AlertSettings = Record<PlayerAlertKind, boolean>;

export const MAX_ALERT_ITEMS = 50;
export const MAX_ALERT_ID = Number.MAX_SAFE_INTEGER;
export const MAX_ALERT_TITLE_LENGTH = 200;
export const MAX_ALERT_CURSOR_LENGTH = 128;
export const ALERT_POLL_MS = 5 * 60_000;

export interface AlertServer {
  id: number;
  name: string;
}

export interface AlertItem {
  id: number;
  kind: string;
  server: AlertServer | null;
  at: string;
  read: boolean;
  title: string;
  tier?: TopSlotTier;
}

export interface AlertFeed {
  items: AlertItem[];
  unread: number;
  next: string | null;
}
