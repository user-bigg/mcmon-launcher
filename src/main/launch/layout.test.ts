import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LaunchFailure } from './errors';
import {
  gameLayout,
  instanceDir,
  javaExecutables,
  javaHome,
  mojangPlatform,
  versionLockFile,
} from './layout';

describe('gameLayout', () => {
  it("shared folders, like XMCL's, live at the root of the data directory", () => {
    const layout = gameLayout('/data/game', path.posix);
    expect(layout).toEqual({
      root: '/data/game',
      versions: '/data/game/versions',
      libraries: '/data/game/libraries',
      assets: '/data/game/assets',
      runtime: '/data/game/runtime',
      instances: '/data/game/instances',
      cache: '/data/game/cache',
    });
  });

  it('the instance, version, and Java folders stay within the root', () => {
    const layout = gameLayout('/data/game', path.posix);
    expect(() => instanceDir(layout, '../etc', path.posix)).toThrow(LaunchFailure);
    expect(() => instanceDir(layout, 'server-1/../../x', path.posix)).toThrow(LaunchFailure);
    expect(() => instanceDir(layout, 'anything', path.posix)).toThrow(LaunchFailure);
    expect(() => instanceDir(layout, 'profile-my-pack', path.posix)).toThrow(LaunchFailure);
    expect(() => versionLockFile(layout, '../1.21', path.posix)).toThrow(LaunchFailure);
    expect(() => javaHome(layout, '../bin', path.posix)).toThrow(LaunchFailure);
    expect(instanceDir(layout, 'server-12', path.posix)).toBe('/data/game/instances/server-12');
    expect(versionLockFile(layout, '26.2', path.posix)).toBe(
      '/data/game/versions/26.2/mcmonitor-lock.json',
    );
  });
});

describe('mojangPlatform', () => {
  it("maps the Node platform to Mojang's all.json key", () => {
    expect(mojangPlatform('win32', 'x64')).toBe('windows-x64');
    expect(mojangPlatform('win32', 'arm64')).toBe('windows-arm64');
    expect(mojangPlatform('darwin', 'arm64')).toBe('mac-os-arm64');
    expect(mojangPlatform('darwin', 'x64')).toBe('mac-os');
    expect(mojangPlatform('linux', 'x64')).toBe('linux');
    expect(mojangPlatform('freebsd', 'x64')).toBeNull();
  });
});

describe('javaExecutables', () => {
  it('on Windows, javaw.exe comes first, without a console window', () => {
    expect(javaExecutables('C:\\game\\runtime\\delta', 'win32', path.win32)).toEqual([
      'C:\\game\\runtime\\delta\\bin\\javaw.exe',
      'C:\\game\\runtime\\delta\\bin\\java.exe',
    ]);
  });

  it("on macOS, Mojang's JRE lives inside jre.bundle", () => {
    expect(javaExecutables('/g/runtime/delta', 'darwin', path.posix)).toEqual([
      '/g/runtime/delta/jre.bundle/Contents/Home/bin/java',
    ]);
  });
});
