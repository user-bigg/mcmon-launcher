import { fill, formatDecimal, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';

const MB = 1024 * 1024;
const GB = 1024 * MB;

export function formatBytes(bytes: number): string {
  if (bytes >= GB) {
    return fill(ru.units.gb, { value: formatDecimal(bytes / GB, bytes >= 10 * GB ? 1 : 2) });
  }
  return fill(ru.units.mb, { value: formatNumber(Math.round(bytes / MB)) });
}

const FINE_MB = 10 * MB;
const SMALLEST_MB = 0.1 * MB;

export function formatModSize(bytes: number): string {
  if (bytes >= FINE_MB) {
    return formatBytes(bytes);
  }
  return fill(ru.units.mb, { value: formatDecimal(Math.max(bytes, SMALLEST_MB) / MB) });
}

export function formatMemoryMb(mb: number): string {
  return fill(ru.units.gb, { value: formatDecimal(mb / 1024) });
}

export function formatGb(gb: number): string {
  return fill(ru.units.gb, { value: formatDecimal(gb) });
}

export function formatSpeed(bytesPerSecond: number): string {
  return fill(ru.units.mbps, { value: formatDecimal(bytesPerSecond / MB) });
}

export function formatPing(ms: number): string {
  return fill(ru.units.ms, { value: formatNumber(ms) });
}

export function formatPercent(value: number): string {
  return fill(ru.units.percent, { value: formatDecimal(value) });
}
