import type { AccountState } from './account';
import { isValidNick } from './launch';

export const SKIN_MODELS = ['classic', 'slim'] as const;
export type SkinModel = (typeof SKIN_MODELS)[number];

export const MAX_PRESETS = 500;
export const MAX_PRESET_TAGS = 5;

export interface SkinPreset {
  id: string;
  title: string;
  url: string;
  model: SkinModel;
  tags: string[];
  releasedAt: string | null;
  isNew: boolean;
}

export interface CapePreset {
  id: string;
  title: string;
  url: string;
  tags: string[];
  releasedAt: string | null;
  isNew: boolean;
}

export interface LookPresets {
  skins: SkinPreset[];
  capes: CapePreset[];
}

export interface WornSkin {
  id: string | null;
  url: string;
  model: SkinModel;
}

export interface WornCape {
  id: string | null;
  url: string;
}

export interface WornLook {
  skin: WornSkin | null;
  cape: WornCape | null;
}

// A key that is absent stays as it is on the site; cape: null takes the cape off.
export interface LookChange {
  skin?: string;
  cape?: string | null;
  nick?: string;
}

export const LOOK_ERROR_CODES = [
  'not_signed_in',
  'offline',
  'rate_limited',
  'invalid_skin',
  'failed',
] as const;
export type LookErrorCode = (typeof LOOK_ERROR_CODES)[number];

export interface LookError {
  code: LookErrorCode;
  message?: string;
  retryAfterS?: number;
}

export type LookResult = { ok: true; value: AccountState } | { ok: false; error: LookError };

const PRESET_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RELEASE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isPresetId(value: unknown): value is string {
  return typeof value === 'string' && PRESET_ID.test(value);
}

export function parseLookChange(value: unknown): LookChange | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { skin, cape, nick } = value as Record<string, unknown>;
  const skinKnown = skin === undefined || isPresetId(skin);
  const capeKnown = cape === undefined || cape === null || isPresetId(cape);
  const nickKnown = nick === undefined || (typeof nick === 'string' && isValidNick(nick));
  if (!skinKnown || !capeKnown || !nickKnown || (skin === undefined && cape === undefined)) {
    return null;
  }
  return {
    ...(skin === undefined ? {} : { skin }),
    ...(cape === undefined ? {} : { cape }),
    ...(typeof nick === 'string' ? { nick } : {}),
  };
}

function dayNumber(day: string): number | null {
  const match = RELEASE_DAY.exec(day);
  if (match === null) {
    return null;
  }
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, date));
  const real = at.getUTCFullYear() === year && at.getUTCMonth() === month - 1;
  return real && at.getUTCDate() === date ? at.getTime() / DAY_MS : null;
}

export function releaseDay(value: unknown): string | null {
  return typeof value === 'string' && dayNumber(value) !== null ? value : null;
}
