import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isValidVersionId } from '@shared/launch';
import { isPng } from './assets';

// The game's own texture server: the default skin comes from here only while no version of the
// game is installed. The launcher keeps no copy of the texture in its code.
export const STANDARD_SKIN_URL =
  'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb';
export const STANDARD_SKIN_ENTRIES = [
  'assets/minecraft/textures/entity/player/wide/steve.png',
  'assets/minecraft/textures/entity/steve.png',
] as const;
export const MAX_SKIN_BYTES = 100 * 1024;

const SKIN_SIZE = 64;
const IHDR_END = 24;
const MAX_VERSIONS = 64;

export interface StandardSkinDeps {
  versionsDir: string;
  file: string;
  readJarEntry: (jar: string, names: readonly string[]) => Promise<Uint8Array | null>;
  download: (url: string, maxBytes: number) => Promise<Uint8Array | null>;
  log: (message: string) => void;
}

export function isSkinPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < IHDR_END || bytes.byteLength > MAX_SKIN_BYTES || !isPng(bytes)) {
    return false;
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, IHDR_END);
  return header.getUint32(16) === SKIN_SIZE && header.getUint32(20) === SKIN_SIZE;
}

async function installedJars(versionsDir: string): Promise<string[]> {
  const names = await readdir(versionsDir).catch((): string[] => []);
  return names
    .filter(isValidVersionId)
    .toSorted()
    .toReversed()
    .slice(0, MAX_VERSIONS)
    .map((id) => join(versionsDir, id, `${id}.jar`));
}

export class StandardSkin {
  private running: Promise<boolean> | null = null;

  constructor(private readonly deps: StandardSkinDeps) {}

  ensure(): Promise<boolean> {
    this.running ??= this.find().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async find(): Promise<boolean> {
    const kept = await readFile(this.deps.file).catch(() => null);
    if (kept !== null && isSkinPng(kept)) {
      return true;
    }
    const found = (await this.fromGame()) ?? (await this.fromTextureServer());
    return found !== null && (await this.keep(found));
  }

  private async fromGame(): Promise<Uint8Array | null> {
    for (const jar of await installedJars(this.deps.versionsDir)) {
      const bytes = await this.deps.readJarEntry(jar, STANDARD_SKIN_ENTRIES).catch(() => null);
      if (bytes !== null && isSkinPng(bytes)) {
        return bytes;
      }
    }
    return null;
  }

  private async fromTextureServer(): Promise<Uint8Array | null> {
    const bytes = await this.deps.download(STANDARD_SKIN_URL, MAX_SKIN_BYTES).catch(() => null);
    if (bytes !== null && isSkinPng(bytes)) {
      return bytes;
    }
    this.deps.log(`skins: standard skin ${bytes === null ? 'not loaded' : 'rejected'}`);
    return null;
  }

  private async keep(bytes: Uint8Array): Promise<boolean> {
    const temporary = `${this.deps.file}.${String(process.pid)}.tmp`;
    try {
      await mkdir(dirname(this.deps.file), { recursive: true });
      await writeFile(temporary, bytes);
      await rename(temporary, this.deps.file);
      return true;
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      return false;
    }
  }
}
