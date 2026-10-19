import { withDeadline } from '../deadline';
import { nativeArch } from '../device/profile';
import { pickJavaTarget } from './java';
import { mojangPlatform } from './layout';

export const MACHINE_ARCH_DEADLINE_MS = 4000;

const LWJGL_GROUP = 'org.lwjgl';
const WINDOWS_NATIVES = 'natives-windows';
const WINDOWS_ARM64_NATIVES = 'natives-windows-arm64';

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

// Since 1.19 version.json lists the x64, x86 and arm64 natives of LWJGL side by side under one
// `os.name` rule, and LWJGL picks its own by the architecture of the JVM it runs in.
export function hasWindowsArm64Natives(version: LibraryNames): boolean {
  const x64 = lwjglModules(version, WINDOWS_NATIVES);
  const arm64 = lwjglModules(version, WINDOWS_ARM64_NATIVES);
  return x64.size > 0 && [...x64].every((module) => arm64.has(module));
}

export function gameArch(input: GameArchInput): string {
  if (input.platform !== 'win32' || input.machineArch !== 'arm64') {
    return input.processArch;
  }
  const platform = mojangPlatform('win32', 'arm64');
  const java =
    platform === null ? null : pickJavaTarget(input.javaIndex, platform, input.component);
  return java !== null && hasWindowsArm64Natives(input.version) ? 'arm64' : 'x64';
}
