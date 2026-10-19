import path from 'node:path';
import { JAVA_RANGES } from '@shared/system';
import { firstExecutable } from './java';
import { javaComponentsOfMajor } from './java-components';
import { javaExecutables, javaHome, mojangPlatform, type GameLayout } from './layout';

const ARCHES = ['x64', 'ia32', 'arm64'] as const;

export type ExecutableProbe = (paths: string[]) => Promise<string | null>;

function javaHomes(
  layout: GameLayout,
  platform: NodeJS.Platform,
  component: string,
  fs: path.PlatformPath,
): string[] {
  const home = javaHome(layout, component, fs);
  const foreign = ARCHES.map((arch) => mojangPlatform(platform, arch))
    .filter((name): name is string => name !== null)
    .map((name) => fs.join(layout.runtime, name, component));
  return [home, ...foreign];
}

export async function installedJavaMajors(
  layout: GameLayout,
  platform: NodeJS.Platform,
  probe: ExecutableProbe = firstExecutable,
  fs: path.PlatformPath = path,
): Promise<number[]> {
  const installed: number[] = [];
  for (const { major } of JAVA_RANGES) {
    const executables = javaComponentsOfMajor(major)
      .flatMap((component) => javaHomes(layout, platform, component, fs))
      .flatMap((home) => javaExecutables(home, platform, fs));
    if ((await probe(executables)) !== null) {
      installed.push(major);
    }
  }
  return installed;
}
