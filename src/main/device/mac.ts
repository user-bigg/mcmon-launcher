import type { NetworkInterfaceInfo } from 'node:os';
import { DEVICE_LIMITS, type TelemetryVm } from '@shared/telemetry';
import { deviceHash } from './hash';
import { hypervisorOfMac, isLocallyAdministered } from './vm';

export type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface MacDropped {
  internal: number;
  zero: number;
  malformed: number;
  duplicate: number;
  local: number;
  virtual: number;
  over_limit: number;
}

export interface MacSelection {
  hashes: string[];
  adapters: number;
  addresses: number;
  remembered: number;
  kept: number;
  dropped: MacDropped;
}

const ZERO = '000000000000';

export function normalizeMac(mac: string): string | null {
  const hex = mac.replace(/[:.-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(hex) ? hex : null;
}

function noneDropped(): MacDropped {
  return { internal: 0, zero: 0, malformed: 0, duplicate: 0, local: 0, virtual: 0, over_limit: 0 };
}

export function candidateMacs(
  interfaces: Interfaces,
  dropped: MacDropped = noneDropped(),
): string[] {
  const seen = new Set<string>();
  for (const entry of Object.values(interfaces).flatMap((list) => list ?? [])) {
    const mac = normalizeMac(entry.mac);
    if (entry.internal) {
      dropped.internal += 1;
    } else if (mac === null) {
      dropped.malformed += 1;
    } else if (mac === ZERO) {
      dropped.zero += 1;
    } else if (seen.has(mac)) {
      dropped.duplicate += 1;
    } else {
      seen.add(mac);
    }
  }
  return [...seen];
}

// A guest's own adapter is checked first: the QEMU prefix is locally administered and would
// otherwise fall under the general filter.
function dropReason(mac: string, vm: TelemetryVm): 'local' | 'virtual' | null {
  const hypervisor = hypervisorOfMac(mac);
  if (hypervisor !== null) {
    return hypervisor === vm ? null : 'virtual';
  }
  return isLocallyAdministered(mac) ? 'local' : null;
}

export function selectMacs(
  interfaces: Interfaces,
  vm: TelemetryVm,
  seenEarlier: readonly string[] = [],
): MacSelection {
  const dropped = noneDropped();
  const hashes: string[] = [];
  const current = candidateMacs(interfaces, dropped);
  const remembered = seenEarlier.filter((mac) => !current.includes(mac));
  for (const mac of [...current, ...remembered]) {
    const reason = dropReason(mac, vm);
    const hash = reason === null ? deviceHash(mac) : null;
    if (reason !== null) {
      dropped[reason] += 1;
    } else if (hash !== null) {
      hashes.push(hash);
    }
  }
  hashes.sort();
  dropped.over_limit = Math.max(0, hashes.length - DEVICE_LIMITS.mac);
  const kept = hashes.slice(0, DEVICE_LIMITS.mac);
  return {
    hashes: kept,
    adapters: Object.keys(interfaces).length,
    addresses: Object.values(interfaces).reduce((sum, list) => sum + (list?.length ?? 0), 0),
    remembered: remembered.length,
    kept: kept.length,
    dropped,
  };
}
