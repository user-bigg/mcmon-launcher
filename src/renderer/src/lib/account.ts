import type {
  AccountError,
  AccountErrorCode,
  AccountUser,
  NickError,
  PinnedNick,
} from '@shared/account';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { moscowDate, moscowTime } from './time';

// A site without pinned nicknames gives nothing but its display name.
export function accountTitle(user: AccountUser): string {
  return user.nick === null ? user.name : (user.nick.name ?? ru.accounts.nickMissing);
}

export function nickErrorText(error: NickError): string {
  switch (error.code) {
    case 'nick_taken':
      return ru.accounts.nickErrors.taken;
    case 'invalid_nick':
      return ru.welcome.nickError;
    case 'nick_change_too_soon':
      return error.changeAt === undefined
        ? ru.accounts.nickErrors.tooSoonLater
        : fill(ru.accounts.nickErrors.tooSoon, { date: moscowDate(error.changeAt) });
    case 'offline':
      return ru.accounts.nickErrors.offline;
    default:
      return ru.accounts.nickErrors.failed;
  }
}

export function nickChangeFrom(pinned: PinnedNick | null, now: Date): string | null {
  const at = pinned?.changeAt ?? null;
  return at !== null && Date.parse(at) > now.getTime() ? at : null;
}

export function accountErrorText(error: AccountError): string {
  if (error.code === 'vote_paused' && error.nextVoteAt === undefined) {
    return ru.account.errors.vote_paused_later;
  }
  const text = ru.account.errors[error.code];
  return error.nextVoteAt === undefined ? text : fill(text, { time: moscowTime(error.nextVoteAt) });
}

export function countdown(seconds: number): string {
  const rest = String(seconds % 60).padStart(2, '0');
  return `${String(Math.floor(seconds / 60))}:${rest}`;
}

export interface LoginErrorView {
  title: string;
  text: string;
}

type ConnectFailure = keyof typeof ru.welcome.errors;

const CONNECT_FAILURES: Partial<Record<AccountErrorCode, ConnectFailure>> = {
  connect_timeout: 'timeout',
  connect_expired: 'timeout',
  browser_failed: 'browser',
  connect_unavailable: 'offline',
  offline: 'offline',
  timeout: 'offline',
};

export function connectErrorView(error: AccountError): LoginErrorView {
  return ru.welcome.errors[CONNECT_FAILURES[error.code] ?? 'failed'];
}

type CodeFailure = keyof typeof ru.welcome.codeErrors;

const CODE_FAILURES: Partial<Record<AccountErrorCode, CodeFailure>> = {
  invalid_code_format: 'format',
  invalid_code: 'invalid',
  code_expired: 'expired',
};

export function codeErrorText(error: AccountError): string {
  return ru.welcome.codeErrors[CODE_FAILURES[error.code] ?? 'failed'];
}

export function remainingSeconds(until: string | null, now: Date): number {
  if (until === null) {
    return 0;
  }
  return Math.max(0, Math.ceil((Date.parse(until) - now.getTime()) / 1000));
}
