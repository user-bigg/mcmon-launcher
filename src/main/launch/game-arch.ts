import { existsSync } from 'node:fs';
import { withDeadline } from '../deadline';
import { nativeArch } from '../device/profile';
import { pickJavaTarget } from './java';
import { mojangPlatform } from './layout';

export const MACHINE_ARCH_DEADLINE_MS = 4000;

const LWJGL_GROUP = 'org.lwjgl';
const ARM64_NATIVES: Partial<Record<NodeJS.Platform, { x64: string; arm64: string }>> = {
  win32: { x64: 'natives-windows', arm64: 'natives-windows-arm64' },
  darwin: { x64: 'natives-macos', arm64: 'natives-macos-arm64' },
};
// Apple Silicon runs x64 programs only through Rosetta, and macOS installs it only on request.
const ROSETTA = '/Library/Apple/usr/share/rosetta/rosetta';

export type RegistryArchReader = () => Promise<string | null>;

export interface LibraryNames {
  libraries: readonly { name: string }[];
}

export interface GameArchInput {
  platform: NodeJS.Platform;
  processArch: string;
  machineArch: string;
  version: LibraryNames;
  javaIndex: unknown;
  component: string;
}

// An x64 process emulated on Windows ARM sees x64 everywhere except this registry value.
export function machineArch(
  platform: NodeJS.Platform,
  processArch: string,
  registryArch: string | null,
): string {
  return platform === 'win32' && nativeArch(registryArch) === 'arm64' ? 'arm64' : processArch;
}

export async function readMachineArch(
  platform: NodeJS.Platform,
  processArch: string,
  read: RegistryArchReader | undefined,
  deadlineMs: number = MACHINE_ARCH_DEADLINE_MS,
): Promise<string> {
  if (platform !== 'win32' || read === undefined) {
    return processArch;
  }
  const registryArch = await withDeadline(Promise.resolve().then(read), deadlineMs, null);
  return machineArch(platform, processArch, registryArch);
}

function lwjglModules(version: LibraryNames, classifier: string): Set<string> {
  const modules = new Set<string>();
  for (const library of version.libraries) {
    const [group, artifact, release, kind] = library.name.split(':');
    if (group === LWJGL_GROUP && kind === classifier) {
      modules.add(`${artifact ?? ''}:${release ?? ''}`);
    }
  }
  return modules;
}

// Since 1.19 version.json lists the x64 and arm64 natives of LWJGL side by side under one
// `os.name` rule, and LWJGL picks its own by the architecture of the JVM it runs in. Older
// versions have x64 natives only, so on an ARM machine they run in an emulated x64 Java.
export function hasArm64Natives(version: LibraryNames, platform: NodeJS.Platform): boolean {
  const classifiers = ARM64_NATIVES[platform];
  if (classifiers === undefined) {
    return false;
  }
  const x64 = lwjglModules(version, classifiers.x64);
  const arm64 = lwjglModules(version, classifiers.arm64);
  return x64.size > 0 && [...x64].every((module) => arm64.has(module));
}

export function gameArch(input: GameArchInput): string {
  if (ARM64_NATIVES[input.platform] === undefined || input.machineArch !== 'arm64') {
    return input.processArch;
  }
  const platform = mojangPlatform(input.platform, 'arm64');
  const java =
    platform === null ? null : pickJavaTarget(input.javaIndex, platform, input.component);
  return java !== null && hasArm64Natives(input.version, input.platform) ? 'arm64' : 'x64';
}

export function rosettaInstalled(exists: (path: string) => boolean = existsSync): boolean {
  return exists(ROSETTA);
}
