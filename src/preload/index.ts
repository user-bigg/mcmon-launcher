import { contextBridge, ipcRenderer } from 'electron';
import type { AccountService } from '@shared/account';
import type { CrashService } from '@shared/crash';
import type { InstanceService } from '@shared/instance';
import {
  IpcChannels,
  SMOKE_ARGUMENT,
  type LauncherApi,
  type ShellApi,
  type WindowApi,
} from '@shared/ipc';
import type { LaunchService } from '@shared/launch';
import type { MicrosoftService } from '@shared/microsoft';
import type { ModsService } from '@shared/mods';
import type { PlayersService } from '@shared/players';
import type { SettingsService } from '@shared/settings';
import type { SiteService } from '@shared/site';
import type { UpdateService } from '@shared/update';
import type { SystemService } from '@shared/system';
import type { TelemetryApi, TrackedEvent } from '@shared/telemetry';
import { invokers, listener, subscription } from './bridge';

const { window: windowChannels } = IpcChannels;

const api: LauncherApi = {
  window: {
    ...invokers<WindowApi>(windowChannels.invoke),
    minimize: (): void => {
      ipcRenderer.send(windowChannels.send.minimize);
    },
    toggleMaximize: (): void => {
      ipcRenderer.send(windowChannels.send.toggleMaximize);
    },
    close: (): void => {
      ipcRenderer.send(windowChannels.send.close);
    },
    reportBoot: (mounted: boolean): void => {
      ipcRenderer.send(windowChannels.send.boot, mounted);
    },
    onMaximizedChanged: listener(windowChannels.maximizedChanged),
  },
  ...invokers<ShellApi>(IpcChannels.shell.invoke),
  onDeepLink: subscription(IpcChannels.deepLink.events),
  ackDeepLink: (id: number): void => {
    ipcRenderer.send(IpcChannels.deepLink.ack, id);
  },
  onNavigate: listener(IpcChannels.app.navigate),
  launch: {
    ...invokers<LaunchService>(IpcChannels.launch.invoke),
    onEvent: subscription(IpcChannels.launch.events),
  },
  instances: invokers<InstanceService>(IpcChannels.instances.invoke),
  crash: {
    ...invokers<CrashService>(IpcChannels.crash.invoke),
    onEvent: subscription(IpcChannels.crash.events),
  },
  settings: invokers<SettingsService>(IpcChannels.settings.invoke),
  players: invokers<PlayersService>(IpcChannels.players.invoke),
  mods: invokers<ModsService>(IpcChannels.mods.invoke),
  site: {
    ...invokers<SiteService>(IpcChannels.site.invoke),
    onChanged: subscription(IpcChannels.site.events),
  },
  account: {
    ...invokers<AccountService>(IpcChannels.account.invoke),
    onEvent: subscription(IpcChannels.account.events),
  },
  microsoft: {
    ...invokers<MicrosoftService>(IpcChannels.microsoft.invoke),
    onEvent: subscription(IpcChannels.microsoft.events),
  },
  system: invokers<SystemService>(IpcChannels.system.invoke),
  update: {
    ...invokers<UpdateService>(IpcChannels.update.invoke),
    onEvent: subscription(IpcChannels.update.events),
  },
  telemetry: {
    ...invokers<TelemetryApi>(IpcChannels.telemetry.invoke),
    track: (event: TrackedEvent): void => {
      ipcRenderer.send(IpcChannels.telemetry.track, event);
    },
  },
};

contextBridge.exposeInMainWorld('launcher', api);

interface SmokePage {
  addEventListener: (type: 'load', listener: () => void, options: { once: boolean }) => void;
  document: { querySelector: (selector: string) => { childElementCount: number } | null };
}

function reportSmokeReady(page: SmokePage): void {
  const mounted = (page.document.querySelector('#app')?.childElementCount ?? 0) > 0;
  ipcRenderer.send(IpcChannels.smoke.ready, { mounted });
}

if (process.argv.includes(SMOKE_ARGUMENT)) {
  const page = globalThis as unknown as SmokePage;
  page.addEventListener(
    'load',
    () => {
      reportSmokeReady(page);
    },
    { once: true },
  );
}
