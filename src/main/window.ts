import { BrowserWindow, screen } from 'electron';
import type { WebContents } from 'electron';
import { join } from 'node:path';
import { IpcChannels, SMOKE_ARGUMENT, type AppNavigation } from '@shared/ipc';
import { fitWindowSize, WINDOW_BACKGROUND } from '@shared/window';
import { windowConsoleLine, type WindowFailure } from '@shared/window-failure';
import { windowIcon } from './app-icon';
import type { RevealOptions } from './lifecycle';
import { APP_INDEX_URL } from './origins';
import { recoveryPageUrl } from './recovery/page';
import { WindowRecovery, type GoneDetails } from './recovery/recovery';

const SHOW_FALLBACK_MS = 5000;

export interface WindowOptions {
  devServerUrl: string | undefined;
  smoke?: boolean;
  canShow?: () => boolean;
  playing?: () => boolean;
  idle?: () => boolean;
  report?: ((failure: WindowFailure) => void) | null;
}

export function windowUrl(devServerUrl: string | undefined): string {
  return devServerUrl ?? APP_INDEX_URL;
}

const recoveries = new WeakMap<WebContents, WindowRecovery>();

export function reportGpuGone(details: GoneDetails): void {
  for (const window of BrowserWindow.getAllWindows()) {
    const visible = window.isVisible() && !window.isMinimized();
    recoveries.get(window.webContents)?.gpuGone(details, visible);
  }
}

export function reportBoot(contents: WebContents, mounted: boolean): void {
  const recovery = recoveries.get(contents);
  if (mounted) {
    recovery?.ready();
  } else {
    recovery?.bootFailed();
  }
}

function load(window: BrowserWindow, url: string): void {
  if (!window.isDestroyed()) {
    void window.loadURL(url).catch(() => undefined);
  }
}

function watchRenderer(window: BrowserWindow, options: WindowOptions, show: () => void): void {
  const { webContents } = window;
  const recovery = new WindowRecovery({
    appUrl: windowUrl(options.devServerUrl),
    loadApp: (): void => {
      load(window, windowUrl(options.devServerUrl));
      // A window hidden for the game was on the empty route; the reloaded page would open the
      // home screen and run it unseen until the game ends.
      if (options.idle?.() === true) {
        navigateWindow(window, { kind: 'idle' });
      }
    },
    showPage: (view): void => {
      load(window, recoveryPageUrl(view));
      show();
    },
    closeWindow: (): void => {
      window.close();
    },
    crashRenderer: (): void => {
      if (!webContents.isDestroyed()) {
        webContents.forcefullyCrashRenderer();
      }
    },
    playing: options.playing ?? ((): boolean => false),
    report: options.report ?? null,
    log: (line): void => {
      console.warn(line);
    },
    now: Date.now,
    setTimer: (action, ms): NodeJS.Timeout => setTimeout(action, ms),
    clearTimer: (timer): void => {
      clearTimeout(timer as NodeJS.Timeout);
    },
  });
  recoveries.set(webContents, recovery);
  webContents.on('render-process-gone', (_event, details) => {
    if (!window.isDestroyed()) {
      recovery.gone(details);
    }
  });
  webContents.on('did-fail-load', (_event, errorCode, description, url, isMainFrame) => {
    show();
    recovery.loadFailed({ errorCode, description, url, isMainFrame });
  });
  webContents.on('did-navigate', (_event, url, httpStatus) => {
    recovery.navigated(url, httpStatus);
  });
  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) {
      recovery.navigatedInPage(url);
    }
  });
  webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      recovery.navigationStarted();
    }
  });
  webContents.on('did-finish-load', () => {
    recovery.loaded(webContents.getURL());
  });
  webContents.on('will-navigate', (event, url) => {
    if (recovery.act(url)) {
      event.preventDefault();
    }
  });
  window.on('unresponsive', () => {
    // A renderer paused in the debugger does not answer either, and must not be ended for it.
    if (!webContents.isDevToolsOpened()) {
      recovery.unresponsive();
    }
  });
  webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      console.warn(windowConsoleLine(details.message));
    }
  });
  window.on('responsive', () => {
    recovery.responsive();
  });
  window.once('closed', () => {
    recovery.dispose();
  });
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const { devServerUrl } = options;
  const size = fitWindowSize(screen.getPrimaryDisplay().workAreaSize);
  const window = new BrowserWindow({
    ...size,
    ...windowIcon(process.platform),
    frame: false,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: devServerUrl !== undefined,
      additionalArguments: options.smoke === true ? [SMOKE_ARGUMENT] : [],
    },
  });

  const canShow = options.canShow ?? ((): boolean => true);
  const show = (): void => {
    if (!window.isDestroyed() && !window.isVisible() && canShow()) {
      window.show();
    }
  };
  window.once('ready-to-show', show);
  const fallback = setTimeout(show, SHOW_FALLBACK_MS);
  window.once('closed', () => {
    clearTimeout(fallback);
  });

  watchRenderer(window, options, show);

  window.on('maximize', () => {
    window.webContents.send(IpcChannels.window.maximizedChanged, true);
  });
  window.on('unmaximize', () => {
    window.webContents.send(IpcChannels.window.maximizedChanged, false);
  });

  void window.webContents.setVisualZoomLevelLimits(1, 1);
  window.loadURL(windowUrl(devServerUrl)).catch(() => undefined);
  return window;
}

export function revealWindow(window: BrowserWindow, options: RevealOptions): void {
  if (window.isMinimized()) {
    window.restore();
  }
  if (options.focus) {
    window.show();
    // Windows may refuse the focus to a process that was not started by the click (a request of
    // the site comes through the local port), so the window is at least put above the browser.
    if (process.platform === 'win32') {
      window.moveTop();
    }
    window.focus();
    return;
  }
  if (!window.isVisible()) {
    window.showInactive();
  }
  if (process.platform === 'win32' && !window.isFocused()) {
    window.flashFrame(true);
  }
}

function sendWhenLoaded(contents: WebContents, channel: string, payload: unknown): void {
  if (contents.isDestroyed()) {
    return;
  }
  if (contents.isLoading()) {
    contents.once('did-finish-load', () => {
      sendWhenLoaded(contents, channel, payload);
    });
    return;
  }
  contents.send(channel, payload);
}

export function navigateWindow(window: BrowserWindow, navigation: AppNavigation): void {
  if (!window.isDestroyed()) {
    sendWhenLoaded(window.webContents, IpcChannels.app.navigate, navigation);
  }
}
