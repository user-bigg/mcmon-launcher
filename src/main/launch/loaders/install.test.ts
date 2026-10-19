import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MinecraftFolder, type ResolvedLibrary } from '@xmcl/core';
import {
  createNodeInstallRuntime,
  executeInstallManifest,
  type InstallFile,
} from '@xmcl/installer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrackedRuntime } from '../download';
import { gameLayout, type GameLayout } from '../layout';
import { declaredSourceOnly, installLoader } from './install';
import { pinsFile, readPins } from './pins';
import { LoaderStageError } from './sources';

let root: string;
let folder: MinecraftFolder;
let layout: GameLayout;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-loader-install-'));
  folder = MinecraftFolder.from(root);
  layout = gameLayout(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function contentTransfer(contents: Map<string, string>): TrackedRuntime {
  const runtime = createNodeInstallRuntime({
    download: async (files: InstallFile[]): Promise<void> => {
      for (const file of files) {
        const body = contents.get(file.urls[0] ?? '');
        if (body === undefined) {
          throw Object.assign(new Error('HTTP 404'), { statusCode: 404 });
        }
        await mkdir(dirname(file.path), { recursive: true });
        await writeFile(file.path, body);
      }
    },
  });
  return {
    runtime,
    downloadedBytes: () => 0,
    onInstallEvent: () => undefined,
    execute: async (plan): Promise<void> => {
      await executeInstallManifest(plan, runtime, { attempts: 1 });
    },
  };
}

describe('declaredSourceOnly', () => {
  it('only the address from the profile, and only from a trusted host', () => {
    const library = (url: string): ResolvedLibrary =>
      ({
        download: { url, path: 'a/b/1/b-1.jar', sha1: '', size: 0 },
      }) as unknown as ResolvedLibrary;
    expect(declaredSourceOnly(library(''))).toEqual([]);
    expect(declaredSourceOnly(library('https://maven.fabricmc.net/a.jar'))).toEqual([
      'https://maven.fabricmc.net/a.jar',
    ]);
    expect(() => declaredSourceOnly(library('https://repo.spongepowered.org/a.jar'))).toThrow(
      LoaderStageError,
    );
    expect(() => declaredSourceOnly(library('http://maven.fabricmc.net/a.jar'))).toThrow(
      LoaderStageError,
    );
  });
});

describe('installLoader: Fabric end to end', () => {
  const libraryBody = 'fabric-loader-jar';
  const libraryUrl =
    'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar';
  const runtime = { minecraft: '26.3', loader: 'fabric', loaderVersion: '0.19.5' } as const;

  function profile(library: Record<string, unknown>): string {
    return JSON.stringify({
      id: 'fabric-loader-0.19.5-26.3',
      inheritsFrom: '26.3',
      type: 'release',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      arguments: {
        game: [],
        jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main ', '-javaagent:x.jar'],
      },
      libraries: [library],
    });
  }

  function options(text: string, body = libraryBody): Parameters<typeof installLoader>[0] {
    return {
      layout,
      folder,
      runtime,
      fetch: (url) =>
        url.endsWith('/profile/json')
          ? Promise.resolve(text)
          : Promise.reject(Object.assign(new Error('HTTP 404'), { statusCode: 404 })),
      signal: new AbortController().signal,
      transfer: contentTransfer(new Map([[libraryUrl, body]])),
    };
  }

  it('installs the profile, checks sha1 and sha256, pins hashes, and cleans up JVM arguments', async () => {
    const id = await installLoader(
      options(
        profile({
          name: 'net.fabricmc:fabric-loader:0.19.5',
          url: 'https://maven.fabricmc.net/',
          sha1: sha1(libraryBody),
          sha256: sha256(libraryBody),
          size: libraryBody.length,
        }),
      ),
    );
    expect(id).toBe('fabric-loader-0.19.5-26.3');
    const pins = await readPins(pinsFile(layout, id), id);
    expect(pins?.files).toEqual({
      'libraries/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar': {
        sha1: sha1(libraryBody),
      },
    });
    const version = JSON.parse(await readFile(folder.getVersionJson(id), 'utf8')) as {
      arguments: { jvm: string[] };
    };
    expect(version.arguments.jvm).toEqual(['-DFabricMcEmu= net.minecraft.client.main.Main ']);
  });

  it('a mismatched sha256 from the metadata produces checksum-mismatch', async () => {
    await expect(
      installLoader(
        options(
          profile({
            name: 'net.fabricmc:fabric-loader:0.19.5',
            url: 'https://maven.fabricmc.net/',
            sha1: sha1(libraryBody),
            sha256: 'f'.repeat(64),
          }),
        ),
      ),
    ).rejects.toMatchObject({ error: { code: 'checksum-mismatch' } });
  });

  it('on reinstall, a differing hash from maven prevents the loader from installing', async () => {
    const lib = { name: 'net.fabricmc:fabric-loader:0.19.5', url: 'https://maven.fabricmc.net/' };
    await installLoader(options(profile({ ...lib, sha1: sha1(libraryBody) })));
    await expect(
      installLoader(options(profile({ ...lib, sha1: sha1('swapped') }), 'swapped')),
    ).rejects.toMatchObject({
      error: { code: 'loader-install-failed', loader: 'fabric', stage: 'library' },
    });
  });

  it('a corrupt profile and an untrusted host both produce loader-install-failed with a stage', async () => {
    await expect(installLoader(options('<html>'))).rejects.toMatchObject({
      error: { code: 'loader-install-failed', stage: 'manifest' },
    });
    await expect(
      installLoader(options(profile({ name: 'a:b:1', url: 'https://repo.example.org/' }))),
    ).rejects.toMatchObject({
      error: {
        code: 'loader-install-failed',
        stage: 'library',
        detail: 'untrusted source repo.example.org',
      },
    });
  });
});
