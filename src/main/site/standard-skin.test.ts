import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSkinPng,
  MAX_SKIN_BYTES,
  STANDARD_SKIN_ENTRIES,
  STANDARD_SKIN_URL,
  StandardSkin,
} from './standard-skin';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(width: number, height: number, length = 64, mark = 1): Uint8Array {
  const bytes = new Uint8Array(length).fill(mark);
  bytes.set(SIGNATURE);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Setup {
  skin: StandardSkin;
  file: string;
  readJarEntry: ReturnType<typeof vi.fn<(jar: string) => Promise<Uint8Array | null>>>;
  download: ReturnType<typeof vi.fn<(url: string, max: number) => Promise<Uint8Array | null>>>;
  versionsDir: string;
}

async function setup(
  versions: string[],
  jars: Record<string, Uint8Array | null> = {},
  remote: Uint8Array | null = null,
): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), 'standard-skin-'));
  roots.push(root);
  const versionsDir = join(root, 'game', 'versions');
  await Promise.all(versions.map((id) => mkdir(join(versionsDir, id), { recursive: true })));
  const file = join(root, 'cache', 'icons', 'standard.png');
  const readJarEntry = vi.fn((jar: string) => {
    const id = versions.find((item) => jar === join(versionsDir, item, `${item}.jar`));
    return id === undefined
      ? Promise.reject(new Error('not a client jar'))
      : Promise.resolve(jars[id] ?? null);
  });
  const download = vi.fn(() => Promise.resolve(remote));
  const skin = new StandardSkin({ versionsDir, file, readJarEntry, download, log: vi.fn() });
  return { skin, file, readJarEntry, download, versionsDir };
}

describe('isSkinPng', () => {
  it('accepts a 64×64 PNG of a sane size only', () => {
    expect(isSkinPng(png(64, 64))).toBe(true);
    expect(isSkinPng(png(64, 32))).toBe(false);
    expect(isSkinPng(png(128, 128))).toBe(false);
    expect(isSkinPng(png(64, 64, MAX_SKIN_BYTES + 1))).toBe(false);
    expect(isSkinPng(new Uint8Array(64))).toBe(false);
    expect(isSkinPng(png(64, 64).slice(0, 20))).toBe(false);
  });
});

describe('StandardSkin', () => {
  it('takes the skin from the client jar of an installed version and asks no server', async () => {
    const { skin, file, readJarEntry, download, versionsDir } = await setup(['1.21.1'], {
      '1.21.1': png(64, 64, 64, 7),
    });
    expect(await skin.ensure()).toBe(true);
    expect(readJarEntry).toHaveBeenCalledWith(
      join(versionsDir, '1.21.1', '1.21.1.jar'),
      STANDARD_SKIN_ENTRIES,
    );
    expect(download).not.toHaveBeenCalled();
    expect(new Uint8Array(await readFile(file))).toEqual(png(64, 64, 64, 7));
  });

  it('skips versions without a client jar or with an old 64×32 skin', async () => {
    const { skin, file, download } = await setup(
      ['fabric-loader-0.19.5-1.21.1', '26.2', '1.7.10'],
      { '26.2': png(64, 64, 64, 9), '1.7.10': png(64, 32) },
    );
    expect(await skin.ensure()).toBe(true);
    expect(download).not.toHaveBeenCalled();
    expect(new Uint8Array(await readFile(file))).toEqual(png(64, 64, 64, 9));
  });

  it('with no game installed takes it from the texture server of the game', async () => {
    const { skin, file, download } = await setup([], {}, png(64, 64, 64, 5));
    expect(await skin.ensure()).toBe(true);
    expect(download).toHaveBeenCalledWith(STANDARD_SKIN_URL, MAX_SKIN_BYTES);
    expect(new URL(STANDARD_SKIN_URL).host).toBe('textures.minecraft.net');
    expect(new Uint8Array(await readFile(file))).toEqual(png(64, 64, 64, 5));
  });

  it('keeps the file: the second call reads neither jars nor the network', async () => {
    const { skin, readJarEntry, download } = await setup([], {}, png(64, 64));
    await skin.ensure();
    expect(await skin.ensure()).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(readJarEntry).not.toHaveBeenCalled();
  });

  it('rejects what is not a 64×64 PNG and tries again next time', async () => {
    const { skin, file, download } = await setup([], {}, png(64, 32));
    expect(await skin.ensure()).toBe(false);
    await expect(readFile(file)).rejects.toThrow();
    download.mockResolvedValueOnce(null);
    expect(await skin.ensure()).toBe(false);
    download.mockRejectedValueOnce(new Error('offline'));
    expect(await skin.ensure()).toBe(false);
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('a damaged kept file is replaced', async () => {
    const { skin, file } = await setup(['1.21.1'], { '1.21.1': png(64, 64, 64, 3) });
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'not a picture');
    expect(await skin.ensure()).toBe(true);
    expect(new Uint8Array(await readFile(file))).toEqual(png(64, 64, 64, 3));
  });
});
