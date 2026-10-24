import type { ChildProcess } from 'node:child_process';
import { launch as launchMinecraft, type LaunchOption } from '@xmcl/core';
import {
  closeDownloadAgents,
  createTrackedRuntime,
  type TrackedRuntime,
  type TransferCounters,
} from './download';
import {
  countVerifiedFiles,
  installAssetIndex,
  installGameFiles,
  installVersionJson,
  readVersionLock,
  removeVersionLock,
  verifyInstallation,
  writeVersionLock,
} from './game-files';
import { GameLogWriter, readLogTail } from './game-log';
import {
  closeGracefully,
  killWithEscalation,
  watchGameProcess,
  type StopMode,
} from './game-process';
import { installJava } from './java';
import { prepareMacGlfw } from './mac-glfw';
import { prepareLoader, verifyWithLoaderRepair } from './loader-step';
import { DIRECT_NETWORK, type NetworkSetup } from './network';
import { createModFetch, type ModFetch } from './skins/mod-file';
import { findVersion } from './version-manifest';

export interface LaunchDependencies {
  findVersion: typeof findVersion;
  installVersionJson: typeof installVersionJson;
  installJava: typeof installJava;
  readVersionLock: typeof readVersionLock;
  writeVersionLock: typeof writeVersionLock;
  removeVersionLock: typeof removeVersionLock;
  installAssetIndex: typeof installAssetIndex;
  installGameFiles: typeof installGameFiles;
  prepareMacGlfw: typeof prepareMacGlfw;
  verifyInstallation: typeof verifyInstallation;
  countVerifiedFiles: typeof countVerifiedFiles;
  prepareLoader: typeof prepareLoader;
  verifyWithLoaderRepair: typeof verifyWithLoaderRepair;
  fetchSkinMod: ModFetch;
  createTransfer: (
    root: string,
    signal: AbortSignal,
    counters: TransferCounters,
    network: NetworkSetup,
  ) => TrackedRuntime;
  resolveNetwork: () => Promise<NetworkSetup>;
  openLog: (file: string) => Promise<GameLogWriter>;
  readLog: typeof readLogTail;
  launchGame: (options: LaunchOption) => Promise<ChildProcess>;
  watchGame: typeof watchGameProcess;
  killGame: (child: ChildProcess, mode: StopMode) => void;
  closeNetwork: () => Promise<void>;
}

export const defaultLaunchDependencies: LaunchDependencies = {
  findVersion,
  installVersionJson,
  installJava,
  readVersionLock,
  writeVersionLock,
  removeVersionLock,
  installAssetIndex,
  installGameFiles,
  prepareMacGlfw,
  verifyInstallation,
  countVerifiedFiles,
  prepareLoader,
  verifyWithLoaderRepair,
  fetchSkinMod: createModFetch((url, init) => fetch(url, init)),
  createTransfer: createTrackedRuntime,
  resolveNetwork: () => Promise.resolve(DIRECT_NETWORK),
  openLog: (file) => GameLogWriter.create(file),
  readLog: readLogTail,
  launchGame: launchMinecraft,
  watchGame: watchGameProcess,
  killGame: (child, mode) => {
    if (mode === 'close') {
      closeGracefully(child, { platform: process.platform });
    } else {
      killWithEscalation(child);
    }
  },
  closeNetwork: closeDownloadAgents,
};
