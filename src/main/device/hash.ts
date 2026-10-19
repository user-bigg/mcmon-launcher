import { createHash } from 'node:crypto';
import type { TelemetryDevice } from '@shared/telemetry';

const DEVICE_PREFIX = 'mcmonitor-device:';

const SHORT_HASH_LENGTH = 8;

export function deviceHash(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const normalized = raw.toUpperCase().replace(/\s+/g, '');
  if (normalized === '') {
    return null;
  }
  return createHash('sha256').update(`${DEVICE_PREFIX}${normalized}`).digest('hex');
}

function shortHash(hash: string | null): string | null {
  return hash === null ? null : `${hash.slice(0, SHORT_HASH_LENGTH)}…`;
}

// A full hash on a screenshot would let a modified client pass for this computer.
export function deviceForDisplay(device: TelemetryDevice): TelemetryDevice {
  return {
    ...device,
    machine: shortHash(device.machine),
    volume: shortHash(device.volume),
    mac: device.mac.map((hash) => shortHash(hash) ?? ''),
    smbios: shortHash(device.smbios),
    disk: shortHash(device.disk),
    baseboard: shortHash(device.baseboard),
  };
}
