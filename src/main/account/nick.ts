import type { NickError, PlayBan, PlayCheck } from '@shared/account';
import type { SiteError } from '@shared/site';
import type { Sent } from '../site/http';
import type { PlayAllowed } from './parse';

const UNREAD_BAN: PlayBan = { reason: null, until: null, forever: false };

function routeMissing(error: SiteError): boolean {
  return error.status === 404 || error.status === 405;
}

function unreachable(error: SiteError): boolean {
  return error.code === 'offline' || error.code === 'timeout';
}

export function nickError(error: SiteError): NickError {
  if (error.siteCode === 'nick_taken' || error.siteCode === 'invalid_nick') {
    return { code: error.siteCode };
  }
  if (error.siteCode === 'nick_change_too_soon') {
    return {
      code: 'nick_change_too_soon',
      ...(error.nickChangeAt === undefined ? {} : { changeAt: error.nickChangeAt }),
    };
  }
  if (routeMissing(error)) {
    return { code: 'unsupported' };
  }
  return { code: unreachable(error) ? 'offline' : 'failed' };
}

export interface CheckedPlay {
  check: PlayCheck;
  code: string | null;
}

// Anything the site did not say clearly lets the game start: a broken or old site must not
// keep the player out.
export function playCheckOf(sent: Sent<PlayAllowed>): CheckedPlay {
  if (sent.ok) {
    return { check: { kind: 'ok' }, code: sent.value.code };
  }
  return { check: refusalOf(sent.error), code: null };
}

function refusalOf(error: SiteError): PlayCheck {
  const { status, siteCode, nick, ban } = error;
  if (status === 409 && siteCode === 'nick_taken') {
    return { kind: 'nick_taken' };
  }
  if (status === 409 && siteCode === 'nick_mismatch' && nick !== undefined) {
    return { kind: 'nick_mismatch', nick };
  }
  if (status === 403 && siteCode === 'banned') {
    return { kind: 'banned', ban: ban ?? UNREAD_BAN };
  }
  return { kind: 'unchecked' };
}
