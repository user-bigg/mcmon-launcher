import { ACCOUNT_ID_PATTERN, isValidNick } from './launch';

export const MAX_NICK_ACCOUNTS = 32;

export interface NickRecord {
  id: string;
  nick: string;
}

export const MC_MONITOR_PLAYER_ID = 'mc-monitor';

export type ActivePlayer =
  | { kind: 'nick'; id: string }
  | { kind: 'microsoft'; id: string }
  | { kind: 'mc-monitor'; id: typeof MC_MONITOR_PLAYER_ID };

// `picked` is set once the player chooses a row in the account list; before that a player
// signed in to MC Monitor plays under the pinned nickname, as earlier versions did.
export interface StoredPlayers {
  nicks: NickRecord[];
  active: ActivePlayer | null;
  picked?: boolean;
}

export type PlayersResult =
  | { ok: true; value: StoredPlayers }
  | { ok: false; error: { code: 'invalid-request' } | { code: 'failed' } };

export interface PlayersService {
  get: () => Promise<PlayersResult>;
  save: (players: StoredPlayers) => Promise<PlayersResult>;
}

export const EMPTY_PLAYERS: Readonly<StoredPlayers> = { nicks: [], active: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNick(value: unknown): NickRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, nick } = value;
  if (typeof id !== 'string' || !ACCOUNT_ID_PATTERN.test(id)) {
    return null;
  }
  if (typeof nick !== 'string' || !isValidNick(nick)) {
    return null;
  }
  return { id, nick };
}

function uniqueById(records: NickRecord[]): NickRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) {
      return false;
    }
    seen.add(record.id);
    return true;
  });
}

function activeOf(value: unknown, nicks: NickRecord[]): ActivePlayer | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }
  const { kind, id } = value;
  if (kind === 'nick') {
    return nicks.some((record) => record.id === id) ? { kind, id } : null;
  }
  if (kind === 'mc-monitor') {
    return id === MC_MONITOR_PLAYER_ID ? { kind, id } : null;
  }
  return kind === 'microsoft' && ACCOUNT_ID_PATTERN.test(id) ? { kind, id } : null;
}

export function parsePlayers(value: unknown): StoredPlayers | null {
  if (!isRecord(value) || !Array.isArray(value.nicks) || value.nicks.length > MAX_NICK_ACCOUNTS) {
    return null;
  }
  const parsed = value.nicks.map(parseNick);
  if (parsed.some((record) => record === null)) {
    return null;
  }
  const nicks = parsed as NickRecord[];
  if (uniqueById(nicks).length !== nicks.length) {
    return null;
  }
  const active = activeOf(value.active, nicks);
  if (value.active !== null && active === null) {
    return null;
  }
  return { nicks, active, ...(value.picked === true ? { picked: true } : {}) };
}

export function normalizePlayers(value: unknown): StoredPlayers {
  const source = isRecord(value) ? value : {};
  const list = Array.isArray(source.nicks) ? source.nicks : [];
  const nicks = uniqueById(
    list.map(parseNick).filter((record): record is NickRecord => record !== null),
  ).slice(0, MAX_NICK_ACCOUNTS);
  // Files written before Microsoft accounts kept the active nickname as a bare id.
  const stored =
    typeof source.activeId === 'string' ? { kind: 'nick', id: source.activeId } : source.active;
  return {
    nicks,
    active: activeOf(stored, nicks),
    ...(source.picked === true ? { picked: true } : {}),
  };
}
