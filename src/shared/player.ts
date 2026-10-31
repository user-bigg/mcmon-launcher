import type { ServerCover } from './catalog';

export type AccountProvider = 'microsoft' | 'nick' | 'mc-monitor';

export interface GameAccount {
  id: string;
  name: string;
  provider: AccountProvider;
  head: string;
  skin: string | null;
}

export interface RecentPlay {
  serverId: number;
  playedAt: string;
  durationSeconds: number;
}

export interface LibraryEntry {
  id: string;
  name: string;
  serverId: number;
  minecraft: string;
  lastPlayedAt: string | null;
  sizeBytes: number;
  iconUrl: string | null;
  cover: ServerCover | null;
}

export interface StorageSummary {
  path: string;
  usedBytes: number;
  freeBytes: number;
  serversBytes: number;
  sharedBytes: number;
  savedBytes: number;
}

export interface PingSample {
  ms: number | null;
}

export interface InstallEstimate {
  downloadBytes: number;
  cachedBytes: number;
}
