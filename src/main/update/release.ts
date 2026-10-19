import { isUpdateVersion, MAX_RELEASE_NOTES_LENGTH } from '@shared/update';
import { isSha512Base64, SIGNATURE_SUFFIX } from './signature';

export type InstallerExtension = 'exe' | 'zip';

export interface InstallerRelease {
  version: string;
  url: string;
  signatureUrl: string;
  sha512: string;
}

interface FileEntry {
  url: string;
  sha512: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fileEntries(info: Record<string, unknown>): FileEntry[] {
  const files = Array.isArray(info.files) ? (info.files as unknown[]) : [];
  return files.flatMap((file) =>
    isRecord(file) && typeof file.url === 'string' && isSha512Base64(file.sha512)
      ? [{ url: file.url, sha512: file.sha512 }]
      : [],
  );
}

export function resolveUnderBase(path: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return null;
  }
  const root = new URL(base);
  if (
    url.protocol !== 'https:' ||
    url.origin !== root.origin ||
    !url.pathname.startsWith(root.pathname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }
  return url.href;
}

export function installerRelease(
  info: unknown,
  base: string,
  extension: InstallerExtension = 'exe',
): InstallerRelease | null {
  if (!isRecord(info) || !isUpdateVersion(info.version)) {
    return null;
  }
  const installer = fileEntries(info).find((file) =>
    file.url.toLowerCase().endsWith(`.${extension}`),
  );
  if (installer === undefined) {
    return null;
  }
  const url = resolveUnderBase(installer.url, base);
  if (url === null) {
    return null;
  }
  return {
    version: info.version,
    url,
    signatureUrl: `${url}${SIGNATURE_SUFFIX}`,
    sha512: installer.sha512,
  };
}

function noteText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (isRecord(entry) && typeof entry.note === 'string' ? entry.note : ''))
      .filter((note) => note !== '')
      .join('\n\n');
  }
  return '';
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function releaseNotes(value: unknown): string | null {
  const text = noteText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text === '') {
    return null;
  }
  return text.length > MAX_RELEASE_NOTES_LENGTH
    ? `${text.slice(0, MAX_RELEASE_NOTES_LENGTH - 1)}…`
    : text;
}
