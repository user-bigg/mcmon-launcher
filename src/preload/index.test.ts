import { describe, expect, it, vi } from 'vitest';
import { IpcChannels, type LauncherApi } from '@shared/ipc';

const exposed = new Map<string, unknown>();
const send = vi.fn();
const invoke = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown): void => {
      exposed.set(key, value);
    },
  },
  ipcRenderer: { send, invoke, on: vi.fn(), off: vi.fn() },
}));

await import('./index');

describe('preload', () => {
  function api(): LauncherApi {
    return exposed.get('launcher') as LauncherApi;
  }

  it('exposes to the page only window.launcher with the listed sections', () => {
    expect([...exposed.keys()]).toEqual(['launcher']);
    expect(Object.keys(api())).toEqual([
      'window',
      'openExternal',
      'onDeepLink',
      'ackDeepLink',
      'onNavigate',
      'launch',
      'instances',
      'crash',
      'settings',
      'players',
      'mods',
      'site',
      'account',
      'microsoft',
      'system',
      'update',
      'telemetry',
    ]);
  });

  it.each([
    [
      'window',
      ['close', 'isMaximized', 'minimize', 'onMaximizedChanged', 'reportBoot', 'toggleMaximize'],
    ],
    [
      'launch',
      [
        'answerMods',
        'cancel',
        'keepWaiting',
        'kill',
        'launch',
        'logTail',
        'onEvent',
        'prepare',
        'setJoinServer',
        'state',
      ],
    ],
    ['instances', ['launchOptions', 'list', 'remove', 'setWithoutMods', 'sharedFiles']],
    ['crash', ['apply', 'last', 'onEvent', 'report']],
    ['settings', ['get', 'update']],
    ['players', ['get', 'save']],
    ['system', ['autostart', 'enableAutostart', 'java', 'memory']],
    [
      'site',
      [
        'alertSettings',
        'alerts',
        'clearAlerts',
        'ensureScene',
        'favorites',
        'live',
        'meta',
        'onChanged',
        'ownedServer',
        'ownedServers',
        'ping',
        'readAlerts',
        'report',
        'scenes',
        'server',
        'servers',
        'setAlertSettings',
        'setFavorite',
        'setWatch',
        'skinMod',
        'lookPresets',
        'standardSkin',
        'telemetryPreview',
        'vote',
        'votePauses',
      ],
    ],
    [
      'account',
      [
        'cancel',
        'connect',
        'logout',
        'onEvent',
        'playCheck',
        'wear',
        'resetLook',
        'refresh',
        'reopen',
        'setNick',
        'state',
        'submitCode',
      ],
    ],
    ['microsoft', ['cancel', 'login', 'onEvent', 'remove', 'reopen', 'state']],
    ['update', ['check', 'download', 'onEvent', 'restart', 'skip', 'state', 'unskip']],
    ['telemetry', ['behavior', 'track']],
  ] as const)('%s: only the service methods and its subscription', (group, methods) => {
    expect(Object.keys(api()[group]).sort()).toEqual([...methods].sort());
  });

  it('telemetry: a one-way send for events, an invoke for the flag', async () => {
    const event = { type: 'screen.viewed', screen: 'home', server_id: null } as const;
    api().telemetry.track(event);
    expect(send).toHaveBeenCalledWith(IpcChannels.telemetry.track, event);
    await api().telemetry.behavior();
    expect(invoke).toHaveBeenCalledWith(IpcChannels.telemetry.invoke.behavior);
  });

  it('link confirmation — a separate channel', () => {
    api().ackDeepLink(3);
    expect(send).toHaveBeenCalledWith(IpcChannels.deepLink.ack, 3);
  });

  it('calls go through the channels from the shared table with arguments', async () => {
    await api().instances.setWithoutMods('server-3', true);
    expect(invoke).toHaveBeenCalledWith(
      IpcChannels.instances.invoke.setWithoutMods,
      'server-3',
      true,
    );
    await api().site.report(3, { reason: 'other', note: 'Адрес ведёт не туда' });
    expect(invoke).toHaveBeenCalledWith('site:report', 3, {
      reason: 'other',
      note: 'Адрес ведёт не туда',
    });
  });

  it('subscribing sends a subscribe for its own section', () => {
    api().launch.onEvent(() => undefined);
    api().onDeepLink(() => undefined);
    api().account.onEvent(() => undefined);
    api().update.onEvent(() => undefined);
    expect(send).toHaveBeenCalledWith(IpcChannels.launch.events.subscribe);
    expect(send).toHaveBeenCalledWith(IpcChannels.deepLink.events.subscribe);
    expect(send).toHaveBeenCalledWith(IpcChannels.account.events.subscribe);
    expect(send).toHaveBeenCalledWith(IpcChannels.update.events.subscribe);
  });
});
