import { cleanBanReason } from '@shared/account';
import type { LookError } from '@shared/look';
import {
  isPresetId,
  MAX_PRESET_TAGS,
  MAX_PRESETS,
  releaseDay,
  SKIN_MODELS,
  type CapePreset,
  type SkinPreset,
  type WornCape,
  type WornSkin,
} from '@shared/look';
import type { SiteError } from '@shared/site';
import { httpsUrl, isRecord, line, list, oneOf, type Fields } from './guards';

const MAX_TITLE_LENGTH = 80;
const MAX_TAG_LENGTH = 32;

export type LocalTexture = (remote: string) => string | null;

interface PresetBase {
  id: string;
  title: string;
  url: string;
  tags: string[];
  releasedAt: string | null;
  isNew: boolean;
}

function textureOf(value: unknown, local: LocalTexture): string | null {
  const remote = httpsUrl(value);
  return remote === null ? null : local(remote);
}

function tagsOf(value: unknown): string[] {
  const tags: string[] = [];
  for (const item of list(value)) {
    const tag = line(item, MAX_TAG_LENGTH)?.trim() ?? '';
    if (tag !== '' && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags.slice(0, MAX_PRESET_TAGS);
}

function presetBase(value: unknown, local: LocalTexture): PresetBase | null {
  if (!isRecord(value) || !isPresetId(value.id)) {
    return null;
  }
  const title = line(value.title, MAX_TITLE_LENGTH)?.trim() ?? '';
  const url = textureOf(value.url, local);
  if (title === '' || url === null) {
    return null;
  }
  return {
    id: value.id,
    title,
    url,
    tags: tagsOf(value.tags),
    releasedAt: releaseDay(value.released_at),
    isNew: value.is_new === true,
  };
}

function presets<T extends PresetBase>(
  value: unknown,
  item: (fields: Fields, base: PresetBase) => T | null,
  local: LocalTexture,
): T[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  const seen = new Set<string>();
  const result: T[] = [];
  for (const raw of value.items.slice(0, MAX_PRESETS)) {
    const base = presetBase(raw, local);
    const parsed = base === null || seen.has(base.id) ? null : item(raw as Fields, base);
    if (parsed !== null) {
      seen.add(parsed.id);
      result.push(parsed);
    }
  }
  return result;
}

export function parseSkinPresets(value: unknown, local: LocalTexture): SkinPreset[] | null {
  return presets(
    value,
    (fields, base) => {
      const model = oneOf(fields.model, SKIN_MODELS);
      return model === null ? null : { ...base, model };
    },
    local,
  );
}

export function parseCapePresets(value: unknown, local: LocalTexture): CapePreset[] | null {
  return presets(value, (_fields, base) => base, local);
}

function wornId(value: unknown): string | null {
  return isPresetId(value) ? value : null;
}

export function wornSkin(value: unknown, local: LocalTexture): WornSkin | null {
  if (!isRecord(value)) {
    return null;
  }
  const url = textureOf(value.url, local);
  const model = oneOf(value.model, SKIN_MODELS) ?? 'classic';
  return url === null ? null : { id: wornId(value.id), url, model };
}

export function wornCape(value: unknown, local: LocalTexture): WornCape | null {
  if (!isRecord(value)) {
    return null;
  }
  const url = textureOf(value.url, local);
  return url === null ? null : { id: wornId(value.id), url };
}

export interface SkinAnswer {
  skin: WornSkin | null;
}

export interface CapeAnswer {
  cape: WornCape | null;
}

// An answer the launcher cannot read must not look like "the skin is off".
export function parseSkinAnswer(value: unknown, local: LocalTexture): SkinAnswer | null {
  if (!isRecord(value) || !('skin' in value)) {
    return null;
  }
  const skin = wornSkin(value.skin, local);
  return value.skin === null || skin !== null ? { skin } : null;
}

export function parseCapeAnswer(value: unknown, local: LocalTexture): CapeAnswer | null {
  if (!isRecord(value) || !('cape' in value)) {
    return null;
  }
  const cape = wornCape(value.cape, local);
  return value.cape === null || cape !== null ? { cape } : null;
}

export function lookError(error: SiteError): LookError {
  if (error.siteCode === 'invalid_skin') {
    const message = cleanBanReason(error.message);
    return { code: 'invalid_skin', ...(message === null ? {} : { message }) };
  }
  if (error.code === 'rate-limited') {
    return {
      code: 'rate_limited',
      ...(error.retryAfterS === undefined ? {} : { retryAfterS: error.retryAfterS }),
    };
  }
  if (error.status === 401) {
    return { code: 'not_signed_in' };
  }
  return { code: error.code === 'offline' || error.code === 'timeout' ? 'offline' : 'failed' };
}
