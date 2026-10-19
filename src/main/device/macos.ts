import { execFile } from 'node:child_process';
import { deviceHash } from './hash';
import { ReadFailure, type RegValues } from './registry';

export type CommandRun = (file: string, args: readonly string[]) => Promise<string>;

const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_MAX_OUTPUT_BYTES = 1024 * 1024;

const PLATFORM_UUID = /"IOPlatformUUID"\s*=\s*"([0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12})"/i;
const VOLUME_UUID =
  /<key>VolumeUUID<\/key>\s*<string>([0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12})<\/string>/i;
// The data volume keeps its UUID across macOS updates; the sealed system volume does not.
const DATA_VOLUME = '/System/Volumes/Data';

function hashOf(match: RegExpExecArray | null): string {
  const hash = deviceHash(match?.[1] ?? null);
  if (hash === null) {
    throw new ReadFailure('malformed');
  }
  return hash;
}

export function platformUuidHash(ioreg: string): string {
  return hashOf(PLATFORM_UUID.exec(ioreg));
}

export function dataVolumeHash(plist: string): string {
  return hashOf(VOLUME_UUID.exec(plist));
}

// Sent as smbios: on a Mac it belongs to the logic board and outlives a reinstall of macOS.
export async function macPlatformHash(run: CommandRun): Promise<string> {
  return platformUuidHash(await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']));
}

export async function macVolumeHash(run: CommandRun): Promise<string> {
  return dataVolumeHash(await run('/usr/sbin/diskutil', ['info', '-plist', DATA_VOLUME]));
}

async function sysctl(run: CommandRun, name: string): Promise<string> {
  return (await run('/usr/sbin/sysctl', ['-n', name])).trim();
}

export async function macComputer(run: CommandRun): Promise<RegValues> {
  const model = await sysctl(run, 'hw.model');
  if (model === '') {
    throw new ReadFailure('empty');
  }
  return { SystemManufacturer: 'Apple', SystemProductName: model };
}

// Named the way the Windows registry names it, so that one mapping serves both systems.
export async function macArch(run: CommandRun): Promise<string> {
  return (await sysctl(run, 'hw.optional.arm64').catch(() => '0')) === '1' ? 'ARM64' : 'AMD64';
}

// Apple's advice for telling a guest from the host; the hypervisor itself is not told.
export async function macIsGuest(run: CommandRun): Promise<boolean> {
  const present = await sysctl(run, 'kern.hv_vmm_present');
  if (present !== '0' && present !== '1') {
    throw new ReadFailure('malformed');
  }
  return present === '1';
}

export const runMacCommand: CommandRun = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_MAX_OUTPUT_BYTES, encoding: 'utf8' },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
        } else {
          reject(new ReadFailure(error.killed ? 'timeout' : 'failed'));
        }
      },
    );
  });
