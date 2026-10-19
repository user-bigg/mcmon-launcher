import { fill, plural } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';

const MOSCOW = 'Europe/Moscow';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const clock = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW,
  hour: '2-digit',
  minute: '2-digit',
});
const dayMonth = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW,
  day: 'numeric',
  month: 'long',
});
const dayMonthYear = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const hourOfDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: MOSCOW,
  hour: 'numeric',
  hourCycle: 'h23',
});
const calendarDay = new Intl.DateTimeFormat('en-CA', { timeZone: MOSCOW });

export function moscowTime(at: string | Date): string {
  return clock.format(new Date(at));
}

export function moscowDate(at: string | Date): string {
  return dayMonth.format(new Date(at));
}

const dayShortMonth = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW,
  day: 'numeric',
  month: 'short',
});

export function moscowDateShort(at: string | Date): string {
  return dayShortMonth.format(new Date(at)).replace('.', '');
}

export function moscowDateWithYear(at: string | Date): string {
  return dayMonthYear
    .formatToParts(new Date(at))
    .filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
    .map((part) => part.value)
    .join(' ');
}

export function moscowHour(at: Date): number {
  return Number(hourOfDay.format(at));
}

export function moscowYear(at: string | null, fallback: Date): number {
  const date = at === null ? fallback : new Date(at);
  return Number(calendarDay.format(Number.isNaN(date.getTime()) ? fallback : date).slice(0, 4));
}

export function moscowMonthDay(at: Date): string {
  return calendarDay.format(at).slice(5);
}

export function sameMoscowDay(a: string | Date, b: string | Date): boolean {
  return calendarDay.format(new Date(a)) === calendarDay.format(new Date(b));
}

export function moscowDayTime(at: string, now: Date): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const time = moscowTime(date);
  return sameMoscowDay(date, now)
    ? time
    : fill(ru.alerts.dateTime, { date: moscowDate(date), time });
}

function daysBetween(from: Date, to: Date): number {
  const start = Date.parse(calendarDay.format(from));
  const end = Date.parse(calendarDay.format(to));
  return Math.round((end - start) / DAY);
}

export function relativeDay(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  const hours = Math.floor((now.getTime() - date.getTime()) / HOUR);
  const days = daysBetween(date, now);
  if (days <= 0) {
    return hours >= 1 ? fill(ru.time.hoursAgo, { count: hours }) : ru.time.today;
  }
  if (days === 1) {
    return ru.time.yesterday;
  }
  if (days < 7) {
    return fill(ru.time.daysAgo, { count: days, unit: plural(days, ru.plural.days) });
  }
  if (days < 14) {
    return ru.time.weekAgo;
  }
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return fill(ru.time.weeksAgo, { count: weeks, unit: plural(weeks, ru.plural.weeks) });
  }
  const months = Math.floor(days / 30);
  if (months === 1) {
    return ru.time.monthAgo;
  }
  return fill(ru.time.monthsAgo, { count: months, unit: plural(months, ru.plural.months) });
}

export function minutesAgo(at: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - Date.parse(at)) / 60_000);
  if (minutes < 1) {
    return ru.time.justNow;
  }
  if (minutes < 60) {
    return fill(ru.time.minutesAgo, { count: minutes });
  }
  return relativeDay(at, now);
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function durationCoarse(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  if (seconds >= 3600) {
    return fill(ru.time.hoursShort, { hours: Math.ceil(seconds / 3600) });
  }
  return fill(ru.time.minutesShort, { minutes: Math.max(1, Math.ceil(seconds / 60)) });
}

export function duration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return fill(ru.time.duration, { hours, minutes });
  }
  if (minutes > 0) {
    return fill(ru.time.durationMinutes, { minutes, seconds: seconds % 60 });
  }
  return fill(ru.time.durationSeconds, { seconds });
}

export function greeting(name: string, now: Date = new Date()): string {
  const hour = moscowHour(now);
  if (name === '') {
    if (hour < 5) {
      return ru.time.greetingPlain.night;
    }
    if (hour < 12) {
      return ru.time.greetingPlain.morning;
    }
    return hour < 18 ? ru.time.greetingPlain.day : ru.time.greetingPlain.evening;
  }
  if (hour < 5) {
    return fill(ru.time.greetingNight, { name });
  }
  if (hour < 12) {
    return fill(ru.time.greetingMorning, { name });
  }
  if (hour < 18) {
    return fill(ru.time.greetingDay, { name });
  }
  return fill(ru.time.greetingEvening, { name });
}
