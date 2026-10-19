import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  collectDevice,
  DeviceReader,
  emptyDevice,
  READ_ATTEMPTS,
  READ_TIMEOUT_MS,
  TOTAL_TIMEOUT_MS,
  volumeSerialHex,
  type DeviceSources,
} from './collect';
import { readAfterStart } from './deferred';
import { deviceHash } from './hash';
import type { Interfaces } from './mac';
import { pixelSide } from './profile';
import { ARCH_VALUE, BIOS_KEY, MACHINE_VALUE, ReadFailure, type RegRun } from './registry';
import { buildDeviceReport, deviceReportPath, runDeviceReport } from './report';

const GUID = '1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab';
const SERIAL = 0x9c4f_12abn;
const MAC = 'a4:bb:6d:12:34:56';
const BIOS_EXTRA = 'CHASSIS-TAG-7781';
const RAW = [
  GUID,
  GUID.toUpperCase(),
  '9C4F12AB',
  '9c4f12ab',
  String(SERIAL),
  MAC,
  MAC.toUpperCase(),
  'A4BB6D123456',
  'a4bb6d123456',
  'A4-BB-6D-12-34-56',
];

function regOutput(values: Record<string, string>): string {
  const lines = Object.entries(values).map(([name, value]) => `    ${name}    REG_SZ    ${value}`);
  return ['', 'HKEY_LOCAL_MACHINE\\…', ...lines, '', ''].join('\r\n');
}

const BIOS = {
  BIOSVendor: 'American Megatrends Inc.',
  BIOSVersion: 'F.21',
  BIOSReleaseDate: '03/14/2025',
  SystemManufacturer: 'Micro-Star International Co., Ltd.',
  SystemProductName: 'MS-7C91',
  SystemSKU: BIOS_EXTRA,
  BaseBoardManufacturer: 'Micro-Star International Co., Ltd.',
  BaseBoardProduct: 'MAG B550 TOMAHAWK (MS-7C91)',
};

const denied = (): Promise<never> => Promise.reject(new ReadFailure('exit-1'));

function regWith(overrides: { machine?: RegRun; bios?: RegRun; arch?: RegRun }): RegRun {
  return (file, args) => {
    if (args.includes(MACHINE_VALUE)) {
      return overrides.machine?.(file, args) ?? Promise.resolve(regOutput({ MachineGuid: GUID }));
    }
    if (args.includes(ARCH_VALUE)) {
      return (
        overrides.arch?.(file, args) ??
        Promise.resolve(regOutput({ PROCESSOR_ARCHITECTURE: 'ARM64' }))
      );
    }
    if (args.includes(BIOS_KEY)) {
      return overrides.bios?.(file, args) ?? Promise.resolve(regOutput(BIOS));
    }
    return denied();
  };
}

const reg = regWith({});

function adapter(mac: string): NetworkInterfaceInfo {
  return {
    address: '192.168.1.10',
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac,
    internal: false,
    cidr: '192.168.1.10/24',
  };
}

const never = (): Promise<never> => new Promise(() => undefined);
const nextTick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const MAC_UUID = '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9';
const VOLUME_UUID = '11223344-5566-7788-99AA-BBCCDDEEFF00';

function sources(overrides: Partial<DeviceSources> = {}): DeviceSources & { logs: string[] } {
  const logs: string[] = [];
  let clock = 0;
  return {
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', COMPUTERNAME: 'DESKTOP-HOME', USERNAME: 'vasya' },
    processArch: 'x64',
    runReg: reg,
    runCommand: () => Promise.reject(new ReadFailure('not-mac')),
    systemVersion: () => '26.0.1',
    volumeDevice: () => Promise.resolve(SERIAL),
    interfaces: () => ({ Ethernet: [adapter(MAC)], 'Wi-Fi': [adapter('da:a1:19:00:00:01')] }),
    cpus: () =>
      Array.from({ length: 12 }, () => ({ model: ' AMD Ryzen 5 5600X 6-Core Processor ' })),
    memoryBytes: () => 31.9 * 1024 ** 3,
    osRelease: () => '10.0.26100',
    gpuInfo: () =>
      Promise.resolve({
        auxAttributes: { glRenderer: 'ANGLE' },
        gpuDevice: [
          { active: true, vendorId: 4318, deviceId: 9479, driverVersion: '32.0.15.6094' },
          { active: false, vendorId: 5140, deviceId: 140, deviceString: 'Basic Render Driver' },
        ],
      }),
    displays: () => [
      { size: { width: 1536, height: 864 }, scaleFactor: 1.25, label: 'DELL U2720Q' },
      { size: { width: 1920, height: 1080 }, scaleFactor: 1, label: '' },
    ],
    wait: never,
    now: () => (clock += 5),
    log: (message) => logs.push(message),
    logs,
    ...overrides,
  };
}

describe('device signs', () => {
  it('collects hashes, vm and the profile per the site API', async () => {
    const { device } = await collectDevice(sources());
    expect(device).toEqual({
      machine: deviceHash(GUID),
      volume: deviceHash('9C4F12AB'),
      mac: [deviceHash('A4BB6D123456')],
      smbios: null,
      disk: null,
      baseboard: null,
      vm: 'none',
      profile: {
        cpu: 'AMD Ryzen 5 5600X 6-Core Processor',
        cores: 12,
        ram_gb: 32,
        gpu: [
          { vendor: 4318, device: 9479, name: null },
          { vendor: 5140, device: 140, name: 'Basic Render Driver' },
        ],
        system: { manufacturer: 'Micro-Star International Co., Ltd.', model: 'MS-7C91' },
        board: {
          manufacturer: 'Micro-Star International Co., Ltd.',
          model: 'MAG B550 TOMAHAWK (MS-7C91)',
        },
        bios: { vendor: 'American Megatrends Inc.', version: 'F.21', date: '03/14/2025' },
        displays: [
          { width: 1920, height: 1080, scale: 1.25, label: 'DELL U2720Q' },
          { width: 1920, height: 1080, scale: 1, label: null },
        ],
        os_build: '10.0.26100',
        native_arch: 'arm64',
      },
    });
    for (const hash of [device.machine, device.volume, ...device.mac]) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('the profile has neither the computer name nor the Windows user name', async () => {
    const { device } = await collectDevice(sources());
    const sent = JSON.stringify(device);
    expect(sent).not.toContain('DESKTOP-HOME');
    expect(sent).not.toContain('vasya');
    expect(sent).not.toContain('32.0.15.6094');
    expect(sent).not.toContain(BIOS_EXTRA);
  });

  it('the volume serial is eight digits: short ones are padded, wide ones are cut to 32 bits', async () => {
    expect(volumeSerialHex(0xabcn)).toBe('00000ABC');
    expect(volumeSerialHex(0x1_9c4f_12abn)).toBe('9C4F12AB');
    expect(volumeSerialHex(0n)).toBeNull();
    expect(volumeSerialHex(-5n)).toBeNull();
    expect(volumeSerialHex(0x1_0000_0000n)).toBeNull();
    const wide = await collectDevice(
      sources({ volumeDevice: () => Promise.resolve(0x1_9c4f_12abn) }),
    );
    expect(wide.device.volume).toBe(deviceHash('9C4F12AB'));
    expect(wide.readings.volume.digits).toBe(9);
    const short = await collectDevice(sources({ volumeDevice: () => Promise.resolve(0xabcn) }));
    expect(short.readings.volume.digits).toBe(8);
  });

  it('a MachineGuid that does not look like one is not hashed', async () => {
    const odd = regWith({ machine: () => Promise.resolve(regOutput({ MachineGuid: 'none' })) });
    const { device, readings } = await collectDevice(sources({ runReg: odd }));
    expect(device.machine).toBeNull();
    expect(readings.machine.reason).toBe('malformed');
  });

  it('inside Parallels marks the vm and keeps the guest adapter', async () => {
    const parallels = regWith({
      bios: () =>
        Promise.resolve(
          regOutput({
            SystemManufacturer: 'Parallels International GmbH.',
            SystemProductName: 'Parallels ARM Virtual Machine',
          }),
        ),
    });
    const { device, readings } = await collectDevice(
      sources({
        runReg: parallels,
        interfaces: () => ({ Ethernet: [adapter('00:1c:42:aa:bb:cc')] }),
      }),
    );
    expect(device.vm).toBe('parallels');
    expect(device.mac).toEqual([deviceHash('001C42AABBCC')]);
    expect(readings.vm).toEqual({ vm: 'parallels', source: 'bios' });
  });

  it('screen size in pixels is restored without the rounding error of scaled points', () => {
    expect([pixelSide(1707, 1.5), pixelSide(960, 1.5)]).toEqual([2560, 1440]);
    expect([pixelSide(2195, 1.75), pixelSide(1235, 1.75)]).toEqual([3840, 2160]);
    expect([pixelSide(2194, 1.75), pixelSide(1234, 1.75)]).toEqual([3840, 2160]);
    expect([pixelSide(1536, 1.25), pixelSide(864, 1.25)]).toEqual([1920, 1080]);
    expect([pixelSide(1093, 1.25), pixelSide(615, 1.25)]).toEqual([1366, 768]);
    expect([pixelSide(1366, 1), pixelSide(768, 1)]).toEqual([1366, 768]);
    expect([pixelSide(1504, 1.5), pixelSide(1003, 1.5)]).toEqual([2256, 1504]);
  });

  it('long, control-character and undecoded strings are cut to the site API limits', async () => {
    const { device } = await collectDevice(
      sources({
        cpus: () => [{ model: `Intel\u0000 ${'x'.repeat(300)}` }],
        osRelease: () => '1'.repeat(64),
        gpuInfo: () =>
          Promise.resolve({
            gpuDevice: Array.from({ length: 6 }, () => ({ vendorId: 1, deviceId: 70_000 })).concat(
              Array.from({ length: 6 }, () => ({ vendorId: 4318, deviceId: 1 })),
            ),
          }),
        displays: () =>
          Array.from({ length: 12 }, () => ({
            size: { width: 1920, height: 1080 },
            scaleFactor: 1,
            label: 'Монитор \uFFFD\uFFFD',
          })),
      }),
    );
    expect(device.profile?.cpu).toHaveLength(128);
    expect(device.profile?.cpu?.startsWith('Intel')).toBe(true);
    expect(device.profile?.os_build).toHaveLength(32);
    expect(device.profile?.gpu).toHaveLength(4);
    expect(device.profile?.gpu[0]).toEqual({ vendor: 4318, device: 1, name: null });
    expect(device.profile?.displays).toHaveLength(8);
    expect(device.profile?.displays[0]?.label).toBeNull();
  });
});

describe('device signs: failures', () => {
  const full = collectDevice(sources());

  it('forbidden reg.exe: machine is null, vm unknown, the rest is read', async () => {
    const blocked = sources({ runReg: denied });
    const { device, readings } = await collectDevice(blocked);
    const expected = (await full).device;
    expect(device.machine).toBeNull();
    expect(device.volume).toBe(expected.volume);
    expect(device.mac).toEqual(expected.mac);
    expect(device.vm).toBe('unknown');
    expect(device.profile).toMatchObject({
      cores: 12,
      native_arch: null,
      system: { manufacturer: null, model: null },
    });
    expect(readings.machine).toMatchObject({ ok: false, reason: 'exit-1' });
    expect(readings.bios).toMatchObject({ ok: false, reason: 'exit-1', values: null });
    expect(blocked.logs).toContain('device: machine not read (exit-1)');
  });

  it('empty MachineGuid output gives null', async () => {
    const empty = regWith({ machine: () => Promise.resolve('\r\n') });
    const { device, readings } = await collectDevice(sources({ runReg: empty }));
    expect(device.machine).toBeNull();
    expect(readings.machine.reason).toBe('empty');
    expect(device.vm).toBe('none');
  });

  it('an unread BIOS key alone: machine stays, a guest is told by its only adapter', async () => {
    const { device, readings } = await collectDevice(
      sources({
        runReg: regWith({ bios: denied }),
        interfaces: () => ({ Ethernet: [adapter('00:1c:42:aa:bb:cc')] }),
      }),
    );
    expect(device.machine).toBe(deviceHash(GUID));
    expect(device.profile?.native_arch).toBe('arm64');
    expect(readings.vm).toEqual({ vm: 'parallels', source: 'mac' });
    expect(device.mac).toEqual([deviceHash('001C42AABBCC')]);
  });

  it('an unread BIOS key on a computer with a physical adapter: vm unknown, virtual addresses dropped', async () => {
    const { device } = await collectDevice(
      sources({
        runReg: regWith({ bios: denied }),
        interfaces: () => ({
          Ethernet: [adapter(MAC)],
          'vEthernet (WSL)': [adapter('00:15:5d:01:02:03')],
          VMnet8: [adapter('00:50:56:c0:00:08')],
        }),
      }),
    );
    expect(device.vm).toBe('unknown');
    expect(device.mac).toEqual([deviceHash('A4BB6D123456')]);
  });

  it.each([
    ['volume', { volumeDevice: (): Promise<bigint> => Promise.reject(new Error('EPERM')) }],
    ['zero volume', { volumeDevice: (): Promise<bigint> => Promise.resolve(0n) }],
    [
      'mac',
      {
        interfaces: (): never => {
          throw new Error('boom');
        },
      },
    ],
    ['gpu', { gpuInfo: (): Promise<unknown> => Promise.reject(new Error('no gpu process')) }],
    [
      'displays',
      {
        displays: (): never => {
          throw new Error('not ready');
        },
      },
    ],
    [
      'cpu',
      {
        cpus: (): never => {
          throw new Error('boom');
        },
      },
    ],
  ] as const)('a failed %s reading does not break the others', async (name, broken) => {
    const { device, readings } = await collectDevice(sources(broken));
    const expected = (await full).device;
    const kept = {
      machine: device.machine,
      volume: device.volume,
      mac: device.mac,
      cpu: device.profile?.cpu,
      gpu: device.profile?.gpu,
      displays: device.profile?.displays,
      os_build: device.profile?.os_build,
    };
    const whole = {
      machine: expected.machine,
      volume: expected.volume,
      mac: expected.mac,
      cpu: expected.profile?.cpu,
      gpu: expected.profile?.gpu,
      displays: expected.profile?.displays,
      os_build: expected.profile?.os_build,
    };
    const lost = { volume: null, mac: [], gpu: [], displays: [], cpu: null };
    const sign = name === 'zero volume' ? 'volume' : name;
    expect(kept).toEqual({ ...whole, [sign]: lost[sign] });
    if (sign !== 'cpu') {
      expect(readings[sign]).toMatchObject({ ok: false });
      expect(readings[sign].reason).not.toBeNull();
    }
  });

  it('a hanging reading is given up after its timeout and does not hold the rest', async () => {
    const waited: number[] = [];
    const slow = sources({
      gpuInfo: never,
      volumeDevice: never,
      wait: (ms) => {
        waited.push(ms);
        return ms === READ_TIMEOUT_MS ? nextTick() : never();
      },
    });
    const { device, readings } = await collectDevice(slow);
    expect(waited).toContain(READ_TIMEOUT_MS);
    expect(waited).toContain(TOTAL_TIMEOUT_MS);
    expect(readings.gpu).toMatchObject({ ok: false, reason: 'timeout' });
    expect(readings.volume).toMatchObject({ ok: false, reason: 'timeout' });
    expect(device.profile?.gpu).toEqual([]);
    expect(device.volume).toBeNull();
    expect(device.machine).toBe(deviceHash(GUID));
    expect(device.mac).toHaveLength(1);
  });

  it('when the whole read is too slow, what is ready is sent and the rest comes later', async () => {
    let release: (serial: bigint) => void = () => undefined;
    const slow = sources({
      volumeDevice: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      wait: (ms) => (ms === TOTAL_TIMEOUT_MS ? nextTick() : never()),
    });
    const reader = new DeviceReader(slow);
    const first = await reader.collect();
    expect(first.device.volume).toBeNull();
    expect(first.readings.volume).toMatchObject({ ok: false, reason: 'pending' });
    expect(first.device.machine).toBe(deviceHash(GUID));
    expect(slow.logs).toContain('device: reading is slow, sending what is ready');
    release(SERIAL);
    expect((await reader.device()).volume).toBe(deviceHash('9C4F12AB'));
  });

  it('on a Mac it hashes the hardware and data volume UUIDs, leaves adapters out and asks the kernel about a VM', async () => {
    const runReg = vi.fn(reg);
    const runCommand = vi.fn((file: string, args: readonly string[]) => {
      const outputs: Record<string, string> = {
        ioreg: `+-o J413AP  <class IOPlatformExpertDevice>\n    "IOPlatformUUID" = "${MAC_UUID}"\n`,
        diskutil: `<dict>\n<key>VolumeUUID</key>\n<string>${VOLUME_UUID}</string>\n</dict>`,
        'hw.model': 'Mac14,2\n',
        'hw.optional.arm64': '1\n',
        'kern.hv_vmm_present': '0\n',
      };
      const key = file.endsWith('sysctl') ? (args[1] ?? '') : (file.split('/').pop() ?? '');
      return Promise.resolve(outputs[key] ?? '');
    });
    const { device } = await collectDevice(sources({ platform: 'darwin', runReg, runCommand }));
    expect(runReg).not.toHaveBeenCalled();
    expect(device).toMatchObject({
      machine: null,
      smbios: deviceHash(MAC_UUID),
      volume: deviceHash(VOLUME_UUID),
      mac: [],
      vm: 'none',
    });
    expect(device.profile).toMatchObject({
      system: { manufacturer: 'Apple', model: 'Mac14,2' },
      os_build: '26.0.1',
      native_arch: 'arm64',
    });
  });

  it('a Mac guest is marked as a VM of its own kind', async () => {
    const runCommand = (_file: string, args: readonly string[]): Promise<string> =>
      Promise.resolve(args.includes('kern.hv_vmm_present') ? '1' : '');
    const { device } = await collectDevice(sources({ platform: 'darwin', runCommand }));
    expect(device.vm).toBe('apple');
    expect(device.smbios).toBeNull();
  });

  it.each(['linux', 'freebsd'] as const)(
    'on %s the set is empty and nothing is read',
    async (os) => {
      const runReg = vi.fn(reg);
      const { device, readings } = await collectDevice(sources({ platform: os, runReg }));
      expect(device).toEqual({
        machine: null,
        volume: null,
        mac: [],
        smbios: null,
        disk: null,
        baseboard: null,
        vm: 'unknown',
      });
      expect(runReg).not.toHaveBeenCalled();
      expect(readings.machine).toEqual({ ok: false, ms: 0, reason: 'unsupported' });
    },
  );
});

describe('device signs: one launcher run', () => {
  it('an empty set read without the network is not kept: adapters are added as they appear', async () => {
    let now: Interfaces = {};
    const reader = new DeviceReader(sources({ interfaces: () => now }));
    expect((await reader.device()).mac).toEqual([]);
    now = { 'Wi-Fi': [adapter(MAC)] };
    expect((await reader.device()).mac).toEqual([deviceHash('A4BB6D123456')]);
    now = { Ethernet: [adapter('f8:e4:3b:00:00:01')] };
    expect((await reader.device()).mac).toEqual(
      [deviceHash('A4BB6D123456'), deviceHash('F8E43B000001')].sort(),
    );
    now = {};
    expect((await reader.device()).mac).toHaveLength(2);
  });

  it('a failed registry reading is tried again on the next request, a good one is kept', async () => {
    let machineCalls = 0;
    const runReg = vi.fn(
      regWith({
        machine: () => {
          machineCalls += 1;
          return machineCalls === 1
            ? Promise.reject(new ReadFailure('timeout'))
            : Promise.resolve(regOutput({ MachineGuid: GUID }));
        },
      }),
    );
    const reader = new DeviceReader(sources({ runReg }));
    expect((await reader.device()).machine).toBeNull();
    expect((await reader.device()).machine).toBe(deviceHash(GUID));
    await reader.device();
    expect(machineCalls).toBe(2);
    expect(runReg).toHaveBeenCalledTimes(4);
  });

  it('a reading that keeps failing is given up after a few attempts', async () => {
    const runReg = vi.fn(regWith({ machine: denied }));
    const reader = new DeviceReader(sources({ runReg }));
    for (let request = 0; request < READ_ATTEMPTS + 3; request += 1) {
      expect((await reader.device()).machine).toBeNull();
    }
    expect(runReg).toHaveBeenCalledTimes(READ_ATTEMPTS + 2);
  });

  it('the registry architecture is read once and shared with device()', async () => {
    const runReg = vi.fn(reg);
    const archReads = (): number =>
      runReg.mock.calls.filter(([, args]) => args.includes(ARCH_VALUE)).length;
    const reader = new DeviceReader(sources({ runReg }));
    expect(await reader.registryArch()).toBe('ARM64');
    expect(runReg).toHaveBeenCalledTimes(1);
    expect((await reader.device()).profile?.native_arch).toBe('arm64');
    expect(await reader.registryArch()).toBe('ARM64');
    expect(archReads()).toBe(1);
  });

  it('the registry architecture is not read outside Windows and is null when the reading fails', async () => {
    const runReg = vi.fn(reg);
    expect(
      await new DeviceReader(sources({ platform: 'darwin', runReg })).registryArch(),
    ).toBeNull();
    expect(runReg).not.toHaveBeenCalled();
    const failing = new DeviceReader(sources({ runReg: regWith({ arch: denied }) }));
    expect(await failing.registryArch()).toBeNull();
  });

  it('requests at the same moment share one reading', async () => {
    const runReg = vi.fn(reg);
    const reader = new DeviceReader(sources({ runReg }));
    const [first, second] = await Promise.all([reader.device(), reader.device()]);
    expect(second).toEqual(first);
    expect(runReg).toHaveBeenCalledTimes(3);
  });
});

describe('device signs: raw values stay in memory', () => {
  function expectNoRaw(text: string): void {
    for (const raw of RAW) {
      expect(text).not.toContain(raw);
    }
  }

  it('the log has no raw values, whether the readings succeed or fail', async () => {
    const fine = sources();
    await collectDevice(fine);
    expect(fine.logs).toEqual([]);
    const leaky = sources({
      runReg: (_file, args) =>
        args.includes(MACHINE_VALUE) ? Promise.reject(new Error(`cannot read ${GUID}`)) : denied(),
      volumeDevice: () => Promise.reject(new Error(`serial ${String(SERIAL)} 9C4F12AB`)),
    });
    await collectDevice(leaky);
    expect(leaky.logs.length).toBeGreaterThan(0);
    expectNoRaw(leaky.logs.join('\n'));
  });

  it('the report has hashes, timings and counts, and no raw values', async () => {
    const collection = await collectDevice(sources());
    const report = buildDeviceReport(collection, {
      launcher: '0.1.0',
      platform: 'win32',
      processArch: 'x64',
    });
    const written = JSON.stringify(report);
    expectNoRaw(written);
    expect(written).not.toContain(BIOS_EXTRA);
    expect(written).not.toContain('ANGLE');
    expect(report.device).toEqual(collection.device);
    expect(report.readings.machine).toMatchObject({ ok: true, reason: null });
    expect(report.readings.mac).toMatchObject({
      ok: true,
      adapters: 2,
      addresses: 2,
      remembered: 0,
      kept: 1,
      dropped: { local: 1, virtual: 0 },
    });
    expect(report.readings.mac).not.toHaveProperty('hashes');
    expect(Object.keys(report.readings.bios.values ?? {}).sort()).toEqual([
      'BIOSReleaseDate',
      'BIOSVendor',
      'BIOSVersion',
      'BaseBoardManufacturer',
      'BaseBoardProduct',
      'SystemManufacturer',
      'SystemProductName',
    ]);
    expect(report.readings.native_arch).toMatchObject({ registry: 'ARM64', process: 'x64' });
    expect(report.readings.displays.raw?.[0]?.label).toBe('DELL U2720Q');
    expect(report.readings.gpu.raw?.keys).toEqual(['auxAttributes', 'gpuDevice']);
    expect(report.readings.gpu.raw?.devices).toHaveLength(2);
    expect(report.total_ms).toBeGreaterThan(0);
  });
});

describe('device report mode', () => {
  const on = { MCMONITOR_DEVICE_REPORT: '1' };
  const meta = { launcher: '0.1.0', platform: 'win32', processArch: 'x64' } as const;

  it('needs both the environment variable and the argument', () => {
    const argv = ['launcher.exe', '--device-report=C:\\Temp\\device.json'];
    expect(deviceReportPath(on, argv)).toMatch(/device\.json$/);
    expect(deviceReportPath({}, argv)).toBeNull();
    expect(deviceReportPath({ MCMONITOR_DEVICE_REPORT: 'on' }, argv)).toBeNull();
    expect(deviceReportPath(on, ['launcher.exe'])).toBeNull();
    expect(deviceReportPath(on, ['launcher.exe', '--device-report='])).toBeNull();
  });

  it('ignores the argument after "--" and next to a link', () => {
    const argument = '--device-report=C:\\Temp\\device.json';
    expect(deviceReportPath(on, ['launcher.exe', '--', argument])).toBeNull();
    expect(deviceReportPath(on, ['launcher.exe', argument, '--', 'MCMonitor://play/1'])).toBeNull();
    expect(deviceReportPath(on, ['launcher.exe', argument, '--'])).toMatch(/device\.json$/);
  });

  it('exits with 0 when the report is written and with 1 on any failure', async () => {
    const collect = (): ReturnType<typeof collectDevice> => collectDevice(sources());
    const written: string[] = [];
    const logs: string[] = [];
    const log = (message: string): void => void logs.push(message);
    const write = (_file: string, text: string): Promise<void> => {
      written.push(text);
      return Promise.resolve();
    };
    expect(await runDeviceReport({ file: 'device.json', meta, collect, write, log })).toBe(0);
    expect(JSON.parse(written[0] ?? '')).toMatchObject({ format: 2, platform: 'win32' });
    const broken = (): Promise<never> => Promise.reject(new Error(GUID));
    expect(await runDeviceReport({ file: 'device.json', meta, collect: broken, write, log })).toBe(
      1,
    );
    expect(logs).toEqual(['device-report: not written (failed)']);
  });

  it('refuses to overwrite an existing file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'device-report-'));
    const file = join(folder, 'device.json');
    const logs: string[] = [];
    const run = {
      file,
      meta,
      collect: (): ReturnType<typeof collectDevice> => collectDevice(sources()),
      log: (message: string): void => void logs.push(message),
    };
    try {
      await writeFile(file, 'mine');
      expect(await runDeviceReport(run)).toBe(1);
      expect(await readFile(file, 'utf8')).toBe('mine');
      expect(logs).toEqual(['device-report: not written (eexist)']);
      await rm(file);
      expect(await runDeviceReport(run)).toBe(0);
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ format: 2 });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe('device read at startup', () => {
  it('does not start reading until the timer fires or somebody asks', async () => {
    const read = vi.fn(() => Promise.resolve(emptyDevice()));
    const timers: (() => void)[] = [];
    const device = readAfterStart(read, (run) => {
      timers.push(run);
      return (): void => undefined;
    });
    expect(read).not.toHaveBeenCalled();
    await device();
    expect(read).toHaveBeenCalledTimes(1);
    timers[0]?.();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
