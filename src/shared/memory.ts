const GIB = 1024 ** 3;

// Windows and firmware reserve part of the memory: on an 8 GB machine os.totalmem()
// can report 7.8 GiB.
const RESERVED_TOLERANCE_GIB = 0.5;

const SCALE = [
  { fromGib: 8, memoryMb: 4096 },
  { fromGib: 6, memoryMb: 3072 },
] as const;

export const MIN_MEMORY_MB = 1024;
export const FALLBACK_MEMORY_MB = 2048;
export const SYSTEM_RESERVE_MB = 1024;
const DEFAULT_SHARE = 0.75;
const STEP_MB = 256;

function totalMb(totalBytes: number): number {
  return Number.isFinite(totalBytes) && totalBytes > 0 ? Math.floor(totalBytes / 1024 ** 2) : 0;
}

export function maxMemoryMb(totalBytes: number): number {
  return Math.max(MIN_MEMORY_MB, totalMb(totalBytes) - SYSTEM_RESERVE_MB);
}

function roundDown(memoryMb: number): number {
  return Math.floor(memoryMb / STEP_MB) * STEP_MB;
}

export function defaultMemoryMb(totalBytes: number): number {
  const gib = totalBytes / GIB + RESERVED_TOLERANCE_GIB;
  const scaled = SCALE.find((step) => gib >= step.fromGib)?.memoryMb ?? FALLBACK_MEMORY_MB;
  const share = roundDown(totalMb(totalBytes) * DEFAULT_SHARE);
  return Math.max(MIN_MEMORY_MB, Math.min(scaled, share, roundDown(maxMemoryMb(totalBytes))));
}

export function isAllowedMemoryMb(memoryMb: number, totalBytes: number): boolean {
  return (
    Number.isFinite(memoryMb) &&
    Number.isInteger(memoryMb) &&
    memoryMb >= MIN_MEMORY_MB &&
    memoryMb <= maxMemoryMb(totalBytes)
  );
}

const SYSTEM_RESERVE_SHARE = 0.25;
const GAME_MEMORY_CEILING_MB = 16384;
const MEMORY_STEP_MB = 512;

export function maxGameMemoryMb(totalBytes: number): number {
  const availableMb = (totalBytes * (1 - SYSTEM_RESERVE_SHARE)) / (1024 * 1024);
  const stepped = Math.floor(availableMb / MEMORY_STEP_MB) * MEMORY_STEP_MB;
  return Math.min(GAME_MEMORY_CEILING_MB, Math.max(FALLBACK_MEMORY_MB, stepped));
}

export const MEMORY_STEPS_MB = [1024, 2048, 3072, 4096, 6144, 8192, 10240, 12288, 16384] as const;
export const MIN_SUGGESTED_MB = 2048;
const MEMORY_GROWTH = 1.5;
const UNKNOWN_CURRENT_WANTED_MB = 4096;

export function memoryCeilingMb(totalBytes: number): number {
  return maxGameMemoryMb(totalBytes);
}

export function nextMemoryStepMb(current: number | null, totalBytes: number): number | null {
  const ceiling = Math.min(memoryCeilingMb(totalBytes), totalMb(totalBytes));
  const wanted = current === null ? UNKNOWN_CURRENT_WANTED_MB : current * MEMORY_GROWTH;
  const fitting = MEMORY_STEPS_MB.filter((step) => step >= MIN_SUGGESTED_MB && step <= ceiling);
  const step = fitting.find((value) => value >= wanted) ?? fitting.at(-1) ?? null;
  if (step === null) {
    return null;
  }
  return current === null || step > current ? step : null;
}

export function lowerMemoryStepMb(
  current: number | null,
  floorMb = MIN_SUGGESTED_MB,
): number | null {
  if (current === null) {
    return null;
  }
  const wanted = current / MEMORY_GROWTH;
  const lower = [...MEMORY_STEPS_MB].reverse().find((value) => value <= wanted && value >= floorMb);
  return lower === undefined || lower >= current ? null : lower;
}
