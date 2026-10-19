import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { formatGb } from './units';

export function memoryHint(totalMb: number | undefined): string {
  return totalMb !== undefined && totalMb > 0
    ? fill(ru.settings.memoryHintTotal, { total: formatGb(Math.round(totalMb / 1024)) })
    : '';
}
