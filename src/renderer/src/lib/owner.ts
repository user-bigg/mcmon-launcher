import type { AccountError } from '@shared/account';
import type { Downtime } from '@shared/catalog';
import { countOf, fill, formatDecimal, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { TopSlotTier } from '@shared/catalog';
import type { OwnedServer, OwnedServerRef } from '@shared/owner';
import type { SiteError } from '@shared/site';
import type { IconName } from '../components/icons';
import { duration, moscowDate, moscowTime, sameMoscowDay } from './time';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type EventTone = 'ok' | 'bad' | 'gold' | 'muted';

export interface EventMark {
  icon: IconName;
  tone: EventTone;
  slot?: true;
}

const EVENT_MARKS: Partial<Record<string, EventMark>> = {
  down: { icon: 'x-circle', tone: 'bad' },
  up: { icon: 'check-circle', tone: 'ok' },
  rank_drop: { icon: 'arrow-down-right', tone: 'muted' },
  points_expire: { icon: 'hourglass-split', tone: 'gold' },
  top_slot_expire: { icon: 'info-circle', tone: 'gold', slot: true },
};

const OTHER_EVENT: EventMark = { icon: 'info-circle', tone: 'muted' };

function isDate(at: string): boolean {
  return !Number.isNaN(Date.parse(at));
}

export function figure(value: number | null): string {
  return value === null ? ru.owner.empty : formatNumber(value);
}

export function percentText(share: number | null): string {
  return share === null
    ? ru.owner.empty
    : fill(ru.owner.percent, { value: formatDecimal(share * 100) });
}

export function changeText(change: number | null): string | null {
  if (change === null) {
    return null;
  }
  const value = formatDecimal(Math.abs(change));
  if (change > 0) {
    return fill(ru.owner.stats.changeUp, { value });
  }
  return change < 0 ? fill(ru.owner.stats.changeDown, { value }) : ru.owner.stats.changeNone;
}

export function downtimesText(count: number | null): string | null {
  if (count === null) {
    return null;
  }
  return count === 0 ? ru.owner.stats.noDowntimes : countOf(count, ru.owner.stats.downtimes);
}

export function sinceText(at: string, now: Date): string {
  const time = moscowTime(at);
  return sameMoscowDay(at, now) ? time : fill(ru.owner.sinceDay, { day: moscowDate(at), time });
}

export function downSince(server: Pick<OwnedServer, 'downSince'>, now: Date): string | null {
  const at = server.downSince;
  return at === null || !isDate(at) ? null : sinceText(at, now);
}

export function stateText(server: OwnedServer, now: Date): string {
  if (server.status === 'up') {
    return server.online === null
      ? ru.owner.up
      : fill(ru.owner.upOnline, { online: formatNumber(server.online) });
  }
  const since = downSince(server, now);
  return since === null ? ru.owner.down : fill(ru.owner.downSince, { since });
}

const SLOT_SOON_DAYS = 2;

export interface SlotLeft {
  text: string;
  soon: boolean;
}

export function slotLeft(endsAt: string, now: Date): SlotLeft | null {
  const ms = Date.parse(endsAt) - now.getTime();
  if (!(ms > 0)) {
    return null;
  }
  const days = Math.ceil(ms / DAY);
  return {
    text: ms <= DAY ? ru.owner.topSlot.lessThanDay : countOf(days, ru.owner.topSlot.days),
    soon: days <= SLOT_SOON_DAYS,
  };
}

export function aboveRank(server: Pick<OwnedServer, 'rank' | 'topSlot'>, now: Date): boolean {
  return (
    server.rank === null && server.topSlot !== null && slotLeft(server.topSlot.endsAt, now) !== null
  );
}

export function markTier(
  mark: EventMark | null,
  event: { tier?: TopSlotTier },
  server: Pick<OwnedServer, 'topSlot'>,
): TopSlotTier | null {
  return mark?.slot === true ? (event.tier ?? server.topSlot?.tier ?? null) : null;
}

export function eventMark(kind: string): EventMark {
  return (Object.hasOwn(EVENT_MARKS, kind) ? EVENT_MARKS[kind] : undefined) ?? OTHER_EVENT;
}

function dayText(at: string, now: Date): string {
  if (sameMoscowDay(at, now)) {
    return ru.time.today;
  }
  return sameMoscowDay(at, new Date(now.getTime() - DAY)) ? ru.time.yesterday : moscowDate(at);
}

export function eventTime(at: string, now: Date): string {
  return isDate(at)
    ? fill(ru.owner.events.at, { day: dayText(at, now), time: moscowTime(at) })
    : '';
}

export function dayDowntimes(downtimes: readonly Downtime[], now: Date): Downtime[] {
  const start = now.getTime() - DAY;
  return downtimes
    .filter((item) => isDate(item.from) && (item.to === null || isDate(item.to)))
    .filter((item) => item.to === null || Date.parse(item.to) >= start)
    .toSorted((a, b) => Date.parse(b.from) - Date.parse(a.from));
}

function spanText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  return minutes < 60 ? countOf(minutes, ru.owner.chart.minutes) : duration(minutes * 60);
}

export function downtimeText(item: Downtime): string {
  const from = moscowTime(item.from);
  if (item.to === null) {
    return fill(ru.owner.chart.downtimeOngoing, { from });
  }
  return fill(ru.owner.chart.downtime, {
    from,
    to: moscowTime(item.to),
    duration: spanText(Date.parse(item.to) - Date.parse(item.from)),
  });
}

export function siteErrorOf(error: AccountError | null): SiteError {
  switch (error?.code) {
    case 'timeout':
      return { code: 'timeout' };
    case 'rate_limited':
      return error.retryAfterS === undefined
        ? { code: 'rate-limited' }
        : { code: 'rate-limited', retryAfterS: error.retryAfterS };
    case 'offline':
    case undefined:
      return { code: 'offline' };
    default:
      return { code: 'server-error' };
  }
}

export function needsAttention(
  refs: readonly OwnedServerRef[],
  servers: readonly OwnedServer[],
): boolean {
  return (
    refs.some((item) => item.status === 'down') ||
    servers.some((item) => item.status === 'down' || item.attention !== null)
  );
}

export function withoutRepeats<T extends { kind: string; title: string }>(events: T[]): T[] {
  return events.filter((event, index) => {
    const previous = events[index - 1];
    return previous?.kind !== event.kind || previous.title !== event.title;
  });
}
