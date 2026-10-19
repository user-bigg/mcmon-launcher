import path from 'node:path';
import type { InstanceLaunchOptions } from '@shared/instance';
import { readJson, writeJsonAtomic } from './json-cache';
import { instanceDir, type GameLayout } from './layout';

const FILE_NAME = 'launch-options.json';

// The choice is kept next to the instances, not inside one: a catalog server has no folder
// until its first install, and creating the folder would list the server as installed.
export function launchOptionsFile(layout: GameLayout): string {
  return path.join(layout.instances, FILE_NAME);
}

function storedIds(value: unknown): string[] {
  const list =
    typeof value === 'object' && value !== null
      ? (value as { withoutMods?: unknown }).withoutMods
      : undefined;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

export class LaunchOptionsStore {
  private loaded: Promise<Set<string>> | null = null;

  constructor(private readonly layout: GameLayout) {}

  async get(folderId: string): Promise<InstanceLaunchOptions> {
    this.check(folderId);
    return { withoutMods: (await this.ids()).has(folderId) };
  }

  // The set in memory changes before the file does, so a launch right after the switch
  // already sees the new choice.
  async setWithoutMods(folderId: string, off: boolean): Promise<InstanceLaunchOptions> {
    this.check(folderId);
    const ids = await this.ids();
    if (ids.has(folderId) !== off) {
      if (off) {
        ids.add(folderId);
      } else {
        ids.delete(folderId);
      }
      await this.save(ids);
    }
    return { withoutMods: off };
  }

  async forget(folderId: string): Promise<void> {
    const ids = await this.ids();
    if (ids.delete(folderId)) {
      await this.save(ids).catch(() => undefined);
    }
  }

  private check(folderId: string): void {
    instanceDir(this.layout, folderId);
  }

  private ids(): Promise<Set<string>> {
    this.loaded ??= readJson(launchOptionsFile(this.layout)).then(
      (value) => new Set(storedIds(value)),
    );
    return this.loaded;
  }

  private save(ids: ReadonlySet<string>): Promise<void> {
    return writeJsonAtomic(launchOptionsFile(this.layout), {
      schemaVersion: 1,
      withoutMods: [...ids].sort(),
    });
  }
}
