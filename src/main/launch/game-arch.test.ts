import { readFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { Version, type Platform } from '@xmcl/core';
import { describe, expect, it, vi } from 'vitest';
import {
  gameArch,
  hasWindowsArm64Natives,
  machineArch,
  readMachineArch,
  type LibraryNames,
} from './game-arch';
import { gameLayout, javaHome, javaPlace } from './layout';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'arch');
const JAVA_INDEX: unknown = JSON.parse(
  readFileSync(join(FIXTURES, 'java-runtime-all.json'), 'utf8'),
);
const WINDOWS_X64: Platform = { name: 'windows', version: '10.0.26100', arch: 'x64' };
const WINDOWS_ARM64: Platform = { ...WINDOWS_X64, arch: 'arm64' };

interface VersionFixture {
  javaVersion: { component: string; majorVersion: number };
  libraries: Parameters<typeof Version.resolveLibraries>[0];
}

function fixture(id: string): VersionFixture {
  return JSON.parse(readFileSync(join(FIXTURES, `libraries-${id}.json`), 'utf8')) as VersionFixture;
}

function resolved(id: string, platform: Platform = WINDOWS_X64): LibraryNames {
  return { libraries: Version.resolveLibraries(fixture(id).libraries, platform) };
}

function archOnArm(id: string, component = fixture(id).javaVersion.component): string {
  return gameArch({
    platform: 'win32',
    processArch: 'x64',
    machineArch: 'arm64',
    version: resolved(id),
    javaIndex: JAVA_INDEX,
    component,
  });
}

describe('machineArch', () => {
  it('an x64 process on Windows ARM is told apart by the registry value', () => {
    expect(machineArch('win32', 'x64', 'ARM64')).toBe('arm64');
    expect(machineArch('win32', 'x64', ' arm64 ')).toBe('arm64');
  });

  it('everything else keeps the process architecture', () => {
    expect(machineArch('win32', 'x64', 'AMD64')).toBe('x64');
    expect(machineArch('win32', 'x64', null)).toBe('x64');
    expect(machineArch('win32', 'x64', 'x86')).toBe('x64');
    expect(machineArch('win32', 'ia32', 'AMD64')).toBe('ia32');
    expect(machineArch('darwin', 'arm64', null)).toBe('arm64');
    expect(machineArch('darwin', 'x64', 'ARM64')).toBe('x64');
  });
});

describe('readMachineArch', () => {
  it('reads the registry on Windows only', async () => {
    const read = vi.fn(() => Promise.resolve('ARM64'));
    expect(await readMachineArch('darwin', 'x64', read)).toBe('x64');
    expect(read).not.toHaveBeenCalled();
    expect(await readMachineArch('win32', 'x64', read)).toBe('arm64');
    expect(await readMachineArch('win32', 'x64', undefined)).toBe('x64');
  });

  it('a reading that fails, throws or is late leaves x64', async () => {
    const failing = (): Promise<string> => Promise.reject(new Error('reg'));
    const throwing = (): Promise<string> => {
      throw new Error('reg');
    };
    const never = (): Promise<string> => new Promise(() => undefined);
    expect(await readMachineArch('win32', 'x64', failing)).toBe('x64');
    expect(await readMachineArch('win32', 'x64', throwing)).toBe('x64');
    expect(await readMachineArch('win32', 'x64', never, 5)).toBe('x64');
  });
});

describe('hasWindowsArm64Natives', () => {
  it('the border is 1.19: LWJGL 3.3.1 is the first with windows-arm64 natives', () => {
    expect(hasWindowsArm64Natives(resolved('1.18.2'))).toBe(false);
    expect(hasWindowsArm64Natives(resolved('1.19'))).toBe(true);
    expect(hasWindowsArm64Natives(resolved('1.21.11'))).toBe(true);
    expect(hasWindowsArm64Natives(resolved('26.2'))).toBe(true);
  });

  it('one LWJGL module without the arm64 natives keeps the whole version on x64', () => {
    const version = resolved('1.21.11');
    const partial = {
      libraries: version.libraries.filter(
        (library) => library.name !== 'org.lwjgl:lwjgl-glfw:3.3.3:natives-windows-arm64',
      ),
    };
    expect(partial.libraries).toHaveLength(version.libraries.length - 1);
    expect(hasWindowsArm64Natives(partial)).toBe(false);
  });

  it('a version without LWJGL 3 natives is not an arm64 one', () => {
    const legacy = 'org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209:natives-windows';
    expect(hasWindowsArm64Natives({ libraries: [] })).toBe(false);
    expect(hasWindowsArm64Natives({ libraries: [{ name: legacy }] })).toBe(false);
  });
});

describe('gameArch on Windows ARM', () => {
  it('versions with both the Java and the natives run on arm64', () => {
    expect(archOnArm('1.19')).toBe('arm64');
    expect(archOnArm('1.21.11')).toBe('arm64');
    expect(archOnArm('26.2')).toBe('arm64');
  });

  it('1.18.2 stays on x64: neither its Java nor its natives exist for arm64', () => {
    expect(fixture('1.18.2').javaVersion.component).toBe('java-runtime-beta');
    expect(archOnArm('1.18.2')).toBe('x64');
  });

  it('arm64 Java alone is not enough: 1.18.2 with Java 17 chosen by hand stays on x64', () => {
    expect(archOnArm('1.18.2', 'java-runtime-gamma')).toBe('x64');
  });

  it('arm64 natives alone are not enough: 1.21.11 with an older Java stays on x64', () => {
    expect(archOnArm('1.21.11', 'jre-legacy')).toBe('x64');
    expect(archOnArm('1.21.11', 'java-runtime-alpha')).toBe('x64');
  });

  it('an index without the arm64 platform keeps x64', () => {
    const index = { 'windows-x64': (JAVA_INDEX as Record<string, unknown>)['windows-x64'] };
    const arch = gameArch({
      platform: 'win32',
      processArch: 'x64',
      machineArch: 'arm64',
      version: resolved('1.21.11'),
      javaIndex: index,
      component: 'java-runtime-delta',
    });
    expect(arch).toBe('x64');
  });
});

describe('gameArch elsewhere', () => {
  it('an x64 machine and other systems keep the process architecture for every version', () => {
    for (const id of ['1.18.2', '1.19', '1.21.11', '26.2']) {
      const input = {
        version: resolved(id),
        javaIndex: JAVA_INDEX,
        component: fixture(id).javaVersion.component,
      };
      const windows = { ...input, platform: 'win32', processArch: 'x64', machineArch: 'x64' };
      const mac = { ...input, platform: 'darwin', processArch: 'arm64', machineArch: 'arm64' };
      expect(gameArch({ ...windows, platform: 'win32' })).toBe('x64');
      expect(gameArch({ ...mac, platform: 'darwin' })).toBe('arm64');
    }
  });
});

describe('libraries do not depend on the machine', () => {
  it('@xmcl/core resolves the same windows libraries for x64 and arm64 since 1.19', () => {
    for (const id of ['1.19', '1.21.11', '26.2']) {
      const names = (platform: Platform): string[] =>
        resolved(id, platform).libraries.map((library) => library.name);
      expect(names(WINDOWS_ARM64)).toEqual(names(WINDOWS_X64));
    }
  });
});

describe('javaPlace', () => {
  const layout = gameLayout('C:\\Games\\MC', path.win32);
  const x64 = { platform: 'win32', processArch: 'x64', arch: 'x64' } as const;
  const arm64 = { ...x64, arch: 'arm64' } as const;

  it('Java of the launcher architecture stays where it was', () => {
    expect(javaPlace(layout, x64, 'java-runtime-delta', path.win32)).toEqual({
      mojangPlatform: 'windows-x64',
      home: javaHome(layout, 'java-runtime-delta', path.win32),
    });
  });

  it('arm64 Java gets its own folder next to the x64 one', () => {
    expect(javaPlace(layout, arm64, 'java-runtime-delta', path.win32)).toEqual({
      mojangPlatform: 'windows-arm64',
      home: 'C:\\Games\\MC\\runtime\\windows-arm64\\java-runtime-delta',
    });
  });

  it('a platform Mojang has no Java for gives nothing', () => {
    const freebsd = { platform: 'freebsd', processArch: 'x64', arch: 'x64' } as const;
    expect(javaPlace(layout, freebsd, 'jre-legacy', path.win32)).toBeNull();
  });
});
