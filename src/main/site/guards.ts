import { isHttpsUrl } from '@shared/links';

export type Fields = Record<string, unknown>;

const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]00:00)$/;

export function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max) {
    return null;
  }
  return value;
}

export function line(value: unknown, max: number): string | null {
  const parsed = text(value, max);
  return parsed === null || CONTROL_CHARACTERS.test(parsed) ? null : parsed;
}

export function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

export function fraction(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

export function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function httpsUrl(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 2048 && isHttpsUrl(value) ? value : null;
}

export function isoTime(value: unknown): string | null {
  return typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString().replace('.000Z', 'Z')
    : null;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
