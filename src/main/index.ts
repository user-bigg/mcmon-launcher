import { app, BrowserWindow, nativeImage, powerMonitor } from 'electron';
import { release } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { deepLinkFromArgv, parseDeepLink, type DeepLink } from '@shared/deep-link';
import { SITE_URL } from '@shared/links';
import { gameWindowOf } from '@shared/settings';
import { windowReportsEnabled } from '@shared/window-failure';
import { DeepLinkInbox, registerProtocolClient, type ProtocolRegistration } from './deep-links';
import { deviceReportPath, writeDeviceReport } from './device';
import { DOCK_ICON_PATH, needsDockIcon } from './app-icon';
import {
  autostartView,
  hasBackgroundArgument,
  isBackgroundStart,
  staysInBackground,
  syncAutostart,
  type AutostartHost,
  type AutostartSync,
} from './autostart';
import { openHttps, registerExternalIpc } from './external';
import { aliveStateOf, Farewell } from './farewell';
import { GameDialogWatch, waitsForGameWindow } from './game-dialog';
import { registerWindowIpc } from './ipc';
import { startLaunchService, type LaunchServices } from './launch';
import { GameLifecycle, type LifecycleDock } from './lifecycle';
import { installApplicationMenu } from './menu';
import { startMicrosoft } from './microsoft';
import { confirmGameAction, notifyHiddenToTray, notifyLeftInTray, promptOpen } from './prompts';
import { registerAppScheme, serveApp } from './protocol';
import { applyDevCsp, hardenApp, restrictPermissions } from './security';
import { LauncherSettingsStore, registerSettingsIpc, SETTINGS_FILE } from './settings';
import { registerModsIpc } from './mods/ipc';
import { createModsService } from './mods/service';
import { WINDOW_REPORT_INTAKE, windowReporter } from './recovery/report';
import { siteApiBase, telemetryOs } from './site/config';
import { allowedOrigins, SitePortSwitch, startSitePort, type ServerLookup } from './site-port';
import type { AutostartView } from '@shared/system';
import { registerSystemIpc, type AutostartControl } from './system';
import { failSmoke, isSmokeRun, watchSmoke } from './smoke';
import { startSite, type SiteClosing, type SiteRuntime } from './site';
import { createAppTray, type AppTray } from './tray';
import { offerMoveToApplications, shouldOfferMove } from './move-to-applications';
import { appBundleOf, isWritable, macInstallBlocker } from './update/mac-install';
import { startUpdates, type UpdateRuntime } from './update';
import {
  createMainWindow,
  navigateWindow,
  reportBoot,
  reportGpuGone,
  revealWindow,
} from './window';

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const smoke = isSmokeRun();
const deviceReport = deviceReportPath();
const inbox = new DeepLinkInbox();
let lifecycle: GameLifecycle<BrowserWindow> | null = null;
let services: LaunchServices | null = null;
let protocol: ProtocolRegistration | null = null;
let site: SiteRuntime | null = null;
let updates: UpdateRuntime | null = null;
let farewell: Farewell | null = null;
let tray: AppTray | null = null;
let sitePort: SitePortSwitch | null = null;
let windowOpen = false;
let installing = false;
let showWhenStarted = false;

const autostartHost: AutostartHost = {
  packaged: app.isPackaged,
  platform: process.platform,
  execPath: process.execPath,
};

const windowReports = windowReporter(windowReportsEnabled(), WINDOW_REPORT_INTAKE, () => ({
  at: new Date().toISOString(),
  gameRunning: lifecycle?.playing === true,
  launcher: app.getVersion(),
  os: telemetryOs(process.platform),
  osRelease: release(),
  arch: process.arch,
}));

app.enableSandbox();
// Without an Apple Team ID the keychain binds its access list to the build's code hash, so every
// update of an unsigned launcher would ask for the keychain password. Chromium's own key is used
// instead; the data folder is readable only by the user's account. Development shares that
// folder, so it uses the same key, or switching between the two would drop the sign-ins.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('use-mock-keychain');
}
registerAppScheme(devServerUrl !== undefined);
hardenApp(devServerUrl);

function receiveLink(link: DeepLink | null): void {
  if (inbox.receive(link)) {
    stayOpen();
    showWhenStarted ||= lifecycle === null;
    lifecycle?.revealForLink();
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveLink(parseDeepLink(url));
});

function openSettings(section: 'about' | null): void {
  const window = lifecycle?.showByUser();
  if (window !== undefined) {
    navigateWindow(window, { kind: 'settings', section });
  }
}

function serveRenderer(site: SiteRuntime): void {
  restrictPermissions(devServerUrl);
  const cache = { root: site.cacheRoot, resolve: site.resolveCache };
  installApplicationMenu(devServerUrl !== undefined, {
    about: (): void => {
      openSettings('about');
    },
    settings: (): void => {
      openSettings(null);
    },
    site: (): void => {
      void openHttps(SITE_URL);
    },
  });
  if (devServerUrl === undefined) {
    serveApp(join(import.meta.dirname, '../renderer'), cache);
  } else {
    serveApp(null, cache, new URL(devServerUrl).origin);
    applyDevCsp(devServerUrl);
  }
}

// On Windows sign-out the window gets query-session-end/session-end: a dialog would not have
// time to show, and the system closes the game itself, so we just allow the quit.
function watchSessionEnd(window: BrowserWindow, current: GameLifecycle<BrowserWindow>): void {
  if (process.platform !== 'win32') {
    return;
  }
  window.on('query-session-end', () => {
    farewell?.skip();
    current.endSession();
  });
  window.on('session-end', () => {
    farewell?.skip();
    current.endSession();
  });
}

function createLifecycle(
  launch: LaunchServices['service'],
  settings: LauncherSettingsStore,
): GameLifecycle<BrowserWindow> {
  const current: GameLifecycle<BrowserWindow> = new GameLifecycle<BrowserWindow>({
    launch,
    whileGame: () => settings.settings.whileGame,
    openWindow: (): BrowserWindow => {
      const window = createMainWindow({
        devServerUrl,
        smoke,
        canShow: () => !current.hidden,
        playing: () => current.playing,
        idle: () => current.hidden,
        report: windowReports,
      });
      watchSessionEnd(window, current);
      windowOpen = true;
      window.once('closed', () => {
        windowOpen = false;
      });
      updates?.controller.onForeground();
      return window;
    },
    revealWindow,
    navigate: navigateWindow,
    createTray: (actions): AppTray => {
      const created = createAppTray({
        actions,
        autostart: () => autostartView(app, autostartHost, settings.settings.autostart) === 'on',
        setAutostart: (enabled): void => {
          const change = enabled
            ? autostartControl(settings).enable()
            : settings.update({ autostart: false });
          void change
            .catch(() => undefined)
            .then(() => {
              // Redrawn even after a failed save, so the mark shows the real setting again.
              created.refresh();
              const window = current.current;
              if (window !== null) {
                navigateWindow(window, { kind: 'settings-changed' });
              }
            });
        },
      });
      tray = created;
      return created;
    },
    confirm: confirmGameAction,
    background: () =>
      !smoke && settings.settings.autostart && staysInBackground(autostartHost, process.env),
    // An update install that the player refused to quit for must not leave the port answering
    // 'not ready' until the next start.
    onQuitCancelled: (): void => {
      installing = false;
      updates?.controller.cancelRestart();
    },
    gameName: () => launch.lastLaunchRequest()?.name ?? null,
    onLeftInTray: (): void => {
      if (!settings.hints.leftInTrayNotified) {
        notifyLeftInTray();
        void settings.markHint('leftInTrayNotified').catch(() => undefined);
      }
    },
    onHiddenToTray: (): void => {
      if (!settings.hints.trayNotified) {
        notifyHiddenToTray();
        void settings.markHint('trayNotified').catch(() => undefined);
      }
    },
    quit: (): void => {
      app.quit();
    },
    dock: macDock(),
  });
  return current;
}

// A launcher left in the menu bar without a window drops its Dock icon, like menu bar apps do.
function macDock(): LifecycleDock | undefined {
  const dock = app.dock;
  if (dock === undefined) {
    return undefined;
  }
  return {
    hide: (): void => {
      dock.hide();
    },
    show: (): void => {
      void dock.show();
    },
  };
}

function logAutostart(result: AutostartSync, enabled: boolean): void {
  if (result === 'written') {
    console.warn(`autostart: ${enabled ? 'registered' : 'removed'}`);
  } else if (result === 'failed') {
    console.warn('autostart: the system refused to change the login item');
  }
}

// A change of the setting always comes from the player, so it may take the Task Manager mark
// off; the sync at start never does.
function followAutostart(settings: LauncherSettingsStore): void {
  const apply = (byPlayer: boolean): void => {
    const enabled = settings.settings.autostart;
    logAutostart(syncAutostart(app, autostartHost, enabled, byPlayer), enabled);
  };
  apply(false);
  settings.onChange((previous, next) => {
    if (previous.autostart !== next.autostart) {
      apply(true);
      tray?.refresh();
    }
  });
}

function autostartControl(settings: LauncherSettingsStore): AutostartControl {
  const view = (): AutostartView => autostartView(app, autostartHost, settings.settings.autostart);
  return {
    view,
    enable: async (): Promise<AutostartView> => {
      if (settings.settings.autostart) {
        logAutostart(syncAutostart(app, autostartHost, true, true), true);
        tray?.refresh();
      } else {
        await settings.update({ autostart: true });
      }
      return view();
    },
  };
}

// Only Windows makes the launcher the owner of the game's error dialog.
function watchGameDialog(
  launch: LaunchServices['service'],
  current: GameLifecycle<BrowserWindow>,
): void {
  if (process.platform !== 'win32') {
    return;
  }
  const watch = new GameDialogWatch({
    window: (): BrowserWindow | null => current.current,
    ownPrompt: promptOpen,
    found: (): void => {
      console.warn('launch: the game shows its own dialog');
      launch.noteGameDialog();
    },
  });
  launch.onEvent((event) => {
    watch.update(waitsForGameWindow(event.state));
  });
}

async function lookupServer(runtime: SiteRuntime, serverId: number): Promise<ServerLookup> {
  const card = await runtime.service.server(serverId);
  if (card.ok) {
    return 'found';
  }
  return card.error.code === 'not-found' ? 'missing' : 'unknown';
}

function listenForSite(runtime: SiteRuntime, launch: LaunchServices['service']): SitePortSwitch {
  const open = (): ReturnType<typeof startSitePort> =>
    startSitePort({
      version: app.getVersion(),
      origins: allowedOrigins(app.isPackaged, SITE_URL, siteApiBase(app.isPackaged, process.env)),
      ready: () => !installing,
      busy: () => !launch.isIdle(),
      raise: (): void => {
        stayOpen();
        lifecycle?.revealForLink();
      },
      lookup: (serverId) => lookupServer(runtime, serverId),
      play: receiveLink,
      now: Date.now,
      log: (line): void => {
        console.warn(line);
      },
    });
  const port = new SitePortSwitch(open);
  const release = (): void => {
    void port.release();
  };
  const listen = (): void => {
    void port.listen();
  };
  // Windows sends the lock for a locked screen and for a switch to another user alike; macOS
  // tells about a switch of the user with its own pair of events.
  powerMonitor.on('lock-screen', release);
  powerMonitor.on('unlock-screen', listen);
  if (process.platform === 'darwin') {
    powerMonitor.on('user-did-resign-active', release);
    powerMonitor.on('user-did-become-active', listen);
  }
  listen();
  return port;
}

// Windows hide at once, so the short wait for the last requests does not look like a hang.
function hideWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.hide();
  }
}

function sayFarewell(closing: SiteClosing): Farewell {
  return new Farewell({
    ...closing,
    wait: (ms): Promise<void> => sleep(ms),
    hideWindows,
    quit: (): void => {
      app.quit();
    },
  });
}

// A second start or a link while the last requests are leaving: the launcher stays open instead.
function stayOpen(): void {
  if (farewell?.stay() === true) {
    lifecycle?.cancelQuit();
  }
}

async function start(): Promise<void> {
  app.setAppUserModelId('com.mcmonitor.launcher');
  if (needsDockIcon(process.platform, app.isPackaged)) {
    app.dock?.setIcon(nativeImage.createFromPath(DOCK_ICON_PATH));
  }
  const settings = new LauncherSettingsStore(join(app.getPath('userData'), SETTINGS_FILE));
  await settings.load();
  const background =
    !smoke && inbox.size === 0 && isBackgroundStart(process.argv, app, autostartHost);
  const startedBy = background ? 'autostart' : 'user';
  const bundle = process.platform === 'darwin' ? appBundleOf(process.execPath) : null;
  const moveOffer = {
    packaged: app.isPackaged,
    platform: process.platform,
    cannotUpdateHere: bundle !== null && macInstallBlocker(bundle, isWritable) === 'move',
    declined: settings.hints.moveDeclined,
    startedByLink: inbox.size > 0,
  };
  if (bundle !== null && !smoke && !background && shouldOfferMove(moveOffer)) {
    const moved = await offerMoveToApplications(settings, bundle, (message) => {
      console.warn(message);
    });
    if (moved !== 'stay') {
      app.quit();
      return;
    }
  }
  const started = startSite(
    devServerUrl,
    {
      quiet: smoke,
      reason: inbox.size > 0 ? 'deeplink' : startedBy,
      aliveState: () => aliveStateOf(lifecycle?.playing === true, lifecycle?.current ?? null),
    },
    {
      get: (): number | null => settings.favoritesCount,
      set: (count): void => {
        void settings.rememberFavorites(count).catch(() => undefined);
      },
    },
  );
  farewell = started.closing === null ? null : sayFarewell(started.closing);
  site = started;
  serveRenderer(started);
  if (!smoke) {
    protocol = registerProtocolClient();
  }
  registerWindowIpc(devServerUrl, reportBoot);
  registerExternalIpc(devServerUrl);
  registerSystemIpc(devServerUrl, autostartControl(settings));
  inbox.listen(devServerUrl);
  const microsoft = startMicrosoft(devServerUrl, (id) => {
    void settings.forgetMicrosoft(id).catch(() => undefined);
  });
  registerSettingsIpc(settings, devServerUrl, microsoft.has);
  registerModsIpc(
    createModsService({
      catalog: started.modCatalog,
      serverMods: started.serverMods,
      store: settings,
    }),
    devServerUrl,
  );
  const launched = startLaunchService(
    devServerUrl,
    started.telemetry,
    microsoft.resolvePlayer,
    started.playCheck,
    started.skinMod,
    started.registryArch,
    started.virtualMachine,
    () => gameWindowOf(settings.settings),
    {
      catalog: started.mods,
      server: started.serverMods,
      choices: () => Promise.resolve(settings.modChoices),
    },
    started.launcherOnly,
  );
  services = launched;
  updates = startUpdates({
    devServerUrl,
    settings,
    launch: launched.service,
    checks: !smoke,
    background: () => !windowOpen,
    beforeInstall: (): void => {
      installing = true;
      farewell?.skip();
    },
  });
  const current = createLifecycle(launched.service, settings);
  lifecycle = current;
  watchGameDialog(launched.service, current);
  if (smoke) {
    watchSmoke(current.open(), devServerUrl, () => launched.service.loadEngine());
    return;
  }
  followAutostart(settings);
  current.startTray();
  if (!background || showWhenStarted) {
    current.open();
  } else {
    current.stayHidden();
  }
  sitePort = listenForSite(started, launched.service);
}

if (deviceReport !== null) {
  void app
    .whenReady()
    .then(() => writeDeviceReport(deviceReport))
    .catch(() => 1)
    .then((code) => {
      app.exit(code);
    });
} else if (!app.requestSingleInstanceLock()) {
  if (smoke) {
    failSmoke();
  } else {
    app.quit();
  }
} else {
  app.on('second-instance', (_event, argv) => {
    const link = deepLinkFromArgv(argv);
    // A second start by the login item must not open the window of a launcher that is already
    // waiting in the tray.
    if (link === null && hasBackgroundArgument(argv)) {
      return;
    }
    inbox.receive(link);
    stayOpen();
    // A shortcut clicked while a background start is still on its way: the window opens as
    // soon as the start is over.
    showWhenStarted ||= lifecycle === null;
    lifecycle?.revealForLink();
  });
  inbox.receive(deepLinkFromArgv(process.argv));
  void app.whenReady().then(start);

  app.on('activate', () => {
    lifecycle?.showByUser();
  });

  app.on('before-quit', (event) => {
    if (lifecycle?.holdQuit() === true) {
      event.preventDefault();
      return;
    }
    if (farewell?.holdQuit() === true) {
      event.preventDefault();
      return;
    }
    lifecycle?.shutdown();
    void sitePort?.release();
    services?.dispose();
    site?.dispose();
    updates?.dispose();
  });

  app.on('child-process-gone', (_event, details) => {
    console.warn(
      `window: child process gone type=${details.type} reason=${details.reason} exitCode=${String(details.exitCode)}`,
    );
    if (details.type === 'GPU') {
      reportGpuGone(details);
    }
  });

  app.on('will-quit', () => {
    protocol?.unregister();
  });

  app.on('window-all-closed', () => {
    if (lifecycle?.canQuitOnAllClosed() ?? true) {
      app.quit();
    }
  });
}
