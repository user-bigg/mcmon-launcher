import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogMod, ModPick } from '@shared/mods';
import {
  MAX_PROPERTIES_BYTES,
  setUpShaders,
  shaderPackName,
  shaderProfile,
  withIrisKeys,
  type ShaderSetup,
} from './shaders';

const ZIP = Buffer.from('a shader pack');
const SHA = createHash('sha256').update(ZIP).digest('hex');

let root: string;
let instance: string;
let stored: string;

function pick(
  options: Record<string, string> | null = { profile: 'low' },
  slug = 'makeup',
): ModPick {
  const mod = {
    slug,
    kind: 'shader_pack',
    title: 'MakeUp',
    short: 'Лёгкие',
    summary: '',
    group: 'graphics',
    player: false,
    server: false,
    often_forbidden: false,
    requires: ['iris'],
    modrinth_id: 'izsIPI7a',
    license: 'x',
    source_url: null,
    credit: null,
    options,
    files: [],
  } satisfies CatalogMod;
  return {
    mod,
    file: {
      minecraft: '1.21.11',
      loader: null,
      loader_min: null,
      version: '9.4c',
      channel: 'release',
      urls: ['https://mc-mon.ru/storage/mods/x.zip'],
      sha256: SHA,
      size: ZIP.byteLength,
      requires: ['iris'],
    },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-shaders-'));
  instance = join(root, 'instance');
  stored = join(root, 'store', `${SHA}.zip`);
  await mkdir(join(root, 'store'), { recursive: true });
  await writeFile(stored, ZIP);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function listShaderpacks(): Promise<string[]> {
  return (await readdir(join(instance, 'shaderpacks')).catch(() => [])).sort();
}

function iris(): Promise<string> {
  return readFile(join(instance, 'config', 'iris.properties'), 'utf8');
}

function setup(patch: Partial<ShaderSetup> = {}): ShaderSetup {
  return {
    instance,
    pack: { pick: pick(), stored },
    ownPacks: ['makeup', 'complementary'],
    iris: true,
    log: vi.fn(),
    ...patch,
  };
}

async function writeIris(text: string | Buffer): Promise<void> {
  await mkdir(join(instance, 'config'), { recursive: true });
  await writeFile(join(instance, 'config', 'iris.properties'), text);
}

async function writePack(name: string): Promise<void> {
  await mkdir(join(instance, 'shaderpacks'), { recursive: true });
  await writeFile(join(instance, 'shaderpacks', name), 'x');
}

describe('withIrisKeys', () => {
  it('changes only its own keys and keeps every other line, comments included', () => {
    const current =
      '#Iris\r\nmaxShadowRenderDistance=32\nshaderPack=Old.zip\nenableShaders = false\n';
    const keys = new Map([
      ['shaderPack', 'makeup.zip'],
      ['enableShaders', 'true'],
      ['disableUpdateMessage', 'true'],
    ]);
    expect(withIrisKeys(current, keys)).toBe(
      '#Iris\nmaxShadowRenderDistance=32\nshaderPack=makeup.zip\nenableShaders=true\ndisableUpdateMessage=true\n',
    );
  });

  it('writes the keys into an empty file and leaves a key inside a comment alone', () => {
    const off = new Map([['enableShaders', 'false']]);
    expect(withIrisKeys('', off)).toBe('enableShaders=false\n');
    expect(withIrisKeys('# enableShaders=true\n', off)).toBe(
      '# enableShaders=true\nenableShaders=false\n',
    );
  });

  it('a line named like a property of every object stays as it is', () => {
    const current = 'constructor=1\ntoString=x\n__proto__=y\nhasOwnProperty=z\n';
    expect(withIrisKeys(current, new Map([['enableShaders', 'false']]))).toBe(
      `${current}enableShaders=false\n`,
    );
  });
});

describe('shaderProfile', () => {
  it('writes key=value lines and refuses anything that could add lines or paths', () => {
    expect(shaderProfile({ profile: 'HIGH', shadowDistance: '2.5' })).toBe(
      'profile=HIGH\nshadowDistance=2.5\n',
    );
    expect(shaderProfile(null)).toBeNull();
    expect(shaderProfile({})).toBeNull();
    expect(shaderProfile({ profile: 'low\nenableShaders=true' })).toBeNull();
    expect(shaderProfile({ '../x': 'y' })).toBeNull();
    expect(shaderProfile({ profile: 'a b' })).toBeNull();
  });
});

describe('shaderPackName', () => {
  it('names the file by the slug and refuses a slug that is a path or a device', () => {
    expect(shaderPackName('complementary-reimagined')).toBe('complementary-reimagined.zip');
    for (const slug of ['../evil', 'Evil', 'con', 'nul', 'lpt1']) {
      expect(() => shaderPackName(slug)).toThrow();
    }
  });
});

describe('setUpShaders', () => {
  it('lays out the pack and its profile, removes its own other packs and turns shaders on', async () => {
    await writePack('complementary.zip');
    await writePack('complementary.zip.txt');
    await writeIris('colorSpace=SRGB\nshaderPack=old.zip\n');
    await setUpShaders(setup());
    expect(await listShaderpacks()).toEqual(['makeup.zip', 'makeup.zip.txt']);
    expect(await readFile(join(instance, 'shaderpacks', 'makeup.zip'))).toEqual(ZIP);
    expect(await readFile(join(instance, 'shaderpacks', 'makeup.zip.txt'), 'utf8')).toBe(
      'profile=low\n',
    );
    expect(await iris()).toBe(
      'colorSpace=SRGB\nshaderPack=makeup.zip\nenableShaders=true\ndisableUpdateMessage=true\n',
    );
  });

  it('packs the player put there are not touched', async () => {
    await mkdir(join(instance, 'shaderpacks', 'BSL'), { recursive: true });
    await writePack('Sildurs.zip');
    await writePack('Sildurs.zip.txt');
    await setUpShaders(setup({ pack: null }));
    expect(await listShaderpacks()).toEqual(['BSL', 'Sildurs.zip', 'Sildurs.zip.txt']);
  });

  it('a pack with bad options goes in without a profile, and an old profile leaves', async () => {
    await writePack('makeup.zip.txt');
    await setUpShaders(setup({ pack: { pick: pick({ profile: 'x=y' }), stored } }));
    expect(await listShaderpacks()).toEqual(['makeup.zip']);
  });

  it('shaders off with Iris: the own pack leaves and Iris keeps shaders off', async () => {
    await writePack('makeup.zip');
    await writeIris('shaderPack=makeup.zip\nenableShaders=true\n');
    await setUpShaders(setup({ pack: null }));
    expect(await listShaderpacks()).toEqual([]);
    expect(await iris()).toBe('shaderPack=makeup.zip\nenableShaders=false\n');
  });

  it('without Iris in the game its settings stay as the player left them', async () => {
    await writeIris('shaderPack=Sildurs.zip\nenableShaders=true\n');
    await setUpShaders(setup({ pack: null, iris: false }));
    expect(await iris()).toBe('shaderPack=Sildurs.zip\nenableShaders=true\n');
    await rm(join(instance, 'config'), { recursive: true });
    await setUpShaders(setup({ pack: null, iris: false }));
    await expect(iris()).rejects.toThrow();
  });

  it('an iris.properties over the limit is left as it is and the journal says so', async () => {
    const big = Buffer.alloc(MAX_PROPERTIES_BYTES + 1, 'a');
    await writeIris(big);
    const log = vi.fn();
    await setUpShaders(setup({ log }));
    expect((await readFile(join(instance, 'config', 'iris.properties'))).equals(big)).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('iris.properties left as it is'));
  });

  it('a stored file that does not match its hash never reaches the game', async () => {
    await writeFile(stored, 'tampered');
    await expect(setUpShaders(setup())).rejects.toThrow();
    expect(await listShaderpacks()).toEqual([]);
  });

  it('a pack already in place with the right hash is kept as it is', async () => {
    await setUpShaders(setup());
    await rm(stored);
    await setUpShaders(setup());
    expect(await readFile(join(instance, 'shaderpacks', 'makeup.zip'))).toEqual(ZIP);
  });
});
