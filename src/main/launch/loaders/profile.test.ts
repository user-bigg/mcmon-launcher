import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LaunchFailure } from '../errors';
import {
  hashProfileLibraries,
  libraryDigests,
  parseLoaderProfile,
  profileArguments,
} from './profile';
import { LoaderStageError } from './sources';

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
}

const SHA1 = 'ff9e65cffca4a67f31523e1807fe0855940fcbfa';
const UNHASHED = {
  inheritsFrom: '26.3',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  libraries: [{ name: 'net.fabricmc:fabric-loader:0.19.5', url: 'https://maven.fabricmc.net/' }],
};

describe('parseLoaderProfile', () => {
  it('the profile must inherit the requested game version', () => {
    expect(parseLoaderProfile(fixture('fabric-profile.json'), '26.3').inheritsFrom).toBe('26.3');
    expect(() => parseLoaderProfile(fixture('fabric-profile.json'), '26.2')).toThrow(
      LoaderStageError,
    );
    expect(() => parseLoaderProfile('<html>', '26.3')).toThrow(LoaderStageError);
  });

  it('mainClass is just the Java class name', () => {
    const profile = { inheritsFrom: '26.3', libraries: [], mainClass: '-javaagent:evil.jar' };
    expect(() => parseLoaderProfile(JSON.stringify(profile), '26.3')).toThrow(LoaderStageError);
  });
});

describe('profileArguments', () => {
  it("only known -D flags pass through from the metadata's JVM arguments; game arguments pass through as strings", () => {
    const args = profileArguments({
      arguments: {
        jvm: [
          '-DFabricMcEmu= net.minecraft.client.main.Main ',
          '-javaagent:/tmp/evil.jar',
          '-Dfabric.debug.disableModShuffle=true',
          '-XX:+UnlockDiagnosticVMOptions',
          { rules: [], value: '-Dx=1' },
        ],
        game: ['--fml.mcVersion', 7],
      },
    });
    expect(args).toEqual({
      jvm: [
        '-DFabricMcEmu= net.minecraft.client.main.Main ',
        '-Dfabric.debug.disableModShuffle=true',
      ],
      game: ['--fml.mcVersion'],
    });
  });

  it('only the needed fields make it into the version profile', async () => {
    const profile = {
      ...JSON.parse(fixture('fabric-profile.json')),
      logging: { client: { file: { url: 'https://evil.example/log4j.xml' } } },
      downloads: { client: { url: 'https://evil.example/client.jar' } },
    } as Record<string, unknown>;
    const hashed = await hashProfileLibraries(profile, 'fabric-loader-0.19.5-26.3', () =>
      Promise.resolve(SHA1),
    );
    expect(Object.keys(hashed).sort()).toEqual([
      'arguments',
      'id',
      'inheritsFrom',
      'libraries',
      'mainClass',
      'releaseTime',
      'time',
      'type',
    ]);
  });

  it("sha256 from Fabric's metadata is used for extra verification", () => {
    const digests = libraryDigests(
      JSON.parse(fixture('fabric-profile.json')) as Record<string, unknown>,
    );
    expect(digests.get('org.ow2.asm:asm:9.10.1')).toBe(
      'ed825d10ab1399c8c0cb669e688cf0c8c82629b4c8399b58352b68e92ca10fcb',
    );
  });
});

describe('hashProfileLibraries', () => {
  it("Fabric: hashes come from the metadata; a missing one comes from the same maven's .sha1", async () => {
    const profile = parseLoaderProfile(fixture('fabric-profile.json'), '26.3');
    const lookup = vi.fn((url: string) => Promise.resolve(url.length > 0 ? SHA1 : ''));
    const hashed = await hashProfileLibraries(profile, 'fabric-loader-0.19.5-26.3', lookup);
    expect(hashed.id).toBe('fabric-loader-0.19.5-26.3');
    expect(hashed.inheritsFrom).toBe('26.3');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(
      'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar',
    );
    expect(hashed.libraries[0]).toEqual({
      name: 'org.ow2.asm:asm:9.10.1',
      downloads: {
        artifact: {
          path: 'org/ow2/asm/asm/9.10.1/asm-9.10.1.jar',
          url: 'https://maven.fabricmc.net/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar',
          sha1: 'ada2141c0cc52ee8f5c48cd5fa4ce0e794f22236',
          size: 126151,
        },
      },
    });
    expect(hashed.libraries.every((library) => library.downloads.artifact.sha1.length === 40)).toBe(
      true,
    );
  });

  it('a library without a hash in the metadata gets it from maven', async () => {
    const lookup = vi.fn(() => Promise.resolve(SHA1));
    const hashed = await hashProfileLibraries(UNHASHED, 'fabric-loader-0.19.5-26.3', lookup);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(hashed.libraries[0]?.downloads.artifact).toMatchObject({
      url: 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar',
      sha1: SHA1,
    });
  });

  it('a library from an untrusted host or served over http is not downloaded', async () => {
    const lookup = vi.fn(() => Promise.resolve(SHA1));
    const evil = {
      inheritsFrom: '26.3',
      mainClass: 'x',
      libraries: [{ name: 'a:b:1', url: 'https://evil.example/' }],
    };
    await expect(hashProfileLibraries(evil, 'x', lookup)).rejects.toThrow(LoaderStageError);
    const plain = { ...evil, libraries: [{ name: 'a:b:1', url: 'http://maven.fabricmc.net/' }] };
    await expect(hashProfileLibraries(plain, 'x', lookup)).rejects.toThrow(LoaderStageError);
    const traversal = {
      ...evil,
      libraries: [{ name: '../../x:b:1', url: 'https://maven.fabricmc.net/' }],
    };
    await expect(hashProfileLibraries(traversal, 'x', lookup)).rejects.toThrow(LoaderStageError);
    const dots = { ...evil, libraries: [{ name: '..:..:..', url: 'https://maven.fabricmc.net/' }] };
    await expect(hashProfileLibraries(dots, 'x', lookup)).rejects.toThrow(LoaderStageError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a traversing library path is replaced by one from its coordinate', async () => {
    const lookup = vi.fn(() => Promise.resolve(SHA1));
    for (const path of [
      '../../../../AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/x.jar',
      '/etc/x.jar',
      'a\\..\\..\\x.jar',
      'a/./b.jar',
      'a//b.jar',
      '',
    ]) {
      const profile = {
        inheritsFrom: '26.3',
        mainClass: 'x',
        libraries: [
          {
            name: 'net.fabricmc:fabric-loader:0.17.2',
            downloads: {
              artifact: { path, url: 'https://maven.fabricmc.net/x.jar', sha1: SHA1, size: 1 },
            },
          },
        ],
      };
      const hashed = await hashProfileLibraries(profile, 'x', lookup);
      expect(hashed.libraries[0]?.downloads.artifact.path).toBe(
        'net/fabricmc/fabric-loader/0.17.2/fabric-loader-0.17.2.jar',
      );
    }
  });

  it('no hash available on maven is an error, not an unverified launch', async () => {
    const lookup = vi.fn(() =>
      Promise.reject(new LaunchFailure({ code: 'checksum-mismatch', file: 'x' })),
    );
    await expect(hashProfileLibraries(UNHASHED, 'x', lookup)).rejects.toThrow(LaunchFailure);
  });
});
