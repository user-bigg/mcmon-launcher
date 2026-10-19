import type { TelemetryVm } from '@shared/telemetry';

export type Hypervisor = Exclude<TelemetryVm, 'none' | 'unknown'>;

const VIRTUAL_MAC_PREFIXES: Readonly<Record<string, Hypervisor>> = {
  '00155D': 'hyperv',
  '005056': 'vmware',
  '000C29': 'vmware',
  '000569': 'vmware',
  '080027': 'virtualbox',
  '001C42': 'parallels',
  '525400': 'qemu',
};

export function hypervisorOfMac(mac: string): Hypervisor | null {
  return VIRTUAL_MAC_PREFIXES[mac.slice(0, 6)] ?? null;
}

interface VmRule {
  vm: Hypervisor | 'unknown';
  manufacturer?: RegExp;
  model?: RegExp;
}

// Microsoft Corporation is both Hyper-V and Surface: only the model tells them apart.
const VM_RULES: readonly VmRule[] = [
  { vm: 'parallels', manufacturer: /parallels/i },
  { vm: 'parallels', model: /parallels/i },
  { vm: 'vmware', manufacturer: /vmware/i },
  { vm: 'vmware', model: /vmware/i },
  { vm: 'virtualbox', manufacturer: /innotek/i },
  { vm: 'virtualbox', model: /virtualbox/i },
  { vm: 'hyperv', manufacturer: /^microsoft corporation$/i, model: /^virtual machine$/i },
  { vm: 'qemu', manufacturer: /qemu/i },
  { vm: 'qemu', model: /qemu|\bkvm\b/i },
  { vm: 'unknown', manufacturer: /xen|bochs|amazon ec2|google|openstack/i },
  { vm: 'unknown', model: /xen|bochs|hvm domu|google compute engine|openstack/i },
];

function matches(rule: VmRule, manufacturer: string, model: string): boolean {
  return (rule.manufacturer?.test(manufacturer) ?? true) && (rule.model?.test(model) ?? true);
}

export interface ComputerName {
  manufacturer: string | null;
  model: string | null;
}

export function vmFromBios(computer: ComputerName): TelemetryVm | null {
  if (computer.manufacturer === null && computer.model === null) {
    return null;
  }
  const rule = VM_RULES.find((item) =>
    matches(item, computer.manufacturer ?? '', computer.model ?? ''),
  );
  return rule?.vm ?? 'none';
}

const LOCALLY_ADMINISTERED = 0b10;

export function isLocallyAdministered(mac: string): boolean {
  return (Number.parseInt(mac.slice(0, 2), 16) & LOCALLY_ADMINISTERED) !== 0;
}

function isPhysical(mac: string): boolean {
  return hypervisorOfMac(mac) === null && !isLocallyAdministered(mac);
}

// A host with Hyper-V, WSL or VMware has virtual adapters next to a physical one; calling it a
// guest would keep their addresses, and the VMware host ones are the same on every computer.
export function vmFromMacs(macs: readonly string[]): TelemetryVm {
  const found = new Set(macs.flatMap((mac) => hypervisorOfMac(mac) ?? []));
  const [only] = [...found];
  return found.size === 1 && only !== undefined && !macs.some(isPhysical) ? only : 'unknown';
}

export function isVirtualMachine(vm: TelemetryVm): boolean | null {
  if (vm === 'unknown') {
    return null;
  }
  return vm !== 'none';
}

export type VmSource = 'bios' | 'mac' | 'sysctl' | 'none';

export interface VmVerdict {
  vm: TelemetryVm;
  source: VmSource;
}

export function detectVm(computer: ComputerName | null, macs: readonly string[]): VmVerdict {
  const fromBios = computer === null ? null : vmFromBios(computer);
  if (fromBios !== null) {
    return { vm: fromBios, source: 'bios' };
  }
  const fromMacs = vmFromMacs(macs);
  return { vm: fromMacs, source: fromMacs === 'unknown' ? 'none' : 'mac' };
}
