import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  instanceOverridesFile,
  readInstanceOverrides,
  withFolderOverrides,
  writeInstanceOverrides,
} from './instance-overrides';

let instance: string;

beforeEach(async () => {
  instance = await mkdtemp(join(tmpdir(), 'mcmonitor-instance-'));
});

afterEach(async () => {
  await rm(instance, { recursive: true, force: true });
});

describe('instance overrides', () => {
  it('are written by merging and preserve unrelated fields', async () => {
    await writeFile(instanceOverridesFile(instance), JSON.stringify({ loader: 'fabric' }));
    await writeInstanceOverrides(instance, { memoryMb: 6144 });
    await writeInstanceOverrides(instance, { javaMajor: 21, javaFor: '1.21.11' });
    expect(await readInstanceOverrides(instance)).toEqual({
      memoryMb: 6144,
      javaMajor: 21,
      javaFor: '1.21.11',
    });
    expect(JSON.parse(await readFile(instanceOverridesFile(instance), 'utf8'))).toMatchObject({
      loader: 'fabric',
    });
  });

  it('garbage in the file is ignored', async () => {
    await writeFile(
      instanceOverridesFile(instance),
      JSON.stringify({ memoryMb: '9000', javaMajor: 22, javaFor: '1.21.11' }),
    );
    expect(await readInstanceOverrides(instance)).toEqual({});
    await writeFile(instanceOverridesFile(instance), JSON.stringify({ memoryMb: 512 }));
    expect(await readInstanceOverrides(instance)).toEqual({});
    await writeFile(instanceOverridesFile(instance), '{broken');
    expect(await readInstanceOverrides(instance)).toEqual({});
  });

  it('are mixed into the launch of the server folder', async () => {
    await writeInstanceOverrides(instance, { memoryMb: 2048, javaMajor: 21, javaFor: '1.21.11' });
    const bare = {
      folderId: 'server-12',
      runtime: { minecraft: '1.21.11', loader: 'vanilla' as const },
      memoryMb: null,
      javaOverride: null,
    };
    expect(await withFolderOverrides(bare, () => instance)).toMatchObject({
      memoryMb: 2048,
      javaOverride: 21,
    });
  });

  it("the server's Java is reset when the server changed its game version", async () => {
    await writeInstanceOverrides(instance, { javaMajor: 17, javaFor: '1.20.1' });
    const updated = {
      folderId: 'server-12',
      runtime: { minecraft: '1.21.11', loader: 'vanilla' as const },
      memoryMb: null,
      javaOverride: null,
    };
    expect((await withFolderOverrides(updated, () => instance)).javaOverride).toBeNull();
  });

  it('javaMajor: null clears the Java override', async () => {
    await writeInstanceOverrides(instance, { javaMajor: 17, javaFor: '1.20.1' });
    await writeInstanceOverrides(instance, { javaMajor: null });
    expect(await readInstanceOverrides(instance)).toEqual({});
  });

  it('nothing is written into a removed folder', async () => {
    await expect(
      writeInstanceOverrides(join(instance, 'gone'), { memoryMb: 4096 }),
    ).rejects.toMatchObject({ error: { code: 'file-missing' } });
  });
});
