import type { AccountService } from './account';
import type { CrashService } from './crash';
import type { DeepLinkDelivery } from './deep-link';
import type { InstanceService } from './instance';
import type { LaunchService } from './launch';
import type { MicrosoftService } from './microsoft';
import type { ModsService } from './mods';
import type { PlayersService } from './players';
import type { SettingsService } from './settings';
import type { SiteService } from './site';
import type { UpdateApi, UpdateService } from './update';
import type { SystemService } from './system';
import type { TelemetryApi } from './telemetry';

type AsyncMethod = (...args: never[]) => Promise<unknown>;

export type InvokeMethod<T> = {
  [K in keyof T]-?: T[K] extends AsyncMethod ? K : never;
}[keyof T];

export type InvokeTable<T> = Readonly<Record<InvokeMethod<T>, string>>;

export type Invokers<T> = Pick<T, InvokeMethod<T>>;

export interface WindowApi {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  reportBoot: (mounted: boolean) => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChanged: (listener: (maximized: boolean) => void) => () => void;
}

export interface ShellApi {
  openExternal: (url: string) => Promise<boolean>;
}

export type AppNavigation =
  | { kind: 'idle' }
  | { kind: 'restore' }
  | { kind: 'crash'; instanceId: string }
  | { kind: 'settings'; section: 'about' | null }
  | { kind: 'settings-changed' };

export interface LauncherApi {
  window: WindowApi;
  openExternal: ShellApi['openExternal'];
  onDeepLink: (listener: (delivery: DeepLinkDelivery) => void) => () => void;
  ackDeepLink: (id: number) => void;
  onNavigate: (listener: (navigation: AppNavigation) => void) => () => void;
  launch: LaunchService;
  instances: InstanceService;
  crash: CrashService;
  settings: SettingsService;
  players: PlayersService;
  mods: ModsService;
  site: SiteService;
  account: AccountService;
  microsoft: MicrosoftService;
  system: SystemService;
  update: UpdateApi;
  telemetry: TelemetryApi;
}

export interface EventStream {
  subscribe: string;
  event: string;
}

export const IpcChannels = {
  window: {
    invoke: { isMaximized: 'window:is-maximized' } satisfies InvokeTable<WindowApi>,
    send: {
      minimize: 'window:minimize',
      toggleMaximize: 'window:toggle-maximize',
      close: 'window:close',
      boot: 'window:boot',
    },
    maximizedChanged: 'window:maximized-changed',
  },
  shell: {
    invoke: { openExternal: 'shell:open-external' } satisfies InvokeTable<ShellApi>,
  },
  launch: {
    invoke: {
      prepare: 'launch:prepare',
      launch: 'launch:launch',
      cancel: 'launch:cancel',
      kill: 'launch:kill',
      keepWaiting: 'launch:keep-waiting',
      setJoinServer: 'launch:set-join-server',
      answerMods: 'launch:answer-mods',
      logTail: 'launch:log-tail',
      state: 'launch:state',
    } satisfies InvokeTable<LaunchService>,
    events: { subscribe: 'launch:subscribe', event: 'launch:event' } satisfies EventStream,
  },
  instances: {
    invoke: {
      list: 'instances:list',
      sharedFiles: 'instances:shared-files',
      remove: 'instances:remove',
      launchOptions: 'instances:launch-options',
      setWithoutMods: 'instances:set-without-mods',
    } satisfies InvokeTable<InstanceService>,
  },
  crash: {
    invoke: {
      last: 'crash:last',
      apply: 'crash:apply',
      report: 'crash:report',
    } satisfies InvokeTable<CrashService>,
    events: { subscribe: 'crash:subscribe', event: 'crash:event' } satisfies EventStream,
  },
  site: {
    invoke: {
      meta: 'site:meta',
      servers: 'site:servers',
      server: 'site:server',
      live: 'site:live',
      scenes: 'site:scenes',
      ensureScene: 'site:ensure-scene',
      skinMod: 'site:skin-mod',
      lookPresets: 'site:look-presets',
      standardSkin: 'site:standard-skin',
      ping: 'site:ping',
      telemetryPreview: 'site:telemetry-preview',
      favorites: 'site:favorites',
      setFavorite: 'site:set-favorite',
      vote: 'site:vote',
      report: 'site:report',
      alerts: 'site:alerts',
      readAlerts: 'site:read-alerts',
      clearAlerts: 'site:clear-alerts',
      setWatch: 'site:set-watch',
      alertSettings: 'site:alert-settings',
      setAlertSettings: 'site:set-alert-settings',
      ownedServers: 'site:owned-servers',
      ownedServer: 'site:owned-server',
      votePauses: 'site:vote-pauses',
    } satisfies InvokeTable<SiteService>,
    events: { subscribe: 'site:subscribe', event: 'site:changed' } satisfies EventStream,
  },
  account: {
    invoke: {
      state: 'account:state',
      connect: 'account:connect',
      reopen: 'account:reopen',
      submitCode: 'account:submit-code',
      cancel: 'account:cancel',
      logout: 'account:logout',
      refresh: 'account:refresh',
      setNick: 'account:set-nick',
      playCheck: 'account:play-check',
      wear: 'account:wear',
      resetLook: 'account:reset-look',
    } satisfies InvokeTable<AccountService>,
    events: { subscribe: 'account:subscribe', event: 'account:changed' } satisfies EventStream,
  },
  microsoft: {
    invoke: {
      state: 'microsoft:state',
      login: 'microsoft:login',
      reopen: 'microsoft:reopen',
      cancel: 'microsoft:cancel',
      remove: 'microsoft:remove',
    } satisfies InvokeTable<MicrosoftService>,
    events: { subscribe: 'microsoft:subscribe', event: 'microsoft:changed' } satisfies EventStream,
  },
  update: {
    invoke: {
      state: 'update:state',
      check: 'update:check',
      download: 'update:download',
      skip: 'update:skip',
      unskip: 'update:unskip',
      restart: 'update:restart',
    } satisfies InvokeTable<UpdateService>,
    events: { subscribe: 'update:subscribe', event: 'update:changed' } satisfies EventStream,
  },
  deepLink: {
    events: { subscribe: 'deeplink:subscribe', event: 'deeplink:event' } satisfies EventStream,
    ack: 'deeplink:ack',
  },
  settings: {
    invoke: {
      get: 'settings:get',
      update: 'settings:update',
    } satisfies InvokeTable<SettingsService>,
  },
  players: {
    invoke: {
      get: 'players:get',
      save: 'players:save',
    } satisfies InvokeTable<PlayersService>,
  },
  mods: {
    invoke: {
      catalog: 'mods:catalog',
      choices: 'mods:choices',
      setChoices: 'mods:set-choices',
      serverPlan: 'mods:server-plan',
      setServerOptional: 'mods:set-server-optional',
    } satisfies InvokeTable<ModsService>,
  },
  system: {
    invoke: {
      memory: 'system:memory',
      java: 'system:java',
      autostart: 'system:autostart',
      enableAutostart: 'system:enable-autostart',
    } satisfies InvokeTable<SystemService>,
  },
  telemetry: {
    invoke: { behavior: 'telemetry:behavior' } satisfies InvokeTable<TelemetryApi>,
    track: 'telemetry:track',
  },
  app: {
    navigate: 'app:navigate',
  },
  smoke: {
    ready: 'smoke:ready',
  },
} as const;

export const SMOKE_ARGUMENT = '--mcmonitor-smoke';
export const SMOKE_CLI_ARGUMENT = '--smoke';
