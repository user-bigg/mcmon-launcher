import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEEP_LINK_SCHEME } from '@shared/deep-link';
import type { TelemetryDevice } from '@shared/telemetry';
import type { DeviceCollection, DeviceReadings } from './collect';

export const DEVICE_REPORT_ENV = 'MCMONITOR_DEVICE_REPORT';
export const DEVICE_REPORT_ARGUMENT = '--device-report=';
const REPORT_FORMAT = 2;

export interface DeviceReportMeta {
  launcher: string;
  platform: NodeJS.Platform;
  processArch: string;
}

export interface DeviceReport {
  format: number;
  launcher: string;
  platform: NodeJS.Platform;
  process_arch: string;
  total_ms: number;
  device: TelemetryDevice;
  readings: DeviceReadings;
}

// Everything after "--" comes from a link, and a link must not be able to choose a file to write.
export function deviceReportPath(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): string | null {
  if (env[DEVICE_REPORT_ENV] !== '1') {
    return null;
  }
  if (argv.some((item) => item.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`))) {
    return null;
  }
  const end = argv.indexOf('--');
  const own = end === -1 ? argv : argv.slice(0, end);
  const argument = own.find((item) => item.startsWith(DEVICE_REPORT_ARGUMENT));
  const file = argument?.slice(DEVICE_REPORT_ARGUMENT.length).trim() ?? '';
  return file === '' ? null : resolve(file);
}

export function buildDeviceReport(
  collection: DeviceCollection,
  meta: DeviceReportMeta,
): DeviceReport {
  return {
    format: REPORT_FORMAT,
    launcher: meta.launcher,
    platform: meta.platform,
    process_arch: meta.processArch,
    total_ms: collection.totalMs,
    device: collection.device,
    readings: collection.readings,
  };
}

export interface ReportRun {
  file: string;
  meta: DeviceReportMeta;
  collect: () => Promise<DeviceCollection>;
  write?: (file: string, text: string) => Promise<void>;
  log: (message: string) => void;
}

// An existing file is never overwritten: the path comes from the command line.
export function createReportFile(file: string, text: string): Promise<void> {
  return writeFile(file, text, { flag: 'wx' });
}

function errorCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  return typeof code === 'string' && code !== '' ? code.toLowerCase() : 'failed';
}

export async function runDeviceReport(run: ReportRun): Promise<number> {
  try {
    const report = buildDeviceReport(await run.collect(), run.meta);
    await (run.write ?? createReportFile)(run.file, `${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    run.log(`device-report: not written (${errorCode(error)})`);
    return 1;
  }
}
