import type { AutostartView } from '@shared/system';

export const BACKGROUND_ARGUMENT = '--background';
export const LOGIN_ITEM_NAME = 'MCMonitorLauncher';
export const DEV_BACKGROUND_ENV = 'MCMONITOR_DEV_BACKGROUND';

export interface LoginItemQuery {
  path?: string;
  args?: string[];
}

export interface LoginItemWrite extends LoginItemQuery {
  openAtLogin: boolean;
  name?: string;
  enabled?: boolean;
}

export interface LaunchItem {
  name: string;
  args: string[];
  scope: string;
  enabled: boolean;
}

export interface LoginItemState {
  openAtLogin: boolean;
  wasOpenedAtLogin?: boolean;
  launchItems?: LaunchItem[];
}

export interface LoginItemApi {
  getLoginItemSettings: (query?: LoginItemQuery) => LoginItemState;
  setLoginItemSettings: (settings: LoginItemWrite) => void;
}

export interface AutostartHost {
  packaged: boolean;
  platform: NodeJS.Platform;
  execPath: string;
}

export type AutostartSync = 'skipped' | 'unchanged' | 'written' | 'failed';

export function autostartSupported(host: AutostartHost): boolean {
  return host.packaged && (host.platform === 'win32' || host.platform === 'darwin');
}

// Closing the window leaves the launcher in the tray only where it really comes back with the
// system. In development the variable switches it on to look at the behaviour.
export function staysInBackground(host: AutostartHost, env: NodeJS.ProcessEnv): boolean {
  return autostartSupported(host) || (!host.packaged && env[DEV_BACKGROUND_ENV] === '1');
}

// Electron fills `args` with CommandLine::GetArgs, which leaves the switches out, so the entry
// `"…\MCMonitorLauncher.exe" --background` comes back with no arguments at all.
function hasOwnArguments(args: readonly string[]): boolean {
  return args.every((arg) => arg === BACKGROUND_ARGUMENT);
}

// On Windows `openAtLogin` is read from the value named after the AppUserModelID, while the
// entry is written under LOGIN_ITEM_NAME, so it is always false there. `launchItems` lists the
// Run values of this executable with their names, and keeps one that the Task Manager disabled.
function windowsEntry(api: LoginItemApi, host: AutostartHost): LaunchItem | null {
  const items = api.getLoginItemSettings({ path: host.execPath }).launchItems ?? [];
  return items.find((item) => item.scope === 'user' && item.name === LOGIN_ITEM_NAME) ?? null;
}

// A matching entry is left alone: writing it again would switch back on a start that the player
// has turned off in the Task Manager. An entry of another path is not listed and gets replaced.
// Only the player's own click in the launcher takes the Task Manager mark off (`enabled: true`
// deletes the StartupApproved value).
function syncWindows(
  api: LoginItemApi,
  host: AutostartHost,
  enabled: boolean,
  byPlayer: boolean,
): AutostartSync {
  const entry = windowsEntry(api, host);
  if (!enabled) {
    api.setLoginItemSettings({ openAtLogin: false, path: host.execPath, name: LOGIN_ITEM_NAME });
    return entry === null ? 'unchanged' : 'written';
  }
  const matches = entry !== null && hasOwnArguments(entry.args);
  if (matches && (entry.enabled || !byPlayer)) {
    return 'unchanged';
  }
  api.setLoginItemSettings({
    openAtLogin: true,
    path: host.execPath,
    args: [BACKGROUND_ARGUMENT],
    name: LOGIN_ITEM_NAME,
    enabled: byPlayer || (entry?.enabled ?? true),
  });
  return 'written';
}

function syncMac(api: LoginItemApi, enabled: boolean): AutostartSync {
  if (api.getLoginItemSettings().openAtLogin === enabled) {
    return 'unchanged';
  }
  api.setLoginItemSettings({ openAtLogin: enabled });
  return 'written';
}

export function syncAutostart(
  api: LoginItemApi,
  host: AutostartHost,
  enabled: boolean,
  byPlayer = false,
): AutostartSync {
  if (!autostartSupported(host)) {
    return 'skipped';
  }
  try {
    return host.platform === 'win32'
      ? syncWindows(api, host, enabled, byPlayer)
      : syncMac(api, enabled);
  } catch {
    return 'failed';
  }
}

// What the player sees: the setting is on, but the Task Manager has switched the entry off.
export function autostartView(
  api: LoginItemApi,
  host: AutostartHost,
  enabled: boolean,
): AutostartView {
  if (!enabled) {
    return 'off';
  }
  if (!autostartSupported(host) || host.platform !== 'win32') {
    return 'on';
  }
  try {
    return windowsEntry(api, host)?.enabled === false ? 'blocked' : 'on';
  } catch {
    return 'on';
  }
}

function beforeSeparator(argv: readonly string[]): readonly string[] {
  const end = argv.indexOf('--');
  return end === -1 ? argv : argv.slice(0, end);
}

export function hasBackgroundArgument(argv: readonly string[]): boolean {
  return beforeSeparator(argv).includes(BACKGROUND_ARGUMENT);
}

// macOS has no arguments for a login item, it only tells that the start came from the login.
export function isBackgroundStart(
  argv: readonly string[],
  api: LoginItemApi,
  host: AutostartHost,
): boolean {
  if (hasBackgroundArgument(argv)) {
    return true;
  }
  return (
    host.packaged &&
    host.platform === 'darwin' &&
    api.getLoginItemSettings().wasOpenedAtLogin === true
  );
}
