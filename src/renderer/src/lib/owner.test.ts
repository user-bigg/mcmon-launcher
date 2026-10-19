import { describe, expect, it } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import {
  changeText,
  dayDowntimes,
  downtimesText,
  downtimeText,
  aboveRank,
  eventMark,
  slotLeft,
  eventTime,
  needsAttention,
  percentText,
  sinceText,
  siteErrorOf,
  markTier,
  withoutRepeats,
} from './owner';

const NOW = new Date('2026-10-03T12:00:00Z');
const NBSP = String.fromCharCode(160);

describe('owner figures', () => {
  it('a share becomes a percent with a comma and no space before the sign', () => {
    expect(percentText(0.987)).toBe(`98,7%`);
    expect(percentText(0.912)).toBe(`91,2%`);
    expect(percentText(1)).toBe(`100%`);
    expect(percentText(0)).toBe(`0%`);
    expect(percentText(null)).toBe(ru.owner.empty);
  });

  it('downtime count is declined, zero has its own words', () => {
    expect(downtimesText(1)).toBe(`1${NBSP}простой`);
    expect(downtimesText(4)).toBe(`4${NBSP}простоя`);
    expect(downtimesText(11)).toBe(`11${NBSP}простоев`);
    expect(downtimesText(21)).toBe(`21${NBSP}простой`);
    expect(downtimesText(0)).toBe(ru.owner.stats.noDowntimes);
    expect(downtimesText(null)).toBeNull();
  });

  it('votes change carries a sign, a real minus and no sign for zero', () => {
    expect(changeText(12)).toBe(`+12%`);
    expect(changeText(-8)).toBe(`−8%`);
    expect(changeText(0)).toBe(ru.owner.stats.changeNone);
    expect(changeText(null)).toBeNull();
  });
});

describe('owner times', () => {
  it('since: only the Moscow time today, with the date on other days', () => {
    expect(sinceText('2026-10-03T09:40:00Z', NOW)).toBe('12:40');
    expect(sinceText('2026-10-01T21:30:00Z', NOW)).toBe(
      fill(ru.owner.sinceDay, { day: '2 октября', time: '00:30' }),
    );
  });

  it('event time: today, yesterday, then a date', () => {
    expect(eventTime('2026-10-03T07:00:00Z', NOW)).toContain(ru.time.today);
    expect(eventTime('2026-10-02T07:00:00Z', NOW)).toContain(ru.time.yesterday);
    expect(eventTime('2026-09-28T07:00:00Z', NOW)).toContain('28 сентября');
    expect(eventTime('not a date', NOW)).toBe('');
  });

  it('a downtime reads as a range with an en dash and a declined length', () => {
    expect(downtimeText({ from: '2026-10-03T01:12:00Z', to: '2026-10-03T01:21:00Z' })).toBe(
      fill(ru.owner.chart.downtime, { from: '04:12', to: '04:21', duration: `9${NBSP}минут` }),
    );
    expect(downtimeText({ from: '2026-10-03T01:12:00Z', to: '2026-10-03T01:13:00Z' })).toContain(
      `1${NBSP}минута`,
    );
    expect(downtimeText({ from: '2026-10-03T01:00:00Z', to: '2026-10-03T03:05:00Z' })).toContain(
      fill(ru.time.duration, { hours: 2, minutes: 5 }),
    );
    expect(downtimeText({ from: '2026-10-03T09:40:00Z', to: null })).toBe(
      fill(ru.owner.chart.downtimeOngoing, { from: '12:40' }),
    );
    expect(ru.owner.chart.downtime).toContain('{from}–{to}');
  });

  it('only the last day of downtimes is kept, newest first, broken dates dropped', () => {
    const kept = dayDowntimes(
      [
        { from: '2026-10-01T01:00:00Z', to: '2026-10-01T02:00:00Z' },
        { from: '2026-10-03T01:12:00Z', to: '2026-10-03T01:21:00Z' },
        { from: 'broken', to: null },
        { from: '2026-10-03T09:40:00Z', to: null },
      ],
      NOW,
    );
    expect(kept.map((item) => item.from)).toEqual(['2026-10-03T09:40:00Z', '2026-10-03T01:12:00Z']);
  });
});

describe('top slot time left', () => {
  const now = new Date('2026-10-07T12:00:00Z');

  it('counts started days and marks the last two', () => {
    expect(slotLeft('2026-10-12T00:00:00Z', now)).toEqual({ text: '5\u00a0дней', soon: false });
    expect(slotLeft('2026-10-09T12:00:00Z', now)).toEqual({ text: '2\u00a0дня', soon: true });
    expect(slotLeft('2026-10-07T18:00:00Z', now)).toEqual({
      text: ru.owner.topSlot.lessThanDay,
      soon: true,
    });
  });

  it('exactly one day left reads as less than a day', () => {
    expect(slotLeft('2026-10-08T12:00:00Z', now)?.text).toBe(ru.owner.topSlot.lessThanDay);
  });

  it('above the rating only without a rank and with a running slot', () => {
    const slot = { tier: 'gold', endsAt: '2026-10-12T00:00:00Z' } as const;
    expect(aboveRank({ rank: null, topSlot: slot }, now)).toBe(true);
    expect(aboveRank({ rank: 4, topSlot: slot }, now)).toBe(false);
    expect(aboveRank({ rank: null, topSlot: null }, now)).toBe(false);
    expect(
      aboveRank({ rank: null, topSlot: { ...slot, endsAt: '2026-10-07T11:00:00Z' } }, now),
    ).toBe(false);
  });

  it('an ended or unreadable date gives nothing', () => {
    expect(slotLeft('2026-10-07T12:00:00Z', now)).toBeNull();
    expect(slotLeft('soon', now)).toBeNull();
  });
});

describe('owner marks', () => {
  it('known event kinds get their icon, the rest stay neutral', () => {
    expect(eventMark('down')).toEqual({ icon: 'x-circle', tone: 'bad' });
    expect(eventMark('up')).toEqual({ icon: 'check-circle', tone: 'ok' });
    expect(eventMark('rank_drop').tone).toBe('muted');
    expect(eventMark('points_expire').tone).toBe('gold');
    expect(eventMark('top_slot_expire')).toMatchObject({ tone: 'gold', slot: true });
    const slot = eventMark('top_slot_expire');
    const gold = { topSlot: { tier: 'gold' as const, endsAt: '' } };
    expect(markTier(slot, { tier: 'diamond' }, gold)).toBe('diamond');
    expect(markTier(slot, {}, gold)).toBe('gold');
    expect(markTier(slot, {}, { topSlot: null })).toBeNull();
    expect(markTier(eventMark('down'), { tier: 'gold' }, gold)).toBeNull();
    expect(eventMark('constructor')).toEqual({ icon: 'info-circle', tone: 'muted' });
  });

  it('attention: a server from the account list that is down', () => {
    const up = { id: 1, name: 'A', status: 'up' as const };
    expect(needsAttention([up], [])).toBe(false);
    expect(needsAttention([{ ...up, status: 'down' }], [])).toBe(true);
  });

  it('account errors map to the site error views', () => {
    expect(siteErrorOf({ code: 'offline' }).code).toBe('offline');
    expect(siteErrorOf({ code: 'timeout' }).code).toBe('timeout');
    expect(siteErrorOf({ code: 'rate_limited', retryAfterS: 30 })).toEqual({
      code: 'rate-limited',
      retryAfterS: 30,
    });
    expect(siteErrorOf({ code: 'server_error' }).code).toBe('server-error');
  });
});

describe('withoutRepeats', () => {
  it('folds a run of identical events into its first one', () => {
    const events = [
      { id: 4, kind: 'top_slot_expire', title: 'Gold ends on 13 October' },
      { id: 3, kind: 'top_slot_expire', title: 'Gold ends on 13 October' },
      { id: 2, kind: 'top_slot_expire', title: 'Gold ends on 20 October' },
    ];
    expect(withoutRepeats(events).map((event) => event.id)).toEqual([4, 2]);
  });

  it('keeps events that repeat with something else in between', () => {
    const events = [
      { id: 4, kind: 'up', title: 'Back online' },
      { id: 3, kind: 'down', title: 'Down' },
      { id: 2, kind: 'up', title: 'Back online' },
      { id: 1, kind: 'down', title: 'Down' },
    ];
    expect(withoutRepeats(events).map((event) => event.id)).toEqual([4, 3, 2, 1]);
  });
});
