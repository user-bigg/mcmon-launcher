import { app, screen } from 'electron';
import { stat } from 'node:fs/promises';
import { cpus, networkInterfaces, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { DeviceReader, type DeviceSources } from './collect';
import { runMacCommand } from './macos';
import { runDeviceReport } from './report';
import { runRegExe } from './registry';

export { rememberRegistryArch } from './arch-memory';
export { DeviceReader, emptyDevice } from './collect';
export { readAfterStart } from './deferred';
export { deviceReportPath } from './report';
export { isVirtualMachine } from './vm';

export function deviceSources(log: (message: string) => void): DeviceSources {
  return {
    platform: process.platform,
    env: process.env,
    processArch: process.arch,
    runReg: runRegExe,
    runCommand: runMacCommand,
    systemVersion: () => process.getSystemVersion(),
    // libuv puts the volume serial number into st_dev on Windows.
    volumeDevice: async (root): Promise<bigint> => (await stat(root, { bigint: true })).dev,
    interfaces: networkInterfaces,
    cpus,
    memoryBytes: totalmem,
    osRelease: release,
    gpuInfo: (): Promise<unknown> => app.getGPUInfo('basic'),
    displays: () =>
      screen.getAllDisplays().map((display) => ({
        size: { width: display.size.width, height: display.size.height },
        scaleFactor: display.scaleFactor,
        label: display.label,
      })),
    wait: async (ms): Promise<void> => {
      await sleep(ms, undefined, { ref: false });
    },
    now: () => performance.now(),
    log,
  };
}

export function writeDeviceReport(file: string): Promise<number> {
  const log = (message: string): void => {
    console.error(message);
  };
  return runDeviceReport({
    file,
    meta: { launcher: app.getVersion(), platform: process.platform, processArch: process.arch },
    collect: () => new DeviceReader(deviceSources(log)).collect(),
    log,
  });
}
