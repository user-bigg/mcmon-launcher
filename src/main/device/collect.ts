import type { TelemetryDevice } from '@shared/telemetry';
import { deviceHash } from './hash';
import { candidateMacs, selectMacs, type Interfaces, type MacSelection } from './mac';
import {
  macArch,
  macComputer,
  macIsGuest,
  macPlatformHash,
  macVolumeHash,
  type CommandRun,
} from './macos';
import {
  buildProfile,
  cleanText,
  gpuSummary,
  type DisplayReading,
  type GpuSummary,
} from './profile';
import {
  ARCH_VALUE,
  BIOS_KEY,
  ENVIRONMENT_KEY,
  MACHINE_KEY,
  MACHINE_VALUE,
  queryRegistry,
  ReadFailure,
  systemDrive,
  type RegRun,
  type RegValues,
} from './registry';
import { detectVm, type ComputerName, type VmVerdict } from './vm';

// A fresh install is scanned by the antivirus while the launcher starts: in a Windows 11 ARM
// guest reg.exe took over 3 s then and 0.2 s a minute later. The request still returns after
// TOTAL_TIMEOUT_MS; a slow reading finishes in the background for the next request.
export const READ_TIMEOUT_MS = 20_000;
export const TOTAL_TIMEOUT_MS = 4000;
export const READ_ATTEMPTS = 5;
const VOLUME_SERIAL_DIGITS = 8;
const MAC_VOLUME_DIGITS = 32;
const NO_MACS: Omit<MacSelection, 'hashes'> = {
  adapters: 0,
  addresses: 0,
  remembered: 0,
  kept: 0,
  dropped: {
    internal: 0,
    zero: 0,
    malformed: 0,
    duplicate: 0,
    local: 0,
    virtual: 0,
    over_limit: 0,
  },
};
const VOLUME_SERIAL_MASK = 0xffff_ffffn;
const SEEN_MACS_LIMIT = 64;
const MACHINE_GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const BIOS_VALUES = [
  'SystemManufacturer',
  'SystemProductName',
  'BaseBoardManufacturer',
  'BaseBoardProduct',
  'BIOSVendor',
  'BIOSVersion',
  'BIOSReleaseDate',
] as const;

export interface DeviceSources {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  processArch: string;
  runReg: RegRun;
  runCommand: CommandRun;
  systemVersion: () => string;
  volumeDevice: (root: string) => Promise<bigint>;
  interfaces: () => Interfaces;
  cpus: () => { model: string }[];
  memoryBytes: () => number;
  osRelease: () => string;
  gpuInfo: () => Promise<unknown>;
  displays: () => DisplayReading[];
  wait: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
}

export interface ReadStatus {
  ok: boolean;
  ms: number;
  reason: string | null;
}

export interface DeviceReadings {
  machine: ReadStatus;
  volume: ReadStatus & { digits: number | null };
  bios: ReadStatus & { values: RegValues | null };
  native_arch: ReadStatus & { registry: string | null; process: string };
  mac: ReadStatus & Partial<Omit<MacSelection, 'hashes'>>;
  gpu: ReadStatus & { raw: GpuSummary | null };
  displays: ReadStatus & { raw: DisplayReading[] | null };
  vm: VmVerdict;
}

export interface DeviceCollection {
  device: TelemetryDevice;
  readings: DeviceReadings;
  totalMs: number;
}

interface VolumeSerial {
  hash: string;
  digits: number;
}

export function emptyDevice(): TelemetryDevice {
  return {
    machine: null,
    volume: null,
    mac: [],
    smbios: null,
    disk: null,
    baseboard: null,
    vm: 'unknown',
  };
}

function emptyCollection(reason: string, processArch: string): DeviceCollection {
  const none: ReadStatus = { ok: false, ms: 0, reason };
  return {
    device: emptyDevice(),
    readings: {
      machine: none,
      volume: { ...none, digits: null },
      bios: { ...none, values: null },
      native_arch: { ...none, registry: null, process: processArch },
      mac: none,
      gpu: { ...none, raw: null },
      displays: { ...none, raw: null },
      vm: { vm: 'unknown', source: 'none' },
    },
    totalMs: 0,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof ReadFailure ? error.reason : 'failed';
}

async function late(sources: DeviceSources, ms: number): Promise<never> {
  await sources.wait(ms);
  throw new ReadFailure('timeout');
}

async function machineHash(sources: DeviceSources): Promise<string> {
  const values = await queryRegistry(sources.runReg, sources.env, MACHINE_KEY, MACHINE_VALUE);
  const guid = values[MACHINE_VALUE] ?? '';
  if (guid === '') {
    throw new ReadFailure('empty');
  }
  const hash = MACHINE_GUID.test(guid) ? deviceHash(guid) : null;
  if (hash === null) {
    throw new ReadFailure('malformed');
  }
  return hash;
}

// The serial number is 32 bits; wider values of st_dev are cut so that the hash does not move
// when libuv changes what it puts there.
export function volumeSerialHex(device: bigint): string | null {
  const serial = device & VOLUME_SERIAL_MASK;
  return device <= 0n || serial === 0n
    ? null
    : serial.toString(16).toUpperCase().padStart(VOLUME_SERIAL_DIGITS, '0');
}

async function volumeSerial(sources: DeviceSources): Promise<VolumeSerial> {
  const drive = systemDrive(sources.env);
  if (drive === null) {
    throw new ReadFailure('no-system-root');
  }
  const device = await sources.volumeDevice(drive);
  const hash = deviceHash(volumeSerialHex(device));
  if (hash === null) {
    throw new ReadFailure('empty');
  }
  return { hash, digits: device.toString(16).padStart(VOLUME_SERIAL_DIGITS, '0').length };
}

async function biosValues(sources: DeviceSources): Promise<RegValues> {
  const values = await queryRegistry(sources.runReg, sources.env, BIOS_KEY, null);
  return Object.fromEntries(
    BIOS_VALUES.flatMap((name) => {
      const value = cleanText(values[name]);
      return value === null ? [] : [[name, value]];
    }),
  );
}

async function registryArch(sources: DeviceSources): Promise<string> {
  const values = await queryRegistry(sources.runReg, sources.env, ENVIRONMENT_KEY, ARCH_VALUE);
  const arch = cleanText(values[ARCH_VALUE]);
  if (arch === null) {
    throw new ReadFailure('empty');
  }
  return arch;
}

// A reading that succeeded is kept for the whole run; a failed one is tried again on the next
// request, so a slow start does not leave the launcher without the sign until it is closed.
class Slot<T> {
  value: T | null = null;
  private reason: string | null = 'not-read';
  private ms = 0;
  private attempts = 0;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly name: string,
    private readonly read: (sources: DeviceSources) => Promise<T>,
  ) {}

  refresh(sources: DeviceSources): Promise<void> {
    if (this.value !== null || this.attempts >= READ_ATTEMPTS) {
      return Promise.resolve();
    }
    this.pending ??= this.attempt(sources).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  get status(): ReadStatus {
    const waiting = this.value === null && this.pending !== null;
    return { ok: this.value !== null, ms: this.ms, reason: waiting ? 'pending' : this.reason };
  }

  private async attempt(sources: DeviceSources): Promise<void> {
    this.attempts += 1;
    const from = sources.now();
    try {
      this.value = await Promise.race([this.read(sources), late(sources, READ_TIMEOUT_MS)]);
      this.reason = null;
    } catch (error) {
      this.reason = reasonOf(error);
      sources.log(`device: ${this.name} not read (${this.reason})`);
    }
    this.ms = Math.round(sources.now() - from);
  }
}

interface Instant<T> {
  value: T | null;
  status: ReadStatus;
}

function instant<T>(sources: DeviceSources, name: string, read: () => T): Instant<T> {
  const from = sources.now();
  try {
    const value = read();
    return { value, status: { ok: true, ms: Math.round(sources.now() - from), reason: null } };
  } catch {
    sources.log(`device: ${name} not read (failed)`);
    return { value: null, status: { ok: false, ms: 0, reason: 'failed' } };
  }
}

async function macVolume(sources: DeviceSources): Promise<VolumeSerial> {
  return { hash: await macVolumeHash(sources.runCommand), digits: MAC_VOLUME_DIGITS };
}

export class DeviceReader {
  private readonly mac: boolean;
  private readonly machine: Slot<string>;
  private readonly volume: Slot<VolumeSerial>;
  private readonly bios: Slot<RegValues>;
  private readonly arch: Slot<string>;
  private readonly guest = new Slot('vm', (sources) => macIsGuest(sources.runCommand));
  private readonly gpu = new Slot('gpu', (sources) => sources.gpuInfo());
  private readonly seenMacs = new Set<string>();

  constructor(private readonly sources: DeviceSources) {
    this.mac = sources.platform === 'darwin';
    this.machine = this.mac
      ? new Slot('machine', (from) => macPlatformHash(from.runCommand))
      : new Slot('machine', machineHash);
    this.volume = this.mac ? new Slot('volume', macVolume) : new Slot('volume', volumeSerial);
    this.bios = this.mac
      ? new Slot('bios', (from) => macComputer(from.runCommand))
      : new Slot('bios', biosValues);
    this.arch = this.mac
      ? new Slot('native_arch', (from) => macArch(from.runCommand))
      : new Slot('native_arch', registryArch);
  }

  async collect(): Promise<DeviceCollection> {
    if (this.sources.platform !== 'win32' && this.sources.platform !== 'darwin') {
      return emptyCollection('unsupported', this.sources.processArch);
    }
    try {
      return await this.collectSlots();
    } catch {
      this.sources.log('device: not read (failed)');
      return emptyCollection('failed', this.sources.processArch);
    }
  }

  async device(): Promise<TelemetryDevice> {
    return (await this.collect()).device;
  }

  async registryArch(): Promise<string | null> {
    if (this.sources.platform !== 'win32') {
      return null;
    }
    await this.arch.refresh(this.sources);
    return this.arch.value;
  }

  private async collectSlots(): Promise<DeviceCollection> {
    const { sources } = this;
    const started = sources.now();
    const slots: { refresh: (from: DeviceSources) => Promise<void> }[] = [
      this.machine,
      this.volume,
      this.bios,
      this.arch,
      this.gpu,
    ];
    if (this.mac) {
      slots.push(this.guest);
    }
    const all = Promise.all(slots.map((slot) => slot.refresh(sources)));
    await Promise.race([all, late(sources, TOTAL_TIMEOUT_MS)]).catch(() => {
      sources.log('device: reading is slow, sending what is ready');
    });
    return { ...this.assemble(), totalMs: Math.round(sources.now() - started) };
  }

  // Only adapters that are up are listed, so the list is read on every request and added to
  // what this run has already seen: a start without the network must not hide the adapter.
  private remember(current: Interfaces | null): string[] {
    for (const mac of candidateMacs(current ?? {})) {
      if (this.seenMacs.size < SEEN_MACS_LIMIT) {
        this.seenMacs.add(mac);
      }
    }
    return [...this.seenMacs];
  }

  // A Mac's Wi-Fi address is private per network and rotates on macOS 15, so adapters are not
  // a sign there; whether it is a guest comes from the kernel instead.
  private vmAndMacs(
    interfaces: Interfaces | null,
    computer: ComputerName | null,
  ): { verdict: VmVerdict; selection: MacSelection } {
    if (this.mac) {
      const guest = this.guest.value;
      const vm = guest === null ? 'unknown' : guest ? 'apple' : 'none';
      return {
        verdict: { vm, source: guest === null ? 'none' : 'sysctl' },
        selection: { hashes: [], ...NO_MACS },
      };
    }
    const seen = this.remember(interfaces);
    const verdict = detectVm(computer, seen);
    return { verdict, selection: selectMacs(interfaces ?? {}, verdict.vm, seen) };
  }

  private assemble(): Omit<DeviceCollection, 'totalMs'> {
    const { sources } = this;
    const displays = instant(sources, 'displays', sources.displays);
    const interfaces = instant(sources, 'mac', sources.interfaces);
    const cpus = instant(sources, 'cpu', sources.cpus);
    const memory = instant(sources, 'memory', sources.memoryBytes);
    const release = instant(
      sources,
      'os_build',
      this.mac ? sources.systemVersion : sources.osRelease,
    );
    const bios = this.bios.value;
    const computer =
      bios === null
        ? null
        : { manufacturer: bios.SystemManufacturer ?? null, model: bios.SystemProductName ?? null };
    const { verdict, selection } = this.vmAndMacs(interfaces.value, computer);
    const { hashes, ...macCounts } = selection;
    return {
      device: {
        machine: this.mac ? null : this.machine.value,
        volume: this.volume.value?.hash ?? null,
        mac: hashes,
        smbios: this.mac ? this.machine.value : null,
        disk: null,
        baseboard: null,
        vm: verdict.vm,
        profile: buildProfile({
          cpus: cpus.value,
          memoryBytes: memory.value,
          gpuInfo: this.gpu.value,
          bios,
          displays: displays.value,
          osRelease: release.value,
          registryArch: this.arch.value,
        }),
      },
      readings: {
        machine: this.machine.status,
        volume: { ...this.volume.status, digits: this.volume.value?.digits ?? null },
        bios: { ...this.bios.status, values: bios },
        native_arch: {
          ...this.arch.status,
          registry: this.arch.value,
          process: sources.processArch,
        },
        mac: { ...interfaces.status, ...macCounts },
        gpu: { ...this.gpu.status, raw: gpuSummary(this.gpu.value) },
        displays: { ...displays.status, raw: displays.value },
        vm: verdict,
      },
    };
  }
}

export function collectDevice(sources: DeviceSources): Promise<DeviceCollection> {
  return new DeviceReader(sources).collect();
}
