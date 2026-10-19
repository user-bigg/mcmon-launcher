import { cleanBanReason, type PlayBan } from '@shared/account';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { moscowDate, moscowDateWithYear, moscowYear } from './time';

export interface BanView {
  title: string;
  term: string | null;
  note: string;
  action: string;
}

export function banExpired(ban: PlayBan, now: Date = new Date()): boolean {
  return ban.until !== null && Date.parse(ban.until) <= now.getTime();
}

// A term the launcher could not read is not shown: 'forever' is said only when the site said it.
function termText({ until, forever }: PlayBan, now: Date): string | null {
  if (until === null || Number.isNaN(Date.parse(until))) {
    return forever ? ru.ban.forever : null;
  }
  const sameYear = moscowYear(until, now) === moscowYear(null, now);
  return fill(ru.ban.until, { date: sameYear ? moscowDate(until) : moscowDateWithYear(until) });
}

function reasonText(reason: string | null): string | null {
  const clean = cleanBanReason(reason);
  if (clean === null) {
    return null;
  }
  return fill(ru.ban.reason, { reason: /[.!?…]$/.test(clean) ? clean : `${clean}.` });
}

export function banView(ban: PlayBan, server: string, now: Date = new Date()): BanView {
  const reason = reasonText(ban.reason);
  const term = termText(ban, now);
  const lines = [term, reason].filter((line) => line !== null);
  return {
    title: fill(ru.ban.title, { server }),
    term: lines.length === 0 ? null : lines.join(' '),
    note: ru.ban.note,
    action: ru.ban.action,
  };
}
