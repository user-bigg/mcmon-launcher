import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { deviceHash } from './hash';
import { normalizeMac, selectMacs, type Interfaces } from './mac';
import { detectVm, isVirtualMachine, vmFromBios, vmFromMacs } from './vm';

function adapter(mac: string, internal = false): NetworkInterfaceInfo {
  return {
    address: '192.168.1.10',
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac,
    internal,
    cidr: '192.168.1.10/24',
  };
}

function hashes(...macs: string[]): string[] {
  return macs.map((mac) => deviceHash(mac) ?? '').sort();
}

const PHYSICAL = 'a4:bb:6d:12:34:56';
const HOME: Interfaces = {
  Ethernet: [adapter(PHYSICAL), { ...adapter(PHYSICAL), family: 'IPv6', scopeid: 0 }],
  'Wi-Fi': [adapter('da:a1:19:00:00:01')],
  Loopback: [adapter('00:00:00:00:00:00', true)],
  Tunnel: [adapter('00:00:00:00:00:00')],
  'vEthernet (WSL)': [adapter('00:15:5d:aa:bb:cc')],
  'VMware Network Adapter VMnet8': [adapter('00:50:56:c0:00:08')],
  'VirtualBox Host-Only': [adapter('08:00:27:11:22:33')],
};

describe('MAC filter', () => {
  it('normalizes to 12 upper-case hex digits', () => {
    expect(normalizeMac('a4:bb:6d:12:34:56')).toBe('A4BB6D123456');
    expect(normalizeMac('A4-BB-6D-12-34-56')).toBe('A4BB6D123456');
    expect(normalizeMac('a4:bb:6d')).toBeNull();
  });

  it('on a plain computer drops internal, zero, locally administered and virtual host adapters', () => {
    const selected = selectMacs(HOME, 'none');
    expect(selected.hashes).toEqual(hashes('A4BB6D123456'));
    expect(selected.dropped).toEqual({
      internal: 1,
      zero: 1,
      malformed: 0,
      duplicate: 1,
      local: 1,
      virtual: 3,
      over_limit: 0,
    });
    expect(selected).toMatchObject({ adapters: 7, addresses: 8, remembered: 0, kept: 1 });
  });

  it('inside a virtual machine keeps the adapter of the same hypervisor only', () => {
    const guest: Interfaces = {
      Ethernet: [adapter('00:1c:42:aa:bb:cc')],
      Other: [adapter('00:0c:29:aa:bb:cc')],
    };
    expect(selectMacs(guest, 'parallels').hashes).toEqual(hashes('001C42AABBCC'));
    expect(selectMacs(guest, 'vmware').hashes).toEqual(hashes('000C29AABBCC'));
    expect(selectMacs(guest, 'none').hashes).toEqual([]);
    expect(selectMacs(guest, 'unknown').hashes).toEqual([]);
  });

  it('keeps the locally administered QEMU address inside QEMU and drops it elsewhere', () => {
    const guest: Interfaces = { Ethernet: [adapter('52:54:00:12:34:56')] };
    expect(selectMacs(guest, 'qemu').hashes).toEqual(hashes('525400123456'));
    expect(selectMacs(guest, 'none').dropped.virtual).toBe(1);
    expect(selectMacs(guest, 'unknown').hashes).toEqual([]);
  });

  it('sorts, removes repeats and keeps at most ten', () => {
    const many: Interfaces = {};
    for (let index = 0; index < 13; index += 1) {
      const mac = `a4:bb:6d:00:00:${index.toString(16).padStart(2, '0')}`;
      many[`eth${String(index)}`] = [adapter(mac), adapter(mac.toUpperCase())];
    }
    const selected = selectMacs(many, 'none');
    expect(selected.hashes).toHaveLength(10);
    expect(selected.hashes).toEqual([...selected.hashes].sort());
    expect(new Set(selected.hashes).size).toBe(10);
    expect(selected.dropped).toMatchObject({ duplicate: 13, over_limit: 3 });
    expect(selectMacs(many, 'none').hashes).toEqual(selected.hashes);
  });

  it('adds the adapters seen earlier in this run and filters them the same way', () => {
    const now: Interfaces = { Ethernet: [adapter(PHYSICAL)] };
    const earlier = ['A4BB6D123456', 'F8E43B000001', '00155D010203', 'DAA119000001'];
    const selected = selectMacs(now, 'none', earlier);
    expect(selected.hashes).toEqual(hashes('A4BB6D123456', 'F8E43B000001'));
    expect(selected).toMatchObject({ remembered: 3, dropped: { local: 1, virtual: 1 } });
  });

  it('gives an empty list when there are no adapters', () => {
    expect(selectMacs({}, 'none').hashes).toEqual([]);
  });
});

describe('vm', () => {
  it('a known hypervisor is a virtual machine, none is not, unknown stays unknown', () => {
    expect(isVirtualMachine('parallels')).toBe(true);
    expect(isVirtualMachine('hyperv')).toBe(true);
    expect(isVirtualMachine('none')).toBe(false);
    expect(isVirtualMachine('unknown')).toBeNull();
  });

  it.each([
    ['Parallels International GmbH.', 'Parallels ARM Virtual Machine', 'parallels'],
    ['Parallels Software International Inc.', 'Parallels Virtual Platform', 'parallels'],
    ['VMware, Inc.', 'VMware Virtual Platform', 'vmware'],
    ['VMware, Inc.', 'VMware20,1', 'vmware'],
    ['innotek GmbH', 'VirtualBox', 'virtualbox'],
    ['Oracle Corporation', 'VirtualBox', 'virtualbox'],
    ['Microsoft Corporation', 'Virtual Machine', 'hyperv'],
    ['Microsoft Corporation', 'Surface Laptop 5', 'none'],
    ['Microsoft Corporation', 'Surface Pro 9', 'none'],
    ['QEMU', 'Standard PC (Q35 + ICH9, 2009)', 'qemu'],
    ['Red Hat', 'KVM', 'qemu'],
    ['LENOVO', '20XW00FNRT', 'none'],
    ['Micro-Star International Co., Ltd.', 'MS-7C91', 'none'],
    ['System manufacturer', null, 'none'],
  ] as const)('%s / %s is %s', (manufacturer, model, vm) => {
    expect(vmFromBios({ manufacturer, model })).toBe(vm);
  });

  it('is unknown, not none, when the BIOS key was not read', () => {
    expect(detectVm(null, ['A4BB6D123456'])).toEqual({ vm: 'unknown', source: 'none' });
    expect(detectVm({ manufacturer: null, model: null }, [])).toEqual({
      vm: 'unknown',
      source: 'none',
    });
  });

  it('falls back to the prefix of a virtual adapter when the BIOS key was not read', () => {
    expect(detectVm(null, ['001C42AABBCC'])).toEqual({ vm: 'parallels', source: 'mac' });
    expect(vmFromMacs(['525400123456', 'DAA119000001'])).toBe('qemu');
    expect(vmFromMacs(['00155DAABBCC', '005056C00008'])).toBe('unknown');
  });

  it('a computer with a physical adapter is not called a guest by its virtual adapters', () => {
    expect(detectVm(null, ['A4BB6D123456', '00155D010203'])).toEqual({
      vm: 'unknown',
      source: 'none',
    });
    expect(vmFromMacs(['A4BB6D123456', '005056C00001', '005056C00008'])).toBe('unknown');
    const host: Interfaces = {
      Ethernet: [adapter(PHYSICAL)],
      'vEthernet (WSL)': [adapter('00:15:5d:01:02:03')],
    };
    expect(selectMacs(host, detectVm(null, ['A4BB6D123456', '00155D010203']).vm).hashes).toEqual(
      hashes('A4BB6D123456'),
    );
  });

  it.each([
    ['Xen', 'HVM domU'],
    ['Amazon EC2', 't3.medium'],
    ['Google', 'Google Compute Engine'],
  ])('an unlisted hypervisor %s is unknown, not none', (manufacturer, model) => {
    expect(vmFromBios({ manufacturer, model })).toBe('unknown');
  });

  it('trusts the BIOS key over the adapters', () => {
    expect(detectVm({ manufacturer: 'LENOVO', model: '20XW' }, ['00155DAABBCC'])).toEqual({
      vm: 'none',
      source: 'bios',
    });
  });
});
