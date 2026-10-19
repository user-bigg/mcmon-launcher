import { osName } from '../site/config';

export const DEVICE_LABEL_LENGTH = 64;

const INVISIBLE = /[\p{C}\p{Zl}\p{Zp}]+/gu;

export function deviceLabel(platform: NodeJS.Platform, hostname: string): string {
  const host = hostname.replace(INVISIBLE, ' ').trim();
  const label = host === '' ? osName(platform) : `${osName(platform)} · ${host}`;
  return Array.from(label).slice(0, DEVICE_LABEL_LENGTH).join('');
}
