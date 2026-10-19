import headAlt from '../assets/pixel/head-alt.svg';
import headFox from '../assets/pixel/head-fox.svg';
import headFrost from '../assets/pixel/head-frost.svg';
import skinFrost from '../assets/pixel/skin-frost.svg';

const heads: Record<string, string> = { frost: headFrost, fox: headFox, alt: headAlt };
const skins: Record<string, string> = { frost: skinFrost };

export function headUrl(key: string): string {
  return heads[key] ?? headFox;
}

export function skinUrl(key: string | null): string | null {
  return key === null ? null : (skins[key] ?? null);
}
