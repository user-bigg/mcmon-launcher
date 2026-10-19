import type { Dirent } from 'node:fs';
import { lstat, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { serverIdOfFolder, type InstalledRuntime } from '@shared/instance';
import { isValidServerId, serverFolderId } from '@shared/launch';
import { failure } from './errors';
import { withFsRetry } from './fs-retry';
import { isGameRunningIn } from './game-mark';
import { readInstalledRuntime, writeInstalledRuntime } from './instance-overrides';
import { gameLogFile, instanceDir, type GameLayout } from './layout';

const SIZE_CONCURRENCY = 32;
const SIZE_CACHE_MS = 30_000;
const SHARED_FILES_KEY = ':shared';
const MOD_FILE = /\.(?:jar|zip|litemod)$/i;

export interface InstanceStats {
  sizeBytes: number;
}

export interface ServerFolderStats extends InstanceStats {
  folderId: string;
  serverId: number;
  lastPlayedAt: string | null;
  installed: InstalledRuntime | null;
}

export interface InstanceStoreOptions {
  layout: GameLayout;
  now: () => number;
  isGameRunning?: (instance: string) => Promise<boolean>;
}

export function isModFileName(name: string): boolean {
  return MOD_FILE.test(name);
}

async function readEntries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isRegularFile(dir: string, entry: Dirent): Promise<boolean> {
  if (entry.isFile()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  return stat(path.join(dir, entry.name)).then(
    (info) => info.isFile(),
    () => false,
  );
}

export async function listModFileNames(instance: string): Promise<string[]> {
  const mods = path.join(instance, 'mods');
  const entries = (await readEntries(mods)).filter((entry) => isModFileName(entry.name));
  const files = await Promise.all(
    entries.map(async (entry) => ((await isRegularFile(mods, entry)) ? entry.name : null)),
  );
  return files
    .filter((name): name is string => name !== null)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export async function directorySize(root: string): Promise<number> {
  let total = 0;
  const seen = new Set<string>();
  let pending = [root];
  while (pending.length > 0) {
    const batch = pending.slice(0, SIZE_CONCURRENCY);
    pending = pending.slice(SIZE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (dir) => ({ dir, entries: await readEntries(dir) })),
    );
    for (const { dir, entries } of results) {
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          pending.push(full);
        } else if (entry.isFile()) {
          const info = await lstat(full).catch(() => null);
          const key = info === null ? null : `${String(info.dev)}:${String(info.ino)}`;
          if (info !== null && key !== null && (info.nlink <= 1 || !seen.has(key))) {
            seen.add(key);
            total += info.size;
          }
        }
      }
    }
  }
  return total;
}

async function lastLaunchAt(dir: string): Promise<string | null> {
  const info = await stat(gameLogFile(dir)).catch(() => null);
  return info === null ? null : info.mtime.toISOString();
}

export class InstanceStore {
  private readonly inUse = new Map<string, number>();
  private readonly removing = new Set<string>();
  private readonly sizes = new Map<string, { at: number; bytes: number }>();
  private readonly counting = new Map<string, Promise<number>>();

  private readonly isGameRunning: (instance: string) => Promise<boolean>;

  constructor(private readonly options: InstanceStoreOptions) {
    this.isGameRunning =
      options.isGameRunning ?? ((instance): Promise<boolean> => isGameRunningIn(instance));
  }

  acquire(folderId: string): () => void {
    if (this.removing.has(folderId)) {
      throw failure({ code: 'busy' });
    }
    this.inUse.set(folderId, (this.inUse.get(folderId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const count = (this.inUse.get(folderId) ?? 1) - 1;
      if (count <= 0) {
        this.inUse.delete(folderId);
      } else {
        this.inUse.set(folderId, count);
      }
    };
  }

  isInUse(folderId: string): boolean {
    return this.inUse.has(folderId) || this.removing.has(folderId);
  }

  async listServers(): Promise<ServerFolderStats[]> {
    const entries = await readEntries(this.options.layout.instances);
    const folders = entries.flatMap((entry) => {
      const serverId = serverIdOfFolder(entry.name);
      return entry.isDirectory() && serverId !== null ? [{ folderId: entry.name, serverId }] : [];
    });
    const servers = await Promise.all(
      folders.map(async ({ folderId, serverId }) => {
        const dir = instanceDir(this.options.layout, folderId);
        const [stats, lastPlayedAt, installed] = await Promise.all([
          this.folderStats(folderId, dir),
          lastLaunchAt(dir),
          readInstalledRuntime(dir),
        ]);
        return { folderId, serverId, lastPlayedAt, installed, ...stats };
      }),
    );
    return servers.sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''));
  }

  // A game left running by an earlier launcher holds its folder: on Windows half of it would
  // be gone before a locked jar stopped the removal.
  async removeServer(folderId: string): Promise<void> {
    if (serverIdOfFolder(folderId) === null) {
      throw failure({ code: 'invalid-request', field: 'folderId' });
    }
    if (this.isInUse(folderId)) {
      throw failure({ code: 'server-in-use' });
    }
    this.removing.add(folderId);
    try {
      const dir = instanceDir(this.options.layout, folderId);
      if (await this.isGameRunning(dir)) {
        throw failure({ code: 'server-in-use' });
      }
      await withFsRetry(() => rm(dir, { recursive: true, force: true }));
    } finally {
      this.sizes.delete(folderId);
      this.counting.delete(folderId);
      this.removing.delete(folderId);
    }
  }

  async recordServerInstall(serverId: number, installed: InstalledRuntime): Promise<boolean> {
    const dir = this.serverDir(serverId);
    try {
      await writeInstalledRuntime(dir, installed);
      return true;
    } catch {
      return false;
    }
  }

  private serverDir(serverId: number): string {
    if (!isValidServerId(serverId)) {
      throw failure({ code: 'invalid-request', field: 'serverId' });
    }
    return instanceDir(this.options.layout, serverFolderId(serverId));
  }

  private async folderStats(folderId: string, dir: string): Promise<InstanceStats> {
    return { sizeBytes: await this.cachedSize(folderId, dir) };
  }

  // Library loads come in bursts; a walk of tens of thousands of shared files is done once
  // and every caller of the moment gets its answer.
  private cachedSize(folderId: string, dirs: string | string[]): Promise<number> {
    const now = this.options.now();
    const cached = this.sizes.get(folderId);
    if (cached !== undefined && now - cached.at >= 0 && now - cached.at < SIZE_CACHE_MS) {
      return Promise.resolve(cached.bytes);
    }
    const running = this.counting.get(folderId);
    if (running !== undefined) {
      return running;
    }
    const list = Array.isArray(dirs) ? dirs : [dirs];
    const count = Promise.all(list.map((dir) => directorySize(dir)))
      .then((sizes) => {
        const bytes = sizes.reduce((sum, size) => sum + size, 0);
        if (this.counting.get(folderId) === count) {
          this.sizes.set(folderId, { at: now, bytes });
        }
        return bytes;
      })
      .finally(() => {
        if (this.counting.get(folderId) === count) {
          this.counting.delete(folderId);
        }
      });
    this.counting.set(folderId, count);
    return count;
  }

  // Versions, libraries, assets and Java are shared by every server: their bytes are on disk
  // once, and the library counts them once beside the folders of the servers.
  sharedSize(): Promise<number> {
    const { layout } = this.options;
    const shared = [layout.versions, layout.libraries, layout.assets, layout.runtime];
    return this.cachedSize(SHARED_FILES_KEY, shared);
  }
}
