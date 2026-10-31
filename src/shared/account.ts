import { isValidNick, isValidServerId } from './launch';
import type { LookChange, LookResult, WornCape, WornSkin } from './look';
import type { OwnedServerRef } from './owner';

export const LOGIN_CODE_LENGTH = 8;
export const LOGIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_LOGIN_CODE_INPUT = 32;
export const MAX_VOTE_NICK_LENGTH = 32;
export const CONNECT_TIMEOUT_MS = 5 * 60_000;
export const PLAY_CHECK_TIMEOUT_MS = 3000;
export const MAX_BAN_REASON_LENGTH = 200;

export const ACCOUNT_ERROR_CODES = [
  'encryption_unavailable',
  'connect_unavailable',
  'browser_failed',
  'loopback_failed',
  'connect_timeout',
  'connect_expired',
  'invalid_code_format',
  'invalid_code',
  'code_expired',
  'challenge_mismatch',
  'too_many_attempts',
  'unauthenticated',
  'install_mismatch',
  'forbidden',
  'not_signed_in',
  'invalid_nick',
  'vote_paused',
  'vote_busy',
  'captcha_required',
  'server_offline',
  'favorites_limit',
  'server_not_found',
  'unavailable',
  'email_unverified',
  'watches_limit',
  'server_online',
  'server_dead',
  'server_sleeping',
  'rate_limited',
  'offline',
  'timeout',
  'invalid_request',
  'invalid_response',
  'server_error',
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

export interface AccountError {
  code: AccountErrorCode;
  retryAfterS?: number;
  nextVoteAt?: string;
}

export type AccountResult<T> = { ok: true; value: T } | { ok: false; error: AccountError };

export interface PinnedNick {
  name: string | null;
  changeAt: string | null;
}

// A nickname pinned to the account. `skin` is its own; one without wears the avatar
// nickname's skin (`AccountUser.skin`).
export interface SiteNick {
  name: string;
  avatar: boolean;
  skin: WornSkin | null;
  capeId: string | null;
}

export const MAX_SITE_NICKS = 10;

export interface AccountUser {
  id: number;
  name: string;
  nick: PinnedNick | null;
  nicks: SiteNick[];
  avatarUrl: string | null;
  skin: WornSkin | null;
  cape: WornCape | null;
  createdAt: string | null;
  votesMonth: number | null;
  favoritesCount: number | null;
  hoursPlayed: number | null;
  trusted: boolean | null;
  trustedReason: string | null;
  unreadAlerts: number | null;
  ownedServers: OwnedServerRef[];
}

export type ConnectPhase = 'waiting' | 'exchanging';

export interface ConnectState {
  phase: ConnectPhase;
  expiresAt: string;
}

export interface AccountState {
  seq: number;
  encryptionAvailable: boolean;
  user: AccountUser | null;
  connect: ConnectState | null;
  error: AccountError | null;
}

export type AccountChange = 'changed' | 'signed-in' | 'signed-out' | 'expired';

export interface AccountEvent {
  change: AccountChange;
  state: AccountState;
}

export const NICK_ERROR_CODES = [
  'nick_taken',
  'invalid_nick',
  'nick_change_too_soon',
  'nick_limit',
  'avatar_nick',
  'unsupported',
  'not_signed_in',
  'offline',
  'failed',
] as const;
export type NickErrorCode = (typeof NICK_ERROR_CODES)[number];

export interface NickError {
  code: NickErrorCode;
  changeAt?: string;
}

export type NickResult = { ok: true; value: AccountState } | { ok: false; error: NickError };

export const PLAY_AUTHS = ['nick', 'microsoft'] as const;
export type PlayAuth = (typeof PLAY_AUTHS)[number];

export interface PlayCheckQuery {
  serverId: number | null;
  nick: string;
  auth: PlayAuth;
}

// `until` is the end of the ban, `forever` a ban without an end; neither means the site sent a
// term the launcher could not read, and then no term is shown at all.
export interface PlayBan {
  reason: string | null;
  until: string | null;
  forever: boolean;
}

export type PlayCheck =
  | { kind: 'ok' }
  | { kind: 'unchecked' }
  | { kind: 'nick_taken' }
  | { kind: 'nick_mismatch'; nick: string }
  | { kind: 'banned'; ban: PlayBan };

const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;

export function cleanBanReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim();
  if (text === '') {
    return null;
  }
  const letters = Array.from(text);
  return letters.length > MAX_BAN_REASON_LENGTH
    ? `${letters
        .slice(0, MAX_BAN_REASON_LENGTH - 1)
        .join('')
        .trimEnd()}…`
    : text;
}

export function sameNickLetters(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function parsePlayCheckQuery(value: unknown): PlayCheckQuery | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { serverId, nick, auth } = value as Record<string, unknown>;
  const known = serverId === null || isValidServerId(serverId);
  if (!known || typeof nick !== 'string' || !isValidNick(nick)) {
    return null;
  }
  if (auth !== 'nick' && auth !== 'microsoft') {
    return null;
  }
  return { serverId, nick, auth };
}

export interface AccountService {
  state: () => Promise<AccountState>;
  connect: () => Promise<AccountResult<AccountState>>;
  reopen: () => Promise<AccountResult<AccountState>>;
  submitCode: (code: string) => Promise<AccountResult<AccountState>>;
  cancel: () => Promise<AccountState>;
  logout: () => Promise<AccountResult<AccountState>>;
  refresh: () => Promise<AccountResult<AccountState>>;
  setNick: (nick: string) => Promise<NickResult>;
  playCheck: (query: PlayCheckQuery) => Promise<PlayCheck>;
  addSiteNick: (nick: string) => Promise<NickResult>;
  removeSiteNick: (nick: string) => Promise<NickResult>;
  setAvatarNick: (nick: string) => Promise<NickResult>;
  wear: (change: LookChange) => Promise<LookResult>;
  resetLook: (nick?: string) => Promise<LookResult>;
  onEvent: (listener: (event: AccountEvent) => void) => () => void;
}

export interface VotePause {
  serverId: number;
  canVoteAt: string;
}

export interface VoteResult {
  nextVoteAt: string;
  weight: 1 | 2;
}

const LOGIN_CODE = new RegExp(`^[${LOGIN_CODE_ALPHABET}]{${String(LOGIN_CODE_LENGTH)}}$`);

export function normalizeLoginCode(input: string): string | null {
  if (input.length > MAX_LOGIN_CODE_INPUT) {
    return null;
  }
  const code = input.replace(/[\s-]+/g, '').toUpperCase();
  return LOGIN_CODE.test(code) ? code : null;
}

export function formatLoginCode(code: string): string {
  return code.length === LOGIN_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
