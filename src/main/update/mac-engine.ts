import { app } from 'electron';
import type { DownloadOptions } from 'builder-util-runtime';
import type { AppAdapter } from 'electron-updater/out/AppAdapter';
import type {
  DownloadExecutorResult,
  DownloadUpdateOptions,
} from 'electron-updater/out/AppUpdater';
import { BaseUpdater, type InstallOptions } from 'electron-updater/out/BaseUpdater';
import type { UpdaterEngine } from './controller';
import { engineOf } from './electron-engine';
import {
  appBundleOf,
  isPrepared,
  isWritable,
  macInstallBlocker,
  prepareBundle,
  stagingDirOf,
  startSwap,
  swapArguments,
  systemBundleCheck,
} from './mac-install';

const APP_ID = 'com.mcmonitor.launcher';

// The typings leave out httpExecutor, which the platform updaters of electron-updater use.
interface WithHttpExecutor {
  httpExecutor: { download: (url: URL, file: string, options: DownloadOptions) => Promise<string> };
}

// Squirrel.Mac, which electron-updater uses on macOS, refuses an application without a
// Developer ID signature. This updater downloads the zip the same way the Linux one downloads
// its AppImage, unpacks and checks the bundle once the update has passed our own checks, and
// swaps it in after the launcher has quit.
class MacZipUpdater extends BaseUpdater {
  private prepared: string | null = null;
  private preparedVersion = '';
  private relaunchOnQuit = false;
  private fallback: (() => void) | null = null;

  constructor(appAdapter?: AppAdapter) {
    super(null, appAdapter);
  }

  async prepare(archive: string, version: string): Promise<void> {
    const bundle = appBundleOf(process.execPath);
    if (bundle === null) {
      throw new Error('the launcher does not run from an application bundle');
    }
    this.prepared = null;
    this.prepared = await prepareBundle(archive, bundle, APP_ID, systemBundleCheck);
    this.preparedVersion = version;
  }

  protected doDownloadUpdate(options: DownloadUpdateOptions): Promise<DownloadExecutorResult> {
    const { provider, info } = options.updateInfoAndProvider;
    const fileInfo = provider
      .resolveFiles(info)
      .find((file) => file.url.pathname.toLowerCase().endsWith('.zip'));
    if (fileInfo === undefined) {
      return Promise.reject(new Error('the update has no zip'));
    }
    return this.executeDownload({
      fileExtension: 'zip',
      fileInfo,
      downloadUpdateOptions: options,
      task: async (updateFile, downloadOptions) => {
        const { httpExecutor } = this as unknown as WithHttpExecutor;
        await httpExecutor.download(fileInfo.url, updateFile, downloadOptions);
      },
    });
  }

  private readyBundle(): string | null {
    const bundle = appBundleOf(process.execPath);
    return bundle !== null &&
      macInstallBlocker(bundle, isWritable) === null &&
      isPrepared(this.prepared)
      ? bundle
      : null;
  }

  // Runs from electron-updater's own "quit" listener, so the swap starts only once the launcher
  // is really quitting.
  protected doInstall(options: InstallOptions): boolean {
    const bundle = this.readyBundle();
    if (bundle === null || !isPrepared(this.prepared)) {
      this.dispatchError(new Error('ERR_MAC_INSTALL the update is not ready to replace the app'));
      if (this.relaunchOnQuit) {
        app.relaunch();
      }
      return false;
    }
    startSwap(
      swapArguments(
        process.pid,
        bundle,
        this.prepared,
        stagingDirOf(bundle),
        options.isForceRunAfter || this.relaunchOnQuit,
        this.preparedVersion,
      ),
    );
    return true;
  }

  cancelRestart(): void {
    this.relaunchOnQuit = false;
    if (this.fallback !== null) {
      app.removeListener('quit', this.fallback);
    }
  }

  // The restart button only asks for a quit that relaunches; the swap itself waits for it.
  installAndQuit(): boolean {
    if (this.readyBundle() === null) {
      return false;
    }
    this.relaunchOnQuit = true;
    // electron-updater's own listener swaps first; this one covers a quit it chose to skip.
    this.fallback ??= (): void => {
      if (!this.quitAndInstallCalled) {
        this.install(true, true);
      }
    };
    app.once('quit', this.fallback);
    setImmediate(() => {
      app.quit();
    });
    return true;
  }
}

export function loadMacEngine(log: (message: string) => void): Promise<UpdaterEngine> {
  const updater = new MacZipUpdater();
  return Promise.resolve({
    ...engineOf(updater, log),
    prepare: (file: string, version: string): Promise<void> => updater.prepare(file, version),
    installNow: (): boolean => updater.installAndQuit(),
    cancelRestart: (): void => {
      updater.cancelRestart();
    },
  });
}
