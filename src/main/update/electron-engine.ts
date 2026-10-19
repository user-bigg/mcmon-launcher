import type { AppUpdater } from 'electron-updater/out/AppUpdater';
import type { EngineEvent, UpdaterEngine } from './controller';
import { logTextOf } from './log-text';

type InstallingUpdater = AppUpdater & {
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

function ignore(): undefined {
  return undefined;
}

export function engineOf(
  updater: InstallingUpdater,
  log: (message: string) => void,
): UpdaterEngine {
  updater.logger = {
    info: (message?: unknown): void => {
      log(`updater: ${logTextOf(message)}`);
    },
    warn: (message?: unknown): void => {
      log(`updater: ${logTextOf(message)}`);
    },
    error: (message?: unknown): void => {
      log(`updater: ${logTextOf(message)}`);
    },
  };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.fullChangelog = false;
  return {
    setChannel: (channel): void => {
      updater.channel = channel;
      // The channel setter turns downgrades on; a switch from beta must not reinstall older code.
      updater.allowDowngrade = false;
    },
    check: (): Promise<void> => updater.checkForUpdates().then(ignore, ignore),
    download: (): Promise<void> => updater.downloadUpdate().then(ignore, ignore),
    installNow: (): boolean => {
      updater.quitAndInstall(true, true);
      return true;
    },
    setInstallOnQuit: (allowed): void => {
      updater.autoInstallOnAppQuit = allowed;
    },
    onEvent: (listener: (event: EngineEvent) => void): void => {
      updater.on('checking-for-update', () => {
        listener({ type: 'checking' });
      });
      updater.on('update-available', (info) => {
        listener({ type: 'available', info });
      });
      updater.on('update-not-available', () => {
        listener({ type: 'not-available' });
      });
      updater.on('download-progress', (progress) => {
        listener({ type: 'progress', percent: progress.percent });
      });
      updater.on('update-downloaded', (event) => {
        listener({ type: 'downloaded', info: event, file: event.downloadedFile });
      });
      updater.on('error', (error) => {
        listener({ type: 'error', error });
      });
    },
  };
}

// Imported lazily and from the NSIS file directly: the package entry pulls every platform
// updater into the bundle, and nothing of it is needed before the first check.
export async function loadNsisEngine(log: (message: string) => void): Promise<UpdaterEngine> {
  const { NsisUpdater } = await import('electron-updater/out/NsisUpdater');
  const updater = new NsisUpdater();
  updater.disableWebInstaller = true;
  return engineOf(updater, log);
}
