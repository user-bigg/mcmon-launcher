import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Version, type Platform, type ResolvedVersion } from '@xmcl/core';
import type { InstallRuntime } from '@xmcl/installer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LaunchTarget } from '@shared/launch';
import type { TrackedRuntime } from './download';
import type { RegistryArchReader } from './game-arch';
import { writeInstanceOverrides } from './instance-overrides';
import { InstanceStore } from './instances';
import { pickJavaTarget, type JavaInstallOptions } from './java';
import { gameLayout, instanceDir, type JavaPlace } from './layout';
import { createLaunchService, type GameLaunchService, type LaunchDependencies } from './service';
import type { VersionEntry } from './version-manifest';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'arch');
const JAVA_INDEX = JSON.parse(
  readFileSync(join(FIXTURES, 'java-runtime-all.json'), 'utf8'),
) as Record<string, Record<string, { manifest: { url: string } }[]>>;

interface VersionFixture {
  javaVersion: { component: string; majorVersion: number };
  libraries: Parameters<typeof Version.resolveLibraries>[0];
}

interface JavaCall {
  component: string;
  place: JavaPlace | null;
  manifestUrl: string | null;
}

let root: string;
let javaCalls: JavaCall[];

function versionFor(id: string): ResolvedVersion {
  const fixture = JSON.parse(
    readFileSync(join(FIXTURES, `libraries-${id}.json`), 'utf8'),
  ) as VersionFixture;
  const platform: Platform = { name: 'windows', version: '10.0.26100', arch: 'x64' };
  return {
    id,
    minecraftVersion: id,
    javaVersion: fixture.javaVersion,
    libraries: Version.resolveLibraries(fixture.libraries, platform),
  } as unknown as ResolvedVersion;
}

function fakeTransfer(): TrackedRuntime {
  return {
    runtime: {} as InstallRuntime,
    downloadedBytes: () => 0,
    execute: () => Promise.resolve(),
    onInstallEvent: () => undefined,
  };
}

function installJava(options: JavaInstallOptions): Promise<string> {
  const place = options.place(JAVA_INDEX);
  const component = options.requirement.component;
  const target =
    place === null ? null : pickJavaTarget(JAVA_INDEX, place.mojangPlatform, component);
  javaCalls.push({ component, place, manifestUrl: target?.manifest.url ?? null });
  return Promise.resolve(join(place?.home ?? root, 'bin', 'javaw.exe'));
}

interface Prepared {
  service: GameLaunchService;
  target: LaunchTarget;
}

async function prepare(id: string, registryArch: RegistryArchReader | undefined): Promise<void> {
  const { service, target } = makeService(id, registryArch);
  expect(await service.prepare(target)).toMatchObject({ ok: true, value: { minecraft: id } });
  service.dispose();
}

function makeService(id: string, registryArch: RegistryArchReader | undefined): Prepared {
  const entry: VersionEntry = {
    id,
    type: 'release',
    url: `https://piston-meta.mojang.com/v1/packages/${'a'.repeat(40)}/${id}.json`,
    sha1: 'a'.repeat(40),
    releaseTime: '2026-09-01T00:00:00+00:00',
  };
  const dependencies: Partial<LaunchDependencies> = {
    findVersion: () => Promise.resolve(entry),
    installVersionJson: (_folder, item) => Promise.resolve(versionFor(item.id)),
    installJava,
    readVersionLock: () => Promise.resolve(undefined),
    writeVersionLock: () => Promise.resolve(true),
    removeVersionLock: () => Promise.resolve(),
    installAssetIndex: () => Promise.resolve(),
    installGameFiles: () => Promise.resolve(),
    verifyInstallation: () => Promise.resolve(),
    countVerifiedFiles: () => Promise.resolve(1),
    createTransfer: () => fakeTransfer(),
  };
  const instances = new InstanceStore({ layout: gameLayout(root), now: Date.now });
  const service = createLaunchService({
    root,
    platform: 'win32',
    arch: 'x64',
    ...(registryArch === undefined ? {} : { registryArch }),
    totalMemoryBytes: 16 * 1024 ** 3,
    fetch: () => Promise.resolve({}),
    instances,
    telemetry: () => undefined,
    dependencies,
  });
  const target: LaunchTarget = { kind: 'server', serverId: 3, minecraft: id, address: 'a.ru' };
  return { service, target };
}

function manifestUrl(platform: string, component: string): string | null {
  return JAVA_INDEX[platform]?.[component]?.[0]?.manifest.url ?? null;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-install-arch-'));
  javaCalls = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe('Java for the game on an x64 machine', () => {
  const readings: [string, RegistryArchReader | undefined][] = [
    ['AMD64 in the registry', (): Promise<string> => Promise.resolve('AMD64')],
    ['a failed registry reading', (): Promise<string> => Promise.reject(new Error('reg.exe'))],
    ['a registry reading without a value', (): Promise<null> => Promise.resolve(null)],
    ['no registry reader', undefined],
  ];

  it.each(readings)('%s: the x64 runtime in the old folder', async (_name, read) => {
    for (const [id, component] of [
      ['1.18.2', 'java-runtime-beta'],
      ['1.21.11', 'java-runtime-delta'],
      ['26.2', 'java-runtime-epsilon'],
    ] as const) {
      javaCalls = [];
      await prepare(id, read);
      expect(javaCalls).toEqual([
        {
          component,
          place: { mojangPlatform: 'windows-x64', home: join(root, 'runtime', component) },
          manifestUrl: manifestUrl('windows-x64', component),
        },
      ]);
    }
  });
});

describe('Java for the game on Windows ARM', () => {
  const arm64: RegistryArchReader = () => Promise.resolve('ARM64');

  it('versions from 1.19 get the arm64 runtime in its own folder', async () => {
    for (const [id, component] of [
      ['1.19', 'java-runtime-gamma'],
      ['1.21.11', 'java-runtime-delta'],
      ['26.2', 'java-runtime-epsilon'],
    ] as const) {
      javaCalls = [];
      await prepare(id, arm64);
      expect(javaCalls).toEqual([
        {
          component,
          place: {
            mojangPlatform: 'windows-arm64',
            home: join(root, 'runtime', 'windows-arm64', component),
          },
          manifestUrl: manifestUrl('windows-arm64', component),
        },
      ]);
      expect(javaCalls[0]?.manifestUrl).not.toBe(manifestUrl('windows-x64', component));
    }
  });

  it('1.18.2 keeps the x64 runtime in the old folder', async () => {
    await prepare('1.18.2', arm64);
    expect(javaCalls).toEqual([
      {
        component: 'java-runtime-beta',
        place: { mojangPlatform: 'windows-x64', home: join(root, 'runtime', 'java-runtime-beta') },
        manifestUrl: manifestUrl('windows-x64', 'java-runtime-beta'),
      },
    ]);
  });

  it('Java chosen for the server folder gets the architecture it exists for', async () => {
    const folder = instanceDir(gameLayout(root), 'server-3');
    await mkdir(folder, { recursive: true });
    await writeInstanceOverrides(folder, { javaMajor: 8, javaFor: '1.21.11' });
    await prepare('1.21.11', arm64);
    expect(javaCalls.map((call) => [call.component, call.place?.mojangPlatform])).toEqual([
      ['jre-legacy', 'windows-x64'],
    ]);
    expect(javaCalls[0]?.place?.home).toBe(join(root, 'runtime', 'jre-legacy'));
  });

  it('a launch cancelled while the registry is being read installs no Java', async () => {
    let asked = (): void => undefined;
    const reading = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const answers: ((value: string) => void)[] = [];
    const slow: RegistryArchReader = () => {
      asked();
      return new Promise<string>((resolve) => {
        answers.push(resolve);
      });
    };
    const { service, target } = makeService('1.21.11', slow);
    const prepared = service.prepare(target);
    await reading;
    await service.cancel();
    answers.forEach((answer) => {
      answer('ARM64');
    });
    expect(await prepared).toEqual({ ok: false, error: { code: 'cancelled' } });
    expect(javaCalls).toEqual([]);
    service.dispose();
  });
});
