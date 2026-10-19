import { createHash } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJsonBestEffort } from '../launch/json-cache';
import { integer, isRecord, line } from './guards';

export interface CacheEntry {
  key: string;
  etag: string | null;
  fetchedAt: number;
  expiresAt: number;
  body: unknown;
}

export interface ResponseCache {
  read: (key: string) => Promise<CacheEntry | null>;
  write: (entry: CacheEntry) => Promise<void>;
}

const FILE = /^[0-9a-f]{40}\.json$/;

function fileName(key: string): string {
  return `${createHash('sha256').update(key).digest('hex').slice(0, 40)}.json`;
}

function entryOf(value: unknown, key: string): CacheEntry | null {
  if (!isRecord(value) || value.key !== key || !('body' in value)) {
    return null;
  }
  const fetchedAt = integer(value.fetchedAt, 0, Number.MAX_SAFE_INTEGER);
  const expiresAt = integer(value.expiresAt, 0, Number.MAX_SAFE_INTEGER);
  if (fetchedAt === null || expiresAt === null) {
    return null;
  }
  return { key, etag: line(value.etag, 256), fetchedAt, expiresAt, body: value.body };
}

export class DiskCache implements ResponseCache {
  private readonly memory = new Map<string, CacheEntry>();

  constructor(private readonly dir: string) {}

  async read(key: string): Promise<CacheEntry | null> {
    const remembered = this.memory.get(key);
    if (remembered !== undefined) {
      return remembered;
    }
    const entry = entryOf(await readJson(join(this.dir, fileName(key))), key);
    if (entry !== null) {
      this.memory.set(key, entry);
    }
    return entry;
  }

  async write(entry: CacheEntry): Promise<void> {
    this.memory.set(entry.key, entry);
    await writeJsonBestEffort(join(this.dir, fileName(entry.key)), entry);
  }

  async prune(olderThanMs: number, now: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    for (const name of names.filter((item) => FILE.test(item))) {
      const file = join(this.dir, name);
      const info = await stat(file).catch(() => null);
      if (info !== null && now - info.mtimeMs > olderThanMs) {
        await rm(file, { force: true }).catch(() => undefined);
      }
    }
  }
}

export class MemoryCache implements ResponseCache {
  readonly entries = new Map<string, CacheEntry>();

  read(key: string): Promise<CacheEntry | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  write(entry: CacheEntry): Promise<void> {
    this.entries.set(entry.key, entry);
    return Promise.resolve();
  }
}
