import { ru } from '@shared/i18n/ru';
import type { ServerAddress, VersionRange } from '@shared/catalog';
import { DEFAULT_SERVER_PORT, displayHost, formatServerAddress } from '@shared/server-address';

export type VersionParts = readonly number[];

export function parseVersion(version: string): VersionParts {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

export function versionLabel(range: VersionRange | null): string {
  if (range === null) {
    return ru.server.versionUnknown;
  }
  return range.from === range.to ? range.from : `${range.from}–${range.to}`;
}

const COMPACT_VERSION_CHARS = 14;

function majorMinor(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

export function compactVersionLabel(range: VersionRange): string {
  const full = versionLabel(range);
  if (full.length <= COMPACT_VERSION_CHARS) {
    return full;
  }
  const from = majorMinor(range.from);
  const to = majorMinor(range.to);
  return from === to ? from : `${from}–${to}`;
}

export function addressCopyText(address: ServerAddress): string {
  return address.port === null || address.port === DEFAULT_SERVER_PORT
    ? address.host
    : formatServerAddress(address);
}

export function addressLabel(address: ServerAddress): string {
  return addressCopyText({ ...address, host: displayHost(address.host) });
}
