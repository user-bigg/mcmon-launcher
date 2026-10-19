import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { LookChange, LookError, SkinPreset } from '@shared/look';

const MINUTE_S = 60;

interface Worn {
  id: string | null;
  url: string;
}

interface Listed {
  id: string;
  url: string;
}

// The site sends id: null for a skin that has left the set, and an older site sends no id at
// all, so the preset is found by the texture address too.
export function wornPresetId(presets: readonly Listed[], worn: Worn | null): string | null {
  if (worn === null) {
    return null;
  }
  const found =
    presets.find((item) => item.id === worn.id) ?? presets.find((item) => item.url === worn.url);
  return found?.id ?? null;
}

export interface Picked {
  skin: string | undefined;
  cape: string | null | undefined;
}

export interface Saved {
  skin: string | null;
  cape: string | null;
  capeWorn: boolean;
}

export function lookChange(picked: Picked, saved: Saved): LookChange | null {
  const skin = picked.skin !== undefined && picked.skin !== saved.skin ? picked.skin : undefined;
  const capeOff = picked.cape === null && saved.capeWorn;
  const capeOn = typeof picked.cape === 'string' && picked.cape !== saved.cape;
  if (skin === undefined && !capeOff && !capeOn) {
    return null;
  }
  return {
    ...(skin === undefined ? {} : { skin }),
    ...(capeOff || capeOn ? { cape: picked.cape ?? null } : {}),
  };
}

export function skinTags(skins: readonly SkinPreset[]): string[] {
  return [...new Set(skins.flatMap((skin) => skin.tags))];
}

// A refusal of the site about the skin comes with a ready sentence for the player.
export function lookErrorText(error: LookError): string {
  if (error.code === 'invalid_skin' && error.message !== undefined) {
    return error.message;
  }
  const seconds = error.code === 'rate_limited' ? (error.retryAfterS ?? MINUTE_S) : MINUTE_S;
  return seconds < MINUTE_S ? fill(ru.skins.waitSeconds, { seconds }) : ru.skins.errors[error.code];
}
