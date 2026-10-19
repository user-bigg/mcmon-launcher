import { app, net } from 'electron';
import { rm } from 'node:fs/promises';
import type { LaunchEvent, LaunchPhase } from '@shared/launch';
import { UPDATE_BASE_URL } from '@shared/update';
import { UPDATE_PUBLIC_KEY } from '@shared/update-key';
import type { LauncherSettingsStore } from '../settings';
import {
  UpdateController,
  type SignatureFetch,
  type UpdatePreferences,
  type UpdaterEngine,
} from './controller';
import { loadNsisEngine } from './electron-engine';
import { registerUpdateIpc } from './ipc';
import { appBundleOf, isWritable, macInstallBlocker, removeLeftovers } from './mac-install';
import { sha512File } from './signature';
import { signatureFromResponse } from './signature-response';

declare const __LAUNCHER_BUILT_AT__: string | undefined;

const SIGNATURE_TIMEOUT_MS = 15_000;

export interface UpdateRuntime {
  controller: UpdateController;
  dispose: () => void;
}

export interface UpdateDeps {
  devServerUrl: string | undefined;
  settings: LauncherSettingsStore;
  launch: { onEvent: (listener: (event: LaunchEvent) => void) => () => void };
  checks: boolean;
  background: () => boolean;
  beforeInstall: () => void;
}

function log(message: string): void {
  console.warn(message);
}

function builtAt(): string | null {
  return typeof __LAUNCHER_BUILT_AT__ === 'string' ? __LAUNCHER_BUILT_AT__ : null;
}

function timer(run: () => void, ms: number): () => void {
  const handle = setTimeout(run, ms);
  handle.unref();
  return () => {
    clearTimeout(handle);
  };
}

export async function fetchSignature(url: string): Promise<SignatureFetch> {
  try {
    const response = await net.fetch(url, {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(SIGNATURE_TIMEOUT_MS),
    });
    return await signatureFromResponse(response);
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

function macBlocker(): 'move' | 'readonly' | null {
  return macInstallBlocker(appBundleOf(process.execPath), isWritable);
}

// The macOS updater is imported only on macOS, the NSIS one only on Windows.
async function loadPlatformEngine(): Promise<UpdaterEngine> {
  if (process.platform === 'darwin') {
    const { loadMacEngine } = await import('./mac-engine');
    return loadMacEngine(log);
  }
  return loadNsisEngine(log);
}

function preferencesOf(settings: LauncherSettingsStore): UpdatePreferences {
  const { channel, autoDownload } = settings.settings;
  return { channel, autoDownload };
}

export function startUpdates(deps: UpdateDeps): UpdateRuntime {
  let phase: LaunchPhase = 'idle';
  const controller = new UpdateController({
    enabled:
      deps.checks &&
      app.isPackaged &&
      (process.platform === 'win32' || (process.platform === 'darwin' && process.arch === 'arm64')),
    currentVersion: app.getVersion(),
    builtAt: builtAt(),
    platform: { os: process.platform, arch: process.arch },
    base: UPDATE_BASE_URL,
    installerExtension: process.platform === 'darwin' ? 'zip' : 'exe',
    ...(process.platform === 'darwin' ? { installBlocker: macBlocker } : {}),
    publicKey: UPDATE_PUBLIC_KEY,
    loadEngine: async (): Promise<UpdaterEngine> => {
      const engine = await loadPlatformEngine();
      return {
        ...engine,
        installNow: (): boolean => {
          const started = engine.installNow();
          if (started) {
            deps.beforeInstall();
          }
          return started;
        },
      };
    },
    preferences: (): UpdatePreferences => preferencesOf(deps.settings),
    skipped: {
      list: (): string[] => deps.settings.skippedUpdates,
      save: (versions): Promise<void> => deps.settings.saveSkippedUpdates(versions),
    },
    launchPhase: (): LaunchPhase => phase,
    background: deps.background,
    fetchSignature,
    hashFile: sha512File,
    removeFile: (path): Promise<void> => rm(path, { force: true }),
    isOnline: (): boolean => net.isOnline(),
    now: Date.now,
    setTimer: timer,
    log,
  });
  const stopLaunch = deps.launch.onEvent((event) => {
    if (event.kind === 'phase' && event.phase !== phase) {
      phase = event.phase;
      controller.onLaunchPhase(phase);
    }
  });
  const stopSettings = deps.settings.onChange((previous) => {
    controller.onPreferencesChanged({
      channel: previous.channel,
      autoDownload: previous.autoDownload,
    });
  });
  // Registered at startup, before electron-updater adds its own "quit" listener after a download.
  app.on('quit', () => {
    controller.prepareQuit();
  });
  registerUpdateIpc(controller, deps.devServerUrl);
  const bundle = process.platform === 'darwin' ? appBundleOf(process.execPath) : null;
  if (app.isPackaged && bundle !== null) {
    void removeLeftovers(bundle, app.getVersion()).then(
      (failed) => {
        if (failed !== null) {
          log(`update: ${failed} could not replace the app after the last quit`);
          controller.rememberFailedInstall(failed);
        }
      },
      (error: unknown) => {
        log(`update: leftovers of an earlier update stay ${String(error)}`);
      },
    );
  }
  controller.start();
  return {
    controller,
    dispose: (): void => {
      controller.dispose();
      stopLaunch();
      stopSettings();
    },
  };
}
