import { ru } from './i18n/ru';
import { ACCOUNT_ID_PATTERN } from './launch';

export const MICROSOFT_LOGIN_TIMEOUT_MS = 5 * 60_000;
export const MAX_MICROSOFT_ACCOUNTS = 16;

export type MicrosoftErrorCode =
  | 'unavailable'
  | 'encryption_unavailable'
  | 'storage_failed'
  | 'port_busy'
  | 'browser_failed'
  | 'cancelled'
  | 'timeout'
  | 'state_mismatch'
  | 'no_xbox_profile'
  | 'xbox_region'
  | 'xbox_adult_required'
  | 'xbox_child'
  | 'xbox_failed'
  | 'app_not_approved'
  | 'not_owned'
  | 'no_profile'
  | 'relogin_required'
  | 'offline'
  | 'not_found'
  | 'accounts_limit'
  | 'invalid_request'
  | 'forbidden'
  | 'failed';

export interface MicrosoftError {
  code: MicrosoftErrorCode;
}

export type MicrosoftResult<T> = { ok: true; value: T } | { ok: false; error: MicrosoftError };

export type MicrosoftAccountStatus = 'ready' | 'needs-login';

export interface MicrosoftAccount {
  id: string;
  nick: string;
  uuid: string;
  status: MicrosoftAccountStatus;
}

export type MicrosoftLoginState = { phase: 'waiting'; expiresAt: string } | { phase: 'exchanging' };

export interface MicrosoftState {
  seq: number;
  available: boolean;
  encryptionAvailable: boolean;
  accounts: MicrosoftAccount[];
  login: MicrosoftLoginState | null;
  error: MicrosoftError | null;
}

export type MicrosoftChange = 'changed' | 'signed-in' | 'removed' | 'expired' | 'failed';

export interface MicrosoftEvent {
  change: MicrosoftChange;
  accountId: string | null;
  state: MicrosoftState;
}

export interface MicrosoftService {
  state: () => Promise<MicrosoftState>;
  login: () => Promise<MicrosoftResult<MicrosoftState>>;
  reopen: () => Promise<MicrosoftResult<MicrosoftState>>;
  cancel: () => Promise<MicrosoftState>;
  remove: (id: string) => Promise<MicrosoftResult<MicrosoftState>>;
  onEvent: (listener: (event: MicrosoftEvent) => void) => () => void;
}

export interface MicrosoftErrorView {
  title: string;
  text: string;
}

export function microsoftErrorView(code: MicrosoftErrorCode): MicrosoftErrorView {
  return ru.microsoft.errors[code];
}

export function isMicrosoftAccountId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value);
}
