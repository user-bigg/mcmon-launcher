import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { isModSlug, isShaderOptions, type ModPick } from '@shared/mods';
import { isVerified, storeFile, storeVerified, verified } from '../skins/mod-file';

export const SHADERPACKS_DIR = 'shaderpacks';
export const IRIS_PROPERTIES = path.join('config', 'iris.properties');
export const MAX_PROPERTIES_BYTES = 1024 * 1024;

export interface ShaderSetup {
  instance: string;
  pack: { pick: ModPick; stored: string } | null;
  ownPacks: readonly string[];
  iris: boolean;
  log: (message: string) => void;
}

export function shaderPackName(slug: string): string {
  if (!isModSlug(slug)) {
    throw new Error('shader pack: malformed slug');
  }
  return `${slug}.zip`;
}

export function shaderProfile(options: Record<string, string> | null): string | null {
  if (options === null) {
    return null;
  }
  return isShaderOptions(options)
    ? Object.entries(options)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')
    : null;
}

function propertyKey(line: string): string | null {
  const trimmed = line.trimStart();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) {
    return null;
  }
  const match = /^([^=:\s]+)\s*[=:]/.exec(trimmed);
  return match?.[1] ?? null;
}

// Only the keys the launcher owns change; the rest of the file is Iris's and the player's.
export function withIrisKeys(current: string, keys: ReadonlyMap<string, string>): string {
  const lines = current === '' ? [] : current.replace(/\r?\n$/, '').split(/\r?\n/);
  const left = new Set(keys.keys());
  const changed = lines.map((line) => {
    const key = propertyKey(line);
    const value = key === null ? undefined : keys.get(key);
    if (key === null || value === undefined) {
      return line;
    }
    left.delete(key);
    return `${key}=${value}`;
  });
  const added = [...left].map((key) => `${key}=${keys.get(key) ?? ''}`);
  return `${[...changed, ...added].join('\n')}\n`;
}

// The file of the player is left as it is when the launcher cannot read it whole: writing
// three keys over it would lose everything else in it.
async function readProperties(file: string): Promise<string | null> {
  try {
    const bytes = await readFile(file);
    return bytes.byteLength > MAX_PROPERTIES_BYTES ? null : bytes.toString('utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : null;
  }
}

async function placePack(dir: string, pack: NonNullable<ShaderSetup['pack']>): Promise<string[]> {
  const { pick, stored } = pack;
  const name = shaderPackName(pick.mod.slug);
  const target = path.join(dir, name);
  if (!(await isVerified(target, pick.file))) {
    const bytes = await verified(stored, pick.file);
    if (bytes === null) {
      throw new Error('shader pack: stored file failed the hash check');
    }
    await rm(target, { recursive: true, force: true });
    await storeVerified(target, bytes, pick.file);
  }
  const profile = shaderProfile(pick.mod.options);
  if (profile === null) {
    return [name];
  }
  await storeFile(path.join(dir, `${name}.txt`), Buffer.from(profile, 'utf8'));
  return [name, `${name}.txt`];
}

async function writeIris(setup: ShaderSetup, pack: string | null): Promise<void> {
  const file = path.join(setup.instance, IRIS_PROPERTIES);
  const current = await readProperties(file);
  if (current === null) {
    setup.log('mods: iris.properties left as it is: too large or not readable');
    return;
  }
  const keys = new Map(
    pack === null
      ? [['enableShaders', 'false']]
      : [
          ['shaderPack', pack],
          ['enableShaders', 'true'],
          ['disableUpdateMessage', 'true'],
        ],
  );
  await storeFile(file, Buffer.from(withIrisKeys(current, keys), 'utf8'));
}

// The packs the launcher put there itself leave when they are not in this launch; a pack the
// player put there stays. Iris and its settings are touched only in a game that has Iris.
export async function setUpShaders(setup: ShaderSetup): Promise<void> {
  const dir = path.join(setup.instance, SHADERPACKS_DIR);
  if (setup.pack !== null) {
    await mkdir(dir, { recursive: true });
  }
  const kept = setup.pack === null ? [] : await placePack(dir, setup.pack);
  const own = setup.ownPacks.filter(isModSlug).flatMap((slug) => {
    const name = shaderPackName(slug);
    return [name, `${name}.txt`];
  });
  for (const name of own.filter((item) => !kept.includes(item))) {
    await rm(path.join(dir, name), { recursive: true, force: true });
  }
  if (setup.iris) {
    await writeIris(setup, setup.pack === null ? null : shaderPackName(setup.pack.pick.mod.slug));
  }
}
