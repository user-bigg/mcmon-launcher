import { describe, expect, it } from 'vitest';
import {
  autostartSupported,
  autostartView,
  BACKGROUND_ARGUMENT,
  hasBackgroundArgument,
  isBackgroundStart,
  LOGIN_ITEM_NAME,
  staysInBackground,
  syncAutostart,
  type AutostartHost,
  type LaunchItem,
  type LoginItemApi,
  type LoginItemQuery,
  type LoginItemState,
  type LoginItemWrite,
} from './autostart';

const EXE =
  'C:\\Users\\steve\\AppData\\Local\\Programs\\MC Monitor Launcher\\MCMonitorLauncher.exe';
const MOVED = 'D:\\Games\\MC Monitor Launcher\\MCMonitorLauncher.exe';
const APP_USER_MODEL_ID = 'com.mcmonitor.launcher';

function host(patch: Partial<AutostartHost> = {}): AutostartHost {
  return { packaged: true, platform: 'win32', execPath: EXE, ...patch };
}

// The Run value as found in the registry of a real Windows 11.
const LIVE_RUN_VALUE = `"${EXE}" --background`;
const ENABLED_MARK = '02 00 00 00 00 00 00 00 00 00 00 00';
const TASK_MANAGER_MARK = '03 00 00 00 5A 1B 3C 4D 5E 6F 70 01';

function commandLine(path: string, args: readonly string[]): string {
  return [`"${path}"`, ...args].join(' ');
}

function tokens(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? '');
}

function programOf(line: string): string {
  return tokens(line)[0] ?? '';
}

// base::CommandLine on Windows: a token starting with "--", "-" or "/" is a switch, and
// GetArgs() returns only what is not a switch.
function chromiumArgs(line: string): string[] {
  return tokens(line)
    .slice(1)
    .filter((token) => !/^(--|-|\/)/.test(token));
}

// Behaves as Browser::GetLoginItemSettings and SetLoginItemSettings of Electron 44 on Windows
// (shell/browser/browser_win.cc): `openAtLogin` is read from the value named after the
// AppUserModelID, a write goes under `name`, `launchItems` lists the values of the asked
// executable with CommandLine::GetArgs() and is disabled when the StartupApproved value does
// not start with 02; a write with `enabled: true` deletes that value, `false` writes 03 and zeros.
class WindowsRegistry implements LoginItemApi {
  readonly run = new Map<string, string>();
  readonly approved = new Map<string, string>();
  readonly writes: LoginItemWrite[] = [];

  constructor(private readonly processPath: string) {}

  disable(name: string): void {
    this.approved.set(name, TASK_MANAGER_MARK);
  }

  private enabled(name: string): boolean {
    return (this.approved.get(name) ?? ENABLED_MARK).startsWith('02');
  }

  getLoginItemSettings = (query: LoginItemQuery = {}): LoginItemState => {
    const path = query.path ?? this.processPath;
    const legacy = this.run.get(APP_USER_MODEL_ID);
    const launchItems: LaunchItem[] = [...this.run]
      .filter(([, line]) => programOf(line).toLowerCase() === path.toLowerCase())
      .map(([name, line]) => ({
        name,
        args: chromiumArgs(line),
        scope: 'user',
        enabled: this.enabled(name),
      }));
    return { openAtLogin: legacy === commandLine(path, query.args ?? []), launchItems };
  };

  setLoginItemSettings = (settings: LoginItemWrite): void => {
    this.writes.push(settings);
    const name = settings.name ?? APP_USER_MODEL_ID;
    if (!settings.openAtLogin) {
      this.run.delete(name);
      this.approved.delete(name);
      return;
    }
    this.run.set(name, commandLine(settings.path ?? this.processPath, settings.args ?? []));
    if (settings.enabled === false) {
      this.approved.set(name, '03 00 00 00 00 00 00 00 00 00 00 00');
    } else {
      this.approved.delete(name);
    }
  };

  willLaunch(): boolean {
    return this.run.has(LOGIN_ITEM_NAME) && this.enabled(LOGIN_ITEM_NAME);
  }
}

interface MacLoginItems {
  api: LoginItemApi;
  writes: LoginItemWrite[];
}

function macLoginItems(registered: boolean, openedAtLogin = false): MacLoginItems {
  const writes: LoginItemWrite[] = [];
  const state = { registered };
  const api: LoginItemApi = {
    getLoginItemSettings: () => ({
      openAtLogin: state.registered,
      wasOpenedAtLogin: openedAtLogin,
    }),
    setLoginItemSettings: (settings) => {
      writes.push(settings);
      state.registered = settings.openAtLogin;
    },
  };
  return { api, writes };
}

describe('start with Windows', () => {
  it('writes the entry under its own name with the background argument', () => {
    const registry = new WindowsRegistry(EXE);
    expect(syncAutostart(registry, host(), true)).toBe('written');
    expect(registry.run.get(LOGIN_ITEM_NAME)).toBe(LIVE_RUN_VALUE);
    expect(registry.run.has(APP_USER_MODEL_ID)).toBe(false);
    expect(registry.willLaunch()).toBe(true);
  });

  it('finds its own entry on the next start and does not write it again', () => {
    const registry = new WindowsRegistry(EXE);
    syncAutostart(registry, host(), true);
    expect(registry.getLoginItemSettings({ path: EXE, args: ['--background'] }).openAtLogin).toBe(
      false,
    );
    expect(syncAutostart(registry, host(), true)).toBe('unchanged');
    expect(registry.writes).toHaveLength(1);
  });

  it('turned off in the settings: the entry is gone', () => {
    const registry = new WindowsRegistry(EXE);
    syncAutostart(registry, host(), true);
    expect(syncAutostart(registry, host(), false)).toBe('written');
    expect(registry.run.size).toBe(0);
    expect(registry.willLaunch()).toBe(false);
    expect(syncAutostart(registry, host(), false)).toBe('unchanged');
    expect(registry.run.size).toBe(0);
  });

  it('turned off in the Task Manager: the launcher does not switch it back on', () => {
    const registry = new WindowsRegistry(EXE);
    syncAutostart(registry, host(), true);
    registry.disable(LOGIN_ITEM_NAME);
    expect(syncAutostart(registry, host(), true)).toBe('unchanged');
    expect(registry.writes).toHaveLength(1);
    expect(registry.willLaunch()).toBe(false);
  });

  it('turned off in the Task Manager and then in the settings: nothing is left', () => {
    const registry = new WindowsRegistry(EXE);
    syncAutostart(registry, host(), true);
    registry.disable(LOGIN_ITEM_NAME);
    expect(syncAutostart(registry, host(), false)).toBe('written');
    expect(registry.run.size).toBe(0);
    expect(registry.approved.size).toBe(0);
  });

  it('the executable moved: the entry is replaced with the new path', () => {
    const registry = new WindowsRegistry(MOVED);
    registry.run.set(LOGIN_ITEM_NAME, LIVE_RUN_VALUE);
    expect(syncAutostart(registry, host({ execPath: MOVED }), true)).toBe('written');
    expect(registry.run.get(LOGIN_ITEM_NAME)).toBe(`"${MOVED}" ${BACKGROUND_ARGUMENT}`);
    expect(registry.run.size).toBe(1);
  });

  it('the executable moved and the setting is off: the stale entry is removed', () => {
    const registry = new WindowsRegistry(MOVED);
    registry.run.set(LOGIN_ITEM_NAME, LIVE_RUN_VALUE);
    syncAutostart(registry, host({ execPath: MOVED }), false);
    expect(registry.run.size).toBe(0);
  });

  it('an entry with other arguments is rewritten and stays disabled if it was', () => {
    const registry = new WindowsRegistry(EXE);
    registry.run.set(LOGIN_ITEM_NAME, `"${EXE}" stray`);
    registry.disable(LOGIN_ITEM_NAME);
    expect(syncAutostart(registry, host(), true)).toBe('written');
    expect(registry.run.get(LOGIN_ITEM_NAME)).toBe(LIVE_RUN_VALUE);
    expect(registry.willLaunch()).toBe(false);
  });

  it('keeps the live entry, whose switch Electron does not list, and its Task Manager time', () => {
    const registry = new WindowsRegistry(EXE);
    registry.run.set(LOGIN_ITEM_NAME, LIVE_RUN_VALUE);
    registry.approved.set(LOGIN_ITEM_NAME, ENABLED_MARK);
    expect(registry.getLoginItemSettings({ path: EXE }).launchItems?.[0]?.args).toEqual([]);
    expect(syncAutostart(registry, host(), true)).toBe('unchanged');
    expect(registry.approved.get(LOGIN_ITEM_NAME)).toBe(ENABLED_MARK);
    registry.disable(LOGIN_ITEM_NAME);
    expect(syncAutostart(registry, host(), true)).toBe('unchanged');
    expect(registry.approved.get(LOGIN_ITEM_NAME)).toBe(TASK_MANAGER_MARK);
    expect(registry.writes).toEqual([]);
  });

  it("leaves another program's entry of the same executable alone", () => {
    const registry = new WindowsRegistry(EXE);
    registry.run.set('SomethingElse', `"${EXE}"`);
    syncAutostart(registry, host(), true);
    syncAutostart(registry, host(), false);
    expect([...registry.run.keys()]).toEqual(['SomethingElse']);
  });

  it('a registry that refuses the write does not break the start', () => {
    const api: LoginItemApi = {
      getLoginItemSettings: () => ({ openAtLogin: false, launchItems: [] }),
      setLoginItemSettings: () => {
        throw new Error('access denied');
      },
    };
    expect(syncAutostart(api, host(), true)).toBe('failed');
  });

  it('registers nothing in development and on Linux', () => {
    const registry = new WindowsRegistry(EXE);
    expect(syncAutostart(registry, host({ packaged: false }), true)).toBe('skipped');
    expect(syncAutostart(registry, host({ platform: 'linux' }), true)).toBe('skipped');
    expect(registry.writes).toEqual([]);
  });
});

describe('autostart switched off by the Task Manager', () => {
  it('shows the setting as off with the reason, not as on', () => {
    const registry = new WindowsRegistry(EXE);
    registry.run.set(LOGIN_ITEM_NAME, LIVE_RUN_VALUE);
    expect(autostartView(registry, host(), true)).toBe('on');
    registry.disable(LOGIN_ITEM_NAME);
    expect(autostartView(registry, host(), true)).toBe('blocked');
    expect(autostartView(registry, host(), false)).toBe('off');
  });

  it("the player's own click in the launcher takes the Task Manager mark off", () => {
    const registry = new WindowsRegistry(EXE);
    registry.run.set(LOGIN_ITEM_NAME, LIVE_RUN_VALUE);
    registry.disable(LOGIN_ITEM_NAME);
    expect(syncAutostart(registry, host(), true, true)).toBe('written');
    expect(registry.approved.has(LOGIN_ITEM_NAME)).toBe(false);
    expect(registry.willLaunch()).toBe(true);
    expect(autostartView(registry, host(), true)).toBe('on');
    expect(syncAutostart(registry, host(), true, true)).toBe('unchanged');
  });

  it('a start of the launcher never takes the mark off', () => {
    const registry = new WindowsRegistry(EXE);
    registry.run.set(LOGIN_ITEM_NAME, LIVE_RUN_VALUE);
    registry.disable(LOGIN_ITEM_NAME);
    syncAutostart(registry, host(), true);
    expect(registry.willLaunch()).toBe(false);
  });

  it('is not shown on macOS, in development or when the registry cannot be read', () => {
    const broken: LoginItemApi = {
      getLoginItemSettings: () => {
        throw new Error('denied');
      },
      setLoginItemSettings: () => undefined,
    };
    expect(autostartView(broken, host(), true)).toBe('on');
    expect(autostartView(broken, host({ platform: 'darwin' }), true)).toBe('on');
    expect(autostartView(broken, host({ packaged: false }), true)).toBe('on');
  });
});

describe('start at login on macOS', () => {
  it('registers and removes a login item without Windows arguments', () => {
    const items = macLoginItems(false);
    const mac = host({ platform: 'darwin' });
    expect(syncAutostart(items.api, mac, true)).toBe('written');
    expect(syncAutostart(items.api, mac, true)).toBe('unchanged');
    expect(syncAutostart(items.api, mac, false)).toBe('written');
    expect(items.writes).toEqual([{ openAtLogin: true }, { openAtLogin: false }]);
  });
});

describe('staying in the tray after the window is closed', () => {
  it('only where the launcher really starts with the system', () => {
    expect(staysInBackground(host(), {})).toBe(true);
    expect(staysInBackground(host({ platform: 'darwin' }), {})).toBe(true);
    expect(staysInBackground(host({ platform: 'linux' }), {})).toBe(false);
    expect(staysInBackground(host({ packaged: false }), {})).toBe(false);
    expect(autostartSupported(host({ packaged: false }))).toBe(false);
  });

  it('in development only by an explicit variable, which a packaged launcher ignores', () => {
    const env = { MCMONITOR_DEV_BACKGROUND: '1' };
    expect(staysInBackground(host({ packaged: false }), env)).toBe(true);
    expect(staysInBackground(host({ packaged: false, platform: 'linux' }), env)).toBe(true);
    expect(staysInBackground(host({ platform: 'linux' }), env)).toBe(false);
  });
});

describe('background start', () => {
  it('is told by the argument before the link separator', () => {
    const { api } = macLoginItems(false);
    expect(isBackgroundStart([EXE, '--background'], api, host())).toBe(true);
    expect(isBackgroundStart([EXE], api, host())).toBe(false);
    expect(hasBackgroundArgument([EXE, '--', '--background'])).toBe(false);
    expect(hasBackgroundArgument([EXE, '--', 'mcmonitor://play/1?x=--background'])).toBe(false);
  });

  it('on macOS is told by the login item, in a packaged launcher only', () => {
    const { api } = macLoginItems(true, true);
    expect(isBackgroundStart([], api, host({ platform: 'darwin' }))).toBe(true);
    expect(isBackgroundStart([], api, host({ platform: 'darwin', packaged: false }))).toBe(false);
    expect(isBackgroundStart([], api, host())).toBe(false);
  });
});
