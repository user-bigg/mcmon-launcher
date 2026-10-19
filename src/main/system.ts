import { totalmem } from 'node:os';
import { IpcChannels } from '@shared/ipc';
import { defaultMemoryMb } from '@shared/memory';
import type {
  AutostartView,
  SystemAutostart,
  SystemJava,
  SystemMemory,
  SystemResult,
  SystemService,
} from '@shared/system';
import { gameRoot } from './data-root';
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
