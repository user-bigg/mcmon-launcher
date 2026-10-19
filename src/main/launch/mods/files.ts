import path from 'node:path';
import { isSha256 } from '@shared/skin-mod';
import { MOD_FILE_EXTENSION, type ModPick } from '@shared/mods';
import type { GameLayout } from '../layout';
import { downloadModFile, isVerified, storeVerified, type ModFetch } from '../skins/mod-file';

export interface ModProgress {
  active: (slug: string) => void;
  bytes: (slug: string, done: number) => void;
  done: (slug: string, fromDisk: boolean) => void;
  failed: (slug: string) => void;
}

export interface ModFilesOptions {
  layout: GameLayout;
  picks: readonly ModPick[];
  fetch: ModFetch;
  signal: AbortSignal;
  log: (message: string) => void;
  progress: ModProgress;
}

export function modFilesRoot(layout: GameLayout): string {
  return path.join(layout.root, 'mod-files');
}

// The file is named by its hash, so a copy kept here never needs refreshing and serves
// every instance and every launch.
export function storedModFile(layout: GameLayout, pick: ModPick): string {
  if (!isSha256(pick.file.sha256)) {
    throw new Error('catalog mod: malformed sha256');
  }
  return path.join(modFilesRoot(layout), `${pick.file.sha256}${MOD_FILE_EXTENSION[pick.mod.kind]}`);
}

async function obtain(pick: ModPick, options: ModFilesOptions): Promise<boolean> {
  const { layout, signal, log, progress } = options;
  const slug = pick.mod.slug;
  const file = storedModFile(layout, pick);
  if (await isVerified(file, pick.file)) {
    progress.done(slug, true);
    return true;
  }
  progress.active(slug);
  const bytes = await downloadModFile(
    pick.file,
    { fetch: options.fetch, signal, log, label: `mods ${slug}` },
    (done) => {
      progress.bytes(slug, done);
    },
  );
  if (bytes === null) {
    progress.failed(slug);
    return false;
  }
  await storeVerified(file, bytes, pick.file);
  progress.done(slug, false);
  return true;
}

export async function obtainModFiles(options: ModFilesOptions): Promise<Set<string>> {
  const failed = new Set<string>();
  for (const pick of options.picks) {
    options.signal.throwIfAborted();
    try {
      if (!(await obtain(pick, options))) {
        failed.add(pick.mod.slug);
      }
    } catch (error) {
      options.signal.throwIfAborted();
      options.log(`mods ${pick.mod.slug}: not stored: ${String(error)}`);
      options.progress.failed(pick.mod.slug);
      failed.add(pick.mod.slug);
    }
  }
  return failed;
}
