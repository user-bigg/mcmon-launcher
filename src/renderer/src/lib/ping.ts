import { ru } from '@shared/i18n/ru';
import type { IconName } from '../components/icons';

export interface PingLevel {
  bars: IconName;
  tone: 'good' | 'mid' | 'bad' | 'none';
  word: string;
}

export const PING_GOOD_MS = 100;
export const PING_MID_MS = 250;

export function pingLevel(ms: number | null): PingLevel {
  if (ms === null) {
    return { bars: 'dash-lg', tone: 'none', word: ru.server.pingUnknown };
  }
  if (ms < PING_GOOD_MS) {
    return { bars: 'reception-4', tone: 'good', word: ru.server.pingGood };
  }
  if (ms <= PING_MID_MS) {
    return { bars: 'reception-2', tone: 'mid', word: ru.server.pingMid };
  }
  return { bars: 'reception-1', tone: 'bad', word: ru.server.pingBad };
}
