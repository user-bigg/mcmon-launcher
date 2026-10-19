import path from 'node:path';
import { isValidVersionId } from '@shared/launch';
import { failure } from './errors';

export interface GameLayout {
  root: string;
  versions: string;
  libraries: string;
  assets: string;
  runtime: string;
  instances: string;
  cache: string;
}

const INSTANCE_ID = /^server-\d{1,12}$/;
const JAVA_COMPONENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function gameLayout(root: string, fs: path.PlatformPath = path): GameLayout {
  const base = fs.resolve(root);
  return {
    root: base,
    versions: fs.join(base, 'versions'),
    libraries: fs.join(base, 'libraries'),
    assets: fs.join(base, 'assets'),
    runtime: fs.join(base, 'runtime'),
    instances: fs.join(base, 'instances'),
    cache: fs.join(base, 'cache'),
  };
}

export function instanceDir(
  layout: GameLayout,
  instanceId: string,
  fs: path.PlatformPath = path,
): string {
  if (!INSTANCE_ID.test(instanceId)) {
    throw failure({ code: 'invalid-request', field: 'instance' });
  }
  return fs.join(layout.instances, instanceId);
}

export function versionLockFile(
  layout: GameLayout,
  versionId: string,
  fs: path.PlatformPath = path,
): string {
  if (!isValidVersionId(versionId)) {
    throw failure({ code: 'invalid-request', field: 'minecraft' });
  }
  return fs.join(layout.versions, versionId, 'mcmonitor-lock.json');
}

export function javaHome(
  layout: GameLayout,
  component: string,
  fs: path.PlatformPath = path,
): string {
  if (!JAVA_COMPONENT.test(component)) {
    throw failure({ code: 'invalid-request', field: 'java' });
  }
  return fs.join(layout.runtime, component);
}

export function versionManifestCache(layout: GameLayout, fs: path.PlatformPath = path): string {
  return fs.join(layout.cache, 'version_manifest_v2.json');
}

export function javaRuntimeIndexCache(layout: GameLayout, fs: path.PlatformPath = path): string {
  return fs.join(layout.cache, 'java-runtime-all.json');
}

export function gameLogFile(instance: string, fs: path.PlatformPath = path): string {
  return fs.join(instance, 'logs', 'mcmonitor-launch.log');
}

export function crashReportsDir(instance: string, fs: path.PlatformPath = path): string {
  return fs.join(instance, 'crash-reports');
}

export function mojangPlatform(platform: NodeJS.Platform, arch: string): string | null {
  const key = `${platform}-${arch}`;
  const platforms: Record<string, string> = {
    'win32-x64': 'windows-x64',
    'win32-ia32': 'windows-x86',
    'win32-arm64': 'windows-arm64',
    'darwin-x64': 'mac-os',
    'darwin-arm64': 'mac-os-arm64',
    'linux-x64': 'linux',
    'linux-ia32': 'linux-i386',
  };
  return platforms[key] ?? null;
}

export interface JavaPlace {
  mojangPlatform: string;
  home: string;
}

// Java for another architecture than the launcher's own lives in a folder of its platform, so
// the x64 and arm64 runtimes of one component never overwrite each other.
export function javaPlace(
  layout: GameLayout,
  target: { platform: NodeJS.Platform; processArch: string; arch: string },
  component: string,
  fs: path.PlatformPath = path,
): JavaPlace | null {
  const platform = mojangPlatform(target.platform, target.arch);
  if (platform === null) {
    return null;
  }
  const home = javaHome(layout, component, fs);
  return {
    mojangPlatform: platform,
    home:
      target.arch === target.processArch
        ? home
        : fs.join(fs.dirname(home), platform, fs.basename(home)),
  };
}

export function javaExecutables(
  home: string,
  platform: NodeJS.Platform,
  fs: path.PlatformPath = path,
): string[] {
  if (platform === 'win32') {
    return [fs.join(home, 'bin', 'javaw.exe'), fs.join(home, 'bin', 'java.exe')];
  }
  if (platform === 'darwin') {
    return [fs.join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')];
  }
  return [fs.join(home, 'bin', 'java')];
}
