import { totalmem } from 'node:os';
import { IpcChannels } from '@shared/ipc';
import { defaultMemoryMb } from '@shared/memory';
import { LAST_VERSION_WITHOUT_CORE_PROFILE } from '@shared/launch';
import type { DeviceGpu } from '@shared/telemetry';
import type {
  AutostartView,
  SystemAutostart,
  SystemGraphics,
  SystemJava,
  SystemMemory,
  SystemResult,
  SystemService,
} from '@shared/system';
import { gameRoot } from './data-root';
import { gpuLimit } from './launch/gpu-support';
import { handleInvokes, UNTRUSTED_SENDER } from './ipc';
import { installedJavaMajors } from './launch/java-installed';
import { gameLayout } from './launch/layout';

function javaOnDisk(): Promise<number[]> {
  return installedJavaMajors(gameLayout(gameRoot()), process.platform);
}

export interface AutostartControl {
  view: () => AutostartView;
  enable: () => Promise<AutostartView>;
}

const NO_AUTOSTART: AutostartControl = {
  view: () => 'off',
  enable: () => Promise.resolve('off'),
};

function autostartOf(view: AutostartView): SystemResult<SystemAutostart> {
  return { ok: true, value: { view } };
}

// The video card check works on Windows only: macOS has no such old chips in Apple Silicon Macs.
export function graphicsOf(platform: NodeJS.Platform, gpus: readonly DeviceGpu[]): SystemGraphics {
  const limit = platform === 'win32' ? gpuLimit(gpus) : null;
  return limit === null
    ? { ceiling: null, gpu: null }
    : { ceiling: LAST_VERSION_WITHOUT_CORE_PROFILE, gpu: limit.name };
}

export function createSystemService(
  totalBytes: () => number = totalmem,
  installedJava: () => Promise<number[]> = javaOnDisk,
  autostart: AutostartControl = NO_AUTOSTART,
): SystemService {
  return {
    autostart: (): Promise<SystemResult<SystemAutostart>> =>
      Promise.resolve(autostartOf(autostart.view())),
    enableAutostart: async (): Promise<SystemResult<SystemAutostart>> =>
      autostartOf(await autostart.enable()),
    memory: (): Promise<SystemResult<SystemMemory>> => {
      const bytes = totalBytes();
      return Promise.resolve({
        ok: true,
        value: { totalMb: Math.floor(bytes / 1024 ** 2), defaultGameMb: defaultMemoryMb(bytes) },
      });
    },
    java: async (): Promise<SystemResult<SystemJava>> => ({
      ok: true,
      value: { installed: await installedJava() },
    }),
  };
}

export function registerSystemIpc(
  devServerUrl: string | undefined,
  autostart: AutostartControl,
): void {
  const service = createSystemService(totalmem, javaOnDisk, autostart);
  handleInvokes<SystemService>(
    IpcChannels.system.invoke,
    {
      memory: () => service.memory(),
      java: () => service.java(),
      autostart: () => service.autostart(),
      enableAutostart: () => service.enableAutostart(),
    },
    {
      devServerUrl,
      untrusted: UNTRUSTED_SENDER,
      onError: (): SystemResult<never> => ({ ok: false, error: { code: 'failed' } }),
    },
  );
}
