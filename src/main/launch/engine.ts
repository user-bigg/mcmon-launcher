import { MinecraftFolder } from '@xmcl/core';
import type { DeviceGpu, LaunchTelemetryEvent } from '@shared/telemetry';
import { defaultLaunchDependencies, type LaunchDependencies } from './dependencies';
import type { RegistryArchReader } from './game-arch';
import { GameInstaller } from './install';
import type { InstanceStore } from './instances';
import type { FetchJson } from './json-cache';
import type { GameLayout } from './layout';
import type { FetchText } from './loaders/sources';
import { GameSessions } from './session';

export interface EngineOptions {
  layout: GameLayout;
  platform: NodeJS.Platform;
  arch: string;
  registryArch?: RegistryArchReader | undefined;
  rosetta?: (() => boolean) | undefined;
  gpus?: (() => Promise<readonly DeviceGpu[]>) | undefined;
  totalMemoryBytes: number;
  fetch: FetchJson;
  fetchText?: FetchText | undefined;
  instances: InstanceStore;
  systemLanguages: () => readonly string[];
  overrides: Partial<LaunchDependencies>;
  now: () => number;
  report: (event: LaunchTelemetryEvent) => void;
}

export interface Engine {
  deps: LaunchDependencies;
  installer: GameInstaller;
  sessions: GameSessions;
}

export function createEngine(options: EngineOptions): Engine {
  const deps = { ...defaultLaunchDependencies, ...options.overrides };
  const installer = new GameInstaller({
    layout: options.layout,
    folder: MinecraftFolder.from(options.layout.root),
    platform: options.platform,
    arch: options.arch,
    registryArch: options.registryArch,
    rosetta: options.rosetta,
    gpus: options.gpus,
    fetch: options.fetch,
    fetchText: options.fetchText,
    instances: options.instances,
    deps,
    now: options.now,
    report: options.report,
  });
  const sessions = new GameSessions({
    layout: options.layout,
    platform: options.platform,
    totalMemoryBytes: options.totalMemoryBytes,
    deps,
    installer,
    systemLanguages: options.systemLanguages,
    now: options.now,
  });
  return { deps, installer, sessions };
}
