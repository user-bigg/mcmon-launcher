import {
  DEVICE_LIMITS,
  type DeviceDisplay,
  type DeviceGpu,
  type DeviceNativeArch,
  type DeviceProfile,
} from '@shared/telemetry';
import type { RegValues } from './registry';

const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
// reg.exe writes in the OEM code page: a non-ASCII value read as UTF-8 is not worth sending.
const UNDECODED = '\uFFFD';
const BYTES_IN_GB = 1024 ** 3;
const MAX_ID = 65_535;
const MAX_SIDE = 32_767;

export interface DisplayReading {
  size: { width: number; height: number };
  scaleFactor: number;
  label: string;
}

export interface ProfileParts {
  cpus: readonly { model: string }[] | null;
  memoryBytes: number | null;
  gpuInfo: unknown;
  bios: RegValues | null;
  displays: readonly DisplayReading[] | null;
  osRelease: string | null;
  registryArch: string | null;
}

export function cleanText(value: unknown, max: number = DEVICE_LIMITS.text): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.includes(UNDECODED)) {
    return null;
  }
  const clean = Array.from(value.replace(CONTROL_CHARACTERS, ' ').trim()).slice(0, max);
  return clean.join('').trim() || null;
}

function wholeIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function gpuOf(item: unknown): DeviceGpu | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const { vendorId, deviceId, deviceString } = item as Record<string, unknown>;
  const vendor = wholeIn(vendorId, 0, MAX_ID);
  const device = wholeIn(deviceId, 0, MAX_ID);
  return vendor === null || device === null
    ? null
    : { vendor, device, name: cleanText(deviceString) };
}

function gpuDevices(info: unknown): unknown[] {
  const devices =
    typeof info === 'object' && info !== null ? (info as { gpuDevice?: unknown }).gpuDevice : [];
  return Array.isArray(devices) ? devices : [];
}

export function gpuList(info: unknown): DeviceGpu[] {
  return gpuDevices(info)
    .flatMap((item) => gpuOf(item) ?? [])
    .slice(0, DEVICE_LIMITS.gpu);
}

export interface GpuSummary {
  keys: string[];
  devices: Record<string, string | number | boolean>[];
}

function plainFields(item: unknown): Record<string, string | number | boolean> {
  const entries = typeof item === 'object' && item !== null ? Object.entries(item) : [];
  return Object.fromEntries(
    entries.flatMap(([key, value]): [string, string | number | boolean][] => {
      if (typeof value === 'number' || typeof value === 'boolean') {
        return [[key, value]];
      }
      return typeof value === 'string' ? [[key, cleanText(value) ?? '']] : [];
    }),
  );
}

export function gpuSummary(info: unknown): GpuSummary | null {
  if (typeof info !== 'object' || info === null) {
    return null;
  }
  return { keys: Object.keys(info).sort(), devices: gpuDevices(info).map(plainFields) };
}

function trailingZeroBits(value: number): number {
  let bits = 0;
  while (bits < 16 && ((value >> bits) & 1) === 0) {
    bits += 1;
  }
  return bits;
}

// Electron gives the size in scaled points, already rounded, and multiplying it back misses by a
// pixel (2560 at 150% is 1707 points, 1707 * 1.5 = 2560.5). Every pixel size that could have
// produced this many points under any rounding is a candidate, and real screens have the roundest
// one: 2560, not 2561.
export function pixelSide(points: number, scale: number): number {
  const first = Math.floor((points - 1) * scale) + 1;
  const last = Math.ceil((points + 1) * scale) - 1;
  let best = Math.round(points * scale);
  for (let pixels = first; pixels <= last; pixels += 1) {
    if (trailingZeroBits(pixels) > trailingZeroBits(best)) {
      best = pixels;
    }
  }
  return best;
}

function displayOf(display: DisplayReading): DeviceDisplay | null {
  const scale = display.scaleFactor;
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 8) {
    return null;
  }
  const width = wholeIn(pixelSide(display.size.width, scale), 1, MAX_SIDE);
  const height = wholeIn(pixelSide(display.size.height, scale), 1, MAX_SIDE);
  return width === null || height === null
    ? null
    : { width, height, scale, label: cleanText(display.label) };
}

export function displayList(displays: readonly DisplayReading[]): DeviceDisplay[] {
  return displays.flatMap((item) => displayOf(item) ?? []).slice(0, DEVICE_LIMITS.displays);
}

export function nativeArch(registryArch: string | null): DeviceNativeArch | null {
  switch (registryArch?.trim().toUpperCase()) {
    case 'AMD64':
      return 'x64';
    case 'ARM64':
      return 'arm64';
    default:
      return null;
  }
}

export function ramGb(bytes: number | null): number | null {
  return bytes === null || !Number.isFinite(bytes) || bytes <= 0
    ? null
    : Math.max(1, Math.round(bytes / BYTES_IN_GB));
}

export function buildProfile(parts: ProfileParts): DeviceProfile {
  const bios = parts.bios ?? {};
  const cores = parts.cpus?.length ?? 0;
  return {
    cpu: cleanText(parts.cpus?.[0]?.model),
    cores: cores > 0 ? cores : null,
    ram_gb: ramGb(parts.memoryBytes),
    gpu: gpuList(parts.gpuInfo),
    system: {
      manufacturer: cleanText(bios.SystemManufacturer),
      model: cleanText(bios.SystemProductName),
    },
    board: {
      manufacturer: cleanText(bios.BaseBoardManufacturer),
      model: cleanText(bios.BaseBoardProduct),
    },
    bios: {
      vendor: cleanText(bios.BIOSVendor),
      version: cleanText(bios.BIOSVersion),
      date: cleanText(bios.BIOSReleaseDate),
    },
    displays: displayList(parts.displays ?? []),
    os_build: cleanText(parts.osRelease, DEVICE_LIMITS.osBuild),
    native_arch: nativeArch(parts.registryArch),
  };
}
