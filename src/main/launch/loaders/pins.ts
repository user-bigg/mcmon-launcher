import { stat } from 'node:fs/promises';
import path from 'node:path';
import { checksum } from '@xmcl/core';
import { isValidVersionId } from '@shared/launch';
import { failure } from '../errors';
import { readJson, writeJsonBestEffort } from '../json-cache';
import type { GameLayout } from '../layout';
import { LoaderStageError } from './sources';

export interface Pin {
  sha1: string;
}

export interface LoaderPins {
  schemaVersion: 1;
  version: string;
  files: Record<string, Pin>;
}

const SHA1 = /^[0-9a-f]{40}$/;

export function pinsFile(layout: GameLayout, versionId: string): string {
  if (!isValidVersionId(versionId)) {
    throw failure({ code: 'invalid-request', field: 'minecraft' });
  }
  return path.join(layout.versions, versionId, 'mcmonitor-pins.json');
}

function isPin(value: unknown): value is Pin {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { sha1 } = value as Partial<Pin>;
  return typeof sha1 === 'string' && SHA1.test(sha1);
}

function isSafeRelative(file: string): boolean {
  return (
    file.length > 0 &&
    !file.startsWith('/') &&
    !file.includes('\\') &&
    !/^[A-Za-z]:/.test(file) &&
    file.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

export async function readPins(file: string, version: string): Promise<LoaderPins | null> {
  const raw = (await readJson(file)) as Partial<LoaderPins> | undefined;
  if (raw?.schemaVersion !== 1 || raw.version !== version || typeof raw.files !== 'object') {
    return null;
  }
  const files: Record<string, Pin> = {};
  for (const [name, pin] of Object.entries(raw.files)) {
    if (isSafeRelative(name) && isPin(pin)) {
      files[name] = { sha1: pin.sha1 };
    }
  }
  return { schemaVersion: 1, version, files };
}

export function writePins(file: string, pins: LoaderPins): Promise<boolean> {
  return writeJsonBestEffort(file, pins);
}

export class PinCollector {
  private readonly files = new Map<string, Pin>();

  constructor(private readonly root: string) {}

  relative(file: string): string | null {
    const relative = path.relative(this.root, file).split(path.sep).join('/');
    return isSafeRelative(relative) ? relative : null;
  }

  add(file: string, sha1: string): void {
    const relative = this.relative(file);
    if (relative === null || !SHA1.test(sha1)) {
      throw new LoaderStageError('library', `file outside game folder: ${path.basename(file)}`);
    }
    this.files.set(relative, { sha1 });
  }

  toPins(version: string): LoaderPins {
    const files = Object.fromEntries(
      [...this.files.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    return { schemaVersion: 1, version, files };
  }
}

// A file from maven does not change between installs of one version: a different hash on
// reinstall means substitution or a reissue, and such a loader is not launched.
export function mergePins(previous: LoaderPins | null, next: LoaderPins): LoaderPins {
  if (previous === null) {
    return next;
  }
  for (const [file, pin] of Object.entries(next.files)) {
    const old = previous.files[file];
    if (old !== undefined && old.sha1 !== pin.sha1) {
      throw new LoaderStageError('library', `pinned hash changed: ${file}`);
    }
  }
  return next;
}

export async function firstChangedPin(
  root: string,
  pins: LoaderPins,
  since: number | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  for (const [file, pin] of Object.entries(pins.files)) {
    signal.throwIfAborted();
    const full = path.join(root, ...file.split('/'));
    const info = await stat(full).catch(() => null);
    if (info?.isFile() !== true) {
      return full;
    }
    if (since !== undefined && info.mtimeMs <= since) {
      continue;
    }
    if (String(await checksum(full, 'sha1').catch(() => '')) !== pin.sha1) {
      return full;
    }
  }
  return null;
}
