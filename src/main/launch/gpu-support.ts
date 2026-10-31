import type { DeviceGpu } from '@shared/telemetry';
import { failure } from './errors';

const INTEL = 0x8086;
const MICROSOFT_BASIC_RENDER = 0x1414;

// Intel stopped these chips at the drivers below, with no OpenGL 3.2 core profile on Windows:
// Sandy Bridge HD Graphics 2000/3000 end at 3.1, Ironlake and GMA 4500 at 2.1.
const LEGACY_INTEL = new Map<number, string>([
  ...[0x0102, 0x0106, 0x010a, 0x0112, 0x0116, 0x0122, 0x0126].map(
    (device) => [device, '3.1'] as const,
  ),
  ...[0x0042, 0x0046, 0x2a42, 0x2e02, 0x2e12, 0x2e22, 0x2e32, 0x2e42, 0x2e92].map(
    (device) => [device, '2.1'] as const,
  ),
]);

// 21w10a (1.17) moved the renderer to the OpenGL 3.2 core profile.
const CORE_PROFILE_SNAPSHOT_WEEK = 2110;
const WEEKLY_SNAPSHOT = /^(\d{2})w(\d{2})[a-z]$/i;
const RELEASE = /^(\d+)\.(\d+)(?:\.\d+)?(?:[- _].*)?$/;

export interface GpuLimit {
  name: string;
  openGl: string;
}

export function needsCoreProfile(minecraft: string): boolean {
  const snapshot = WEEKLY_SNAPSHOT.exec(minecraft);
  if (snapshot !== null) {
    return Number(snapshot[1]) * 100 + Number(snapshot[2]) >= CORE_PROFILE_SNAPSHOT_WEEK;
  }
  const release = RELEASE.exec(minecraft);
  if (release === null) {
    return false;
  }
  const major = Number(release[1]);
  return major > 1 || (major === 1 && Number(release[2]) >= 17);
}

function legacyOpenGl(gpu: DeviceGpu): string | null {
  return gpu.vendor === INTEL ? (LEGACY_INTEL.get(gpu.device) ?? null) : null;
}

// A laptop with one of these chips and a discrete card runs the game on the discrete one,
// so only a machine where every real adapter is legacy is held back.
export function gpuLimit(gpus: readonly DeviceGpu[]): GpuLimit | null {
  const adapters = gpus.filter((gpu) => gpu.vendor !== MICROSOFT_BASIC_RENDER);
  const first = adapters[0];
  if (first === undefined || !adapters.every((gpu) => legacyOpenGl(gpu) !== null)) {
    return null;
  }
  return { name: first.name ?? 'Intel HD Graphics', openGl: legacyOpenGl(first) ?? '3.1' };
}

export function checkGpuSupport(
  minecraft: string,
  platform: NodeJS.Platform,
  gpus: readonly DeviceGpu[],
): void {
  if (platform !== 'win32' || !needsCoreProfile(minecraft)) {
    return;
  }
  const limit = gpuLimit(gpus);
  if (limit !== null) {
    throw failure({ code: 'gpu-unsupported', minecraft, gpu: limit.name, openGl: limit.openGl });
  }
}
