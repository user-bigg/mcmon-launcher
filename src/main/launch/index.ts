import { app, net, session, shell } from 'electron';
import { homedir, release, totalmem, userInfo } from 'node:os';
import { LAUNCHER_NAME } from '@shared/launch';
import type { GameWindow } from '@shared/settings';
import type { CrashUpload, TelemetrySink } from '@shared/telemetry';
import type { PlayerResolver } from './accounts';
import { gameRoot } from '../data-root';
import { withDeadline } from '../deadline';
import { gpuList } from '../device/profile';
import { registerCrashIpc } from './crash-ipc';
import { createCrashService, type GameCrashService } from './crash-service';

import type { RegistryArchReader } from './game-arch';
import { registerInstanceIpc } from './instance-ipc';
import { GameInstanceService } from './instance-service';
import { InstanceStore } from './instances';
import { LaunchOptionsStore } from './launch-options';
import { registerLaunchIpc } from './ipc';
import { createFetchJson } from './json-cache';
import { gameLayout } from './layout';
import { createFetchText } from './loaders/sources';
import { proxyFromPac, type NetworkSetup } from './network';
import type { PlayChecker } from './play-check';
import { createModFetch } from './skins/mod-file';
import type { SkinModSource } from './skins/variant';
import { createLaunchService, type CatalogModsSource, type GameLaunchService } from './service';

const DOWNLOAD_HOST = 'https://piston-data.mojang.com/';
const GPU_INFO_DEADLINE_MS = 3000;

const discardTelemetry: TelemetrySink = () => undefined;

// The first language of the system list is the one the player reads; the app locale is
// Chromium's nearest supported one and only stands in when the list is empty.
function systemLanguages(): readonly string[] {
  const preferred = app.getPreferredSystemLanguages();
  return preferred.length > 0 ? preferred : [app.getLocale()];
}

async function systemNetwork(): Promise<NetworkSetup> {
  const rule = await session.defaultSession.resolveProxy(DOWNLOAD_HOST);
  return { proxyUrl: proxyFromPac(rule) };
}

function systemUserName(): string | null {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
}

interface CrashServiceDeps {
  launch: GameLaunchService;
  root: string;
  totalMemoryBytes: number;
  devServerUrl: string | undefined;
  virtualMachine: (() => Promise<boolean | null>) | undefined;
  upload: ((report: CrashUpload) => void) | undefined;
}

function startCrashService(deps: CrashServiceDeps): GameCrashService {
  const service = createCrashService({
    root: deps.root,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    totalMemoryBytes: deps.totalMemoryBytes,
    launch: deps.launch,
    launcher: { name: LAUNCHER_NAME, version: app.getVersion() },
    userName: systemUserName(),
    homeDir: homedir(),
    openPath: (path) => shell.openPath(path),
    ...(deps.virtualMachine === undefined ? {} : { virtualMachine: deps.virtualMachine }),
    ...(deps.upload === undefined ? {} : { upload: deps.upload }),
  });
  registerCrashIpc(service, deps.devServerUrl);
  return service;
}

export interface LaunchServices {
  service: GameLaunchService;
  dispose: () => void;
}

export function startLaunchService(
  devServerUrl: string | undefined,
  telemetry: TelemetrySink = discardTelemetry,
  resolvePlayer?: PlayerResolver,
  playCheck?: PlayChecker,
  skinMod?: SkinModSource,
  registryArch?: RegistryArchReader,
  virtualMachine?: () => Promise<boolean | null>,
  gameWindow?: () => GameWindow,
  mods?: CatalogModsSource,
  launcherOnly?: (serverId: number) => boolean,
  crashUpload?: (report: CrashUpload) => void,
): LaunchServices {
  const totalMemoryBytes = totalmem();
  const layout = gameLayout(gameRoot());
  const instances = new InstanceStore({ layout, now: Date.now });
  const launchOptions = new LaunchOptionsStore(layout);
  const fetch = createFetchJson((url, init) => net.fetch(url, init));
  const fetchText = createFetchText((url, init) => net.fetch(url, init));
  const service = createLaunchService({
    root: layout.root,
    platform: process.platform,
    arch: process.arch,
    ...(registryArch === undefined ? {} : { registryArch }),
    gpus: () =>
      withDeadline(
        app.getGPUInfo('basic').then(gpuList, () => []),
        GPU_INFO_DEADLINE_MS,
        [],
      ),
    totalMemoryBytes,
    fetch,
    fetchText,
    instances,
    telemetry,
    ...(resolvePlayer === undefined ? {} : { resolvePlayer }),
    ...(playCheck === undefined ? {} : { playCheck }),
    ...(skinMod === undefined ? {} : { skinMod }),
    ...(mods === undefined ? {} : { mods }),
    ...(launcherOnly === undefined ? {} : { launcherOnly }),
    withoutMods: async (folderId) => (await launchOptions.get(folderId)).withoutMods,
    ...(gameWindow === undefined ? {} : { gameWindow }),
    systemLanguages,
    dependencies: {
      resolveNetwork: systemNetwork,
      fetchSkinMod: createModFetch((url, init) => net.fetch(url, init)),
    },
  });
  const instanceService = new GameInstanceService({
    store: instances,
    launchOptions,
    activeInstance: (): string | null => service.activeInstance(),
    checkingCrash: (): boolean => service.checkingCrash(),
  });
  registerLaunchIpc(service, devServerUrl, totalMemoryBytes);
  registerInstanceIpc(instanceService, devServerUrl);
  const crash = startCrashService({
    launch: service,
    root: layout.root,
    totalMemoryBytes,
    devServerUrl,
    virtualMachine,
    upload: crashUpload,
  });
  return {
    service,
    dispose: (): void => {
      crash.dispose();
      service.dispose();
    },
  };
}
