import { mkdir } from 'node:fs/promises';
import type { MinecraftFolder, ResolvedVersion } from '@xmcl/core';
import { installedRuntimeOf, type InstanceRuntime } from '@shared/instance';
import type { LaunchStepId, LaunchTarget, PreparedGame } from '@shared/launch';
import { serverJoinMode } from '@shared/minecraft-version';
import { modsLoaderMin, type ModsPlan } from '@shared/mods';
import type { ClientModStatus, SkinsStatus } from '@shared/skin-mod';
import type { DeviceGpu, LaunchTelemetryEvent } from '@shared/telemetry';
import type { LaunchDependencies } from './dependencies';
import type { TrackedRuntime } from './download';
import { failure, toLaunchError } from './errors';
import { needsMacGlfw } from './mac-glfw';
import { checkGpuSupport, needsCoreProfile } from './gpu-support';
import { gameArch, readMachineArch, rosettaInstalled, type RegistryArchReader } from './game-arch';
import { withFolderOverrides } from './instance-overrides';
import type { InstanceStore } from './instances';
import { javaRequirement, type installJava, type JavaRequirement } from './java';
import type { FetchJson } from './json-cache';
import {
  instanceDir,
  javaPlace,
  javaRuntimeIndexCache,
  versionLockFile,
  versionManifestCache,
  type GameLayout,
  type JavaPlace,
} from './layout';
import { javaOverrideRequirement, serverLaunchProfile, type LaunchProfile } from './launch-profile';
import type { LoaderStepOptions, PreparedLoader } from './loader-step';
import { fetchText, type FetchText } from './loaders/sources';
import {
  fabricCatalog,
  lose,
  loseAll,
  obtainCatalogMods,
  placeRunShaders,
  planCatalogMods,
  type CatalogRun,
  type ModsRequest,
} from './mods/run';
import { DIRECT_NETWORK, type NetworkSetup } from './network';
import type { Operation } from './operation';
import {
  canPlayWithoutSkins,
  placedRuntime,
  placeSkinFiles,
  planSkins,
  type SkinsPlan,
  type SkinsRequest,
} from './skins/variant';
import type { ClientModRun } from './skins/client-mod-blocks';
import type { VersionEntry, VersionManifestSource } from './version-manifest';

export interface InstallerOptions {
  layout: GameLayout;
  folder: MinecraftFolder;
  platform: NodeJS.Platform;
  arch: string;
  registryArch?: RegistryArchReader | undefined;
  rosetta?: (() => boolean) | undefined;
  gpus?: (() => Promise<readonly DeviceGpu[]>) | undefined;
  fetch: FetchJson;
  fetchText?: FetchText | undefined;
  instances: InstanceStore;
  deps: LaunchDependencies;
  now: () => number;
  report: (event: LaunchTelemetryEvent) => void;
  log?: (message: string) => void;
}

export interface Installed {
  version: ResolvedVersion;
  entry: VersionEntry;
  profile: LaunchProfile;
  runtime: InstanceRuntime;
  skins: SkinsStatus | null;
  clientMod: ClientModStatus | null;
  clientModRun: ClientModRun | null;
  mods: ModsPlan | null;
  modsDir: string | null;
  glfwLibrary: string | null;
  java: JavaRequirement;
  javaPath: string;
  lockFile: string;
  prepared: PreparedGame;
}

export interface InstallRequest {
  target: LaunchTarget;
  joinServer: boolean;
  skins?: SkinsRequest;
  mods?: ModsRequest;
}

interface CatalogHolder {
  run: CatalogRun | null;
}

interface GameMachine {
  machineArch: string;
  version: ResolvedVersion;
  minecraft: string;
}

interface LoaderOutcome {
  loader: PreparedLoader | null;
  runtime: InstanceRuntime;
  modsDir: string | null;
}

export class GameInstaller {
  constructor(private readonly options: InstallerOptions) {}

  async install(request: InstallRequest, operation: Operation): Promise<Installed> {
    const startedAt = this.options.now();
    const profile = await withFolderOverrides(serverLaunchProfile(request.target), (folderId) =>
      instanceDir(this.options.layout, folderId),
    );
    try {
      await this.checkGpu(profile.runtime.minecraft);
      const installed = await this.installSteps(
        profile,
        {
          joinsServer: request.joinServer,
          skins: request.skins ?? null,
          mods: request.mods ?? null,
        },
        operation,
        startedAt,
      );
      operation.signal.throwIfAborted();
      await this.recordServerInstall(request.target.serverId, profile);
      this.reportInstall(profile, operation, startedAt, null);
      return installed;
    } catch (error) {
      const code = toLaunchError(error).code;
      if (!operation.signal.aborted && code !== 'cancelled') {
        this.reportInstall(profile, operation, startedAt, code);
      }
      throw error;
    }
  }

  private async recordServerInstall(serverId: number, profile: LaunchProfile): Promise<void> {
    const runtime = installedRuntimeOf(profile.runtime);
    if (!(await this.options.instances.recordServerInstall(serverId, runtime))) {
      (this.options.log ?? console.warn)(`launch: server-${String(serverId)} record not saved`);
    }
  }

  tracked(operation: Operation, step: LaunchStepId): TrackedRuntime {
    return operation.attach(step, () =>
      this.options.deps.createTransfer(
        this.options.layout.root,
        operation.signal,
        operation.counters(step),
        operation.network,
      ),
    );
  }

  // Before start @xmcl/core verifies the full sha1 of the client and libraries, while our
  // check trusts mtime: a file corrupted without a timestamp change is only caught here.
  async repairBeforeLaunch(installed: Installed, operation: Operation): Promise<void> {
    const { deps, folder, now } = this.options;
    const verifiedAt = now();
    await deps.removeVersionLock(installed.lockFile).catch(() => undefined);
    await deps.verifyInstallation(
      installed.version,
      folder,
      this.tracked(operation, 'launch'),
      undefined,
      operation.signal,
    );
    await deps.writeVersionLock(installed.lockFile, installed.version.id, verifiedAt);
    operation.signal.throwIfAborted();
  }

  private startStep(operation: Operation, step: LaunchStepId): TrackedRuntime {
    operation.start(step);
    return this.tracked(operation, step);
  }

  private async resolveNetwork(): Promise<NetworkSetup> {
    try {
      return await this.options.deps.resolveNetwork();
    } catch {
      return DIRECT_NETWORK;
    }
  }

  private manifestSource(signal: AbortSignal): VersionManifestSource {
    return {
      cacheFile: versionManifestCache(this.options.layout),
      fetch: this.options.fetch,
      signal,
      now: this.options.now(),
    };
  }

  // The cached manifest may be stale: Mojang reissues version.json with a new sha1, and the
  // old entry yields a hash mismatch. In that case fetch a fresh manifest and try again.
  private async resolveVersion(
    minecraft: string,
    operation: Operation,
    transfer: TrackedRuntime,
  ): Promise<{ version: ResolvedVersion; entry: VersionEntry }> {
    const { deps, folder } = this.options;
    const signal = operation.signal;
    const entry = await deps.findVersion(minecraft, this.manifestSource(signal));
    try {
      return { version: await deps.installVersionJson(folder, entry, transfer), entry };
    } catch (error) {
      signal.throwIfAborted();
      const fresh = await deps
        .findVersion(minecraft, this.manifestSource(signal), { refresh: true })
        .catch(() => null);
      if (fresh === null || (fresh.sha1 === entry.sha1 && fresh.url === entry.url)) {
        throw error;
      }
      return { version: await deps.installVersionJson(folder, fresh, transfer), entry: fresh };
    }
  }

  private machineArch(): Promise<string> {
    const { platform, arch, registryArch } = this.options;
    return readMachineArch(platform, arch, registryArch);
  }

  private async checkGpu(minecraft: string): Promise<void> {
    const { platform, gpus } = this.options;
    if (platform !== 'win32' || gpus === undefined || !needsCoreProfile(minecraft)) {
      return;
    }
    checkGpuSupport(minecraft, platform, await gpus().catch(() => []));
  }

  private rosettaReady(): boolean {
    return (this.options.rosetta ?? rosettaInstalled)();
  }

  private javaOptions(
    requirement: JavaRequirement,
    game: GameMachine,
    signal: AbortSignal,
    transfer: TrackedRuntime,
  ): Parameters<typeof installJava>[0] {
    const { layout, platform, arch: processArch, fetch, now } = this.options;
    return {
      requirement,
      platform,
      place: (javaIndex): JavaPlace | null => {
        const arch = gameArch({
          platform,
          processArch,
          machineArch: game.machineArch,
          version: game.version,
          javaIndex,
          component: requirement.component,
        });
        if (arch !== processArch) {
          this.log(`launch: Java ${requirement.component} for ${arch}`);
        }
        if (platform === 'darwin' && arch !== processArch && !this.rosettaReady()) {
          throw failure({ code: 'rosetta-missing', minecraft: game.minecraft });
        }
        return javaPlace(layout, { platform, processArch, arch }, requirement.component);
      },
      indexCache: javaRuntimeIndexCache(layout),
      fetch,
      signal,
      now: now(),
      transfer,
    };
  }

  private async installSteps(
    profile: LaunchProfile,
    {
      joinsServer,
      skins,
      mods,
    }: { joinsServer: boolean; skins: SkinsRequest | null; mods: ModsRequest | null },
    operation: Operation,
    startedAt: number,
  ): Promise<Installed> {
    const { deps, layout, folder } = this.options;
    const signal = operation.signal;
    await mkdir(layout.root, { recursive: true });
    const machine = this.machineArch();
    operation.network = await this.resolveNetwork();
    signal.throwIfAborted();

    const { version: base, entry } = await this.resolveVersion(
      profile.runtime.minecraft,
      operation,
      this.tracked(operation, 'files'),
    );
    if (joinsServer && serverJoinMode({ id: entry.id, releaseTime: entry.releaseTime }) === null) {
      throw failure({ code: 'join-unsupported', minecraft: entry.id });
    }

    const modsPlanned = await planCatalogMods(mods, profile, operation);
    const javaTransfer = this.startStep(operation, 'java');
    const java = javaOverrideRequirement(profile.javaOverride) ?? javaRequirement(base);
    const game: GameMachine = { machineArch: await machine, version: base, minecraft: entry.id };
    signal.throwIfAborted();
    const javaPath = await deps.installJava(this.javaOptions(java, game, signal, javaTransfer));
    operation.end('java');

    const lockFile = versionLockFile(layout, base.id);
    const validatedAt = await deps.readVersionLock(lockFile, base.id);
    await deps.installAssetIndex(base, folder, this.tracked(operation, 'files'), validatedAt);
    const filesTransfer = this.startStep(operation, 'files');
    await deps.installGameFiles(base, folder, filesTransfer, validatedAt);
    const glfwLibrary = needsMacGlfw(base, this.options.platform)
      ? await deps.prepareMacGlfw(layout, filesTransfer)
      : null;
    operation.end('files');

    const catalog: CatalogHolder = {
      run: await obtainCatalogMods(modsPlanned, {
        layout,
        fetch: deps.fetchSkinMod,
        operation,
        log: this.log,
      }),
    };
    const planned = await planSkins(skins, profile.runtime, fabricCatalog(catalog.run, layout));
    signal.throwIfAborted();
    if (planned.plan === null && catalog.run !== null) {
      catalog.run = lose(catalog.run, this.fabricSlugs(catalog.run), operation);
    }
    operation.clientMod = planned.clientMod;
    if (planned.blocked !== undefined) {
      const { minecraft, sha256 } = planned.blocked;
      this.log(`client mod: left out, it crashed ${minecraft} at start (sha256 ${sha256})`);
    }
    operation.setSkins(planned.status);
    const loaderOptions = (runtime: InstanceRuntime): LoaderStepOptions =>
      this.loaderOptions(runtime, signal);
    let outcome =
      planned.plan === null
        ? this.withoutLoader(profile, operation)
        : await this.skinsLoader(profile, planned.plan, loaderOptions, operation, catalog);
    await this.placeShaders(catalog, profile, outcome.modsDir !== null, operation);

    const verifyStartedAt = this.options.now();
    const verifyTransfer = this.startStep(operation, 'verify');
    const verifyBase = async (): Promise<ResolvedVersion> => {
      operation.progress.planFiles(
        'verify',
        await deps.countVerifiedFiles(base, folder).catch(() => 0),
      );
      await deps.verifyInstallation(base, folder, verifyTransfer, validatedAt, signal, () => {
        operation.progress.fileDone('verify');
      });
      return base;
    };
    const verifyLoader = async (loader: PreparedLoader): Promise<ResolvedVersion> => {
      const verified = await deps.verifyWithLoaderRepair(
        loaderOptions(outcome.runtime),
        loader,
        { version: base, validatedAt },
        verifyTransfer,
      );
      await deps.writeVersionLock(loader.lockFile, verified.id, verifyStartedAt);
      return verified;
    };
    let version: ResolvedVersion;
    if (outcome.loader === null || planned.plan === null) {
      version = await verifyBase();
    } else {
      try {
        version = await verifyLoader(outcome.loader);
      } catch (error) {
        if (!canPlayWithoutSkins(error, signal)) {
          throw error;
        }
        this.modsUnavailable(operation, planned.plan, error, catalog);
        outcome = { loader: null, runtime: profile.runtime, modsDir: null };
        version = await verifyBase();
      }
    }
    await deps.writeVersionLock(lockFile, base.id, verifyStartedAt);
    operation.end('verify');
    const placedLine = operation.clientMod === 'on' ? (planned.plan?.clientMod ?? null) : null;
    const ranClientMod =
      placedLine === null
        ? null
        : { minecraft: profile.runtime.minecraft, sha256: placedLine.mod.sha256 };

    return {
      version,
      entry,
      profile,
      runtime: outcome.runtime,
      skins: operation.skins,
      clientMod: operation.clientMod,
      clientModRun: ranClientMod,
      mods: catalog.run?.plan ?? null,
      modsDir: outcome.modsDir,
      glfwLibrary,
      java,
      javaPath,
      lockFile,
      prepared: {
        instance: profile.folderId,
        minecraft: base.id,
        loader: outcome.runtime.loader,
        versionId: version.id,
        javaMajor: java.major,
        bytesDownloaded: operation.progress.snapshot().bytesDone,
        durationMs: this.options.now() - startedAt,
      },
    };
  }

  private withoutLoader(profile: LaunchProfile, operation: Operation): LoaderOutcome {
    operation.progress.skip('loader');
    return { loader: null, runtime: profile.runtime, modsDir: null };
  }

  // The mods come first: without them there is no reason to install the loader at all.
  private async skinsLoader(
    profile: LaunchProfile,
    planned: SkinsPlan,
    loaderOptions: (runtime: InstanceRuntime) => LoaderStepOptions,
    operation: Operation,
    catalog: CatalogHolder,
  ): Promise<LoaderOutcome> {
    let plan = planned;
    const { deps, layout } = this.options;
    const signal = operation.signal;
    const plain: LoaderOutcome = { loader: null, runtime: profile.runtime, modsDir: null };
    const transfer = this.startStep(operation, 'loader');
    if (plan.clientMod !== null) {
      const { minecraft_from: from, minecraft_to: to } = plan.clientMod;
      this.log(
        `client mod: line ${from}..${to ?? 'open'}, Fabric Loader ${plan.runtime.loaderVersion ?? ''}`,
      );
    }
    const place = (next: SkinsPlan): ReturnType<typeof placeSkinFiles> =>
      placeSkinFiles({
        layout,
        instance: instanceDir(layout, profile.folderId),
        plan: next,
        fetch: deps.fetchSkinMod,
        signal,
        log: this.log,
      });
    let placed = await place(plan);
    const lost = this.lostCatalogMods(plan, placed);
    if (catalog.run !== null && lost.size > 0) {
      catalog.run = lose(catalog.run, lost, operation);
      plan = { ...plan, catalog: fabricCatalog(catalog.run, layout)?.mods ?? [] };
      placed = await place(plan);
    }
    if (placed === null) {
      this.modsUnavailable(operation, plan, null, catalog);
      operation.drop('loader');
      return plain;
    }
    if (plan.skins !== null && !placed.roles.has('skins')) {
      operation.setSkins('unavailable');
    }
    if (plan.clientMod !== null && !placed.roles.has('client')) {
      this.log('client mod: not installed');
      operation.clientMod = 'unavailable';
    }
    try {
      const runtime = placedRuntime(
        plan,
        placed.roles,
        catalog.run === null ? null : modsLoaderMin(catalog.run.plan),
      );
      const loader = await deps.prepareLoader(loaderOptions(runtime), transfer);
      operation.end('loader');
      return { loader, runtime, modsDir: placed.modsDir };
    } catch (error) {
      if (!canPlayWithoutSkins(error, signal)) {
        throw error;
      }
      this.modsUnavailable(operation, plan, error, catalog);
      operation.drop('loader');
      return plain;
    }
  }

  private lostCatalogMods(
    plan: SkinsPlan,
    placed: { slugs: ReadonlySet<string> } | null,
  ): Set<string> {
    return new Set(
      plan.catalog.flatMap((mod) =>
        mod.slug === undefined || placed?.slugs.has(mod.slug) === true ? [] : [mod.slug],
      ),
    );
  }

  private fabricSlugs(run: CatalogRun): Set<string> {
    return new Set(run.plan.installs.map(({ mod }) => mod.slug));
  }

  // A shader pack that cannot be laid out costs only the shaders: the mods are already in place.
  private async placeShaders(
    catalog: CatalogHolder,
    profile: LaunchProfile,
    withFabric: boolean,
    operation: Operation,
  ): Promise<void> {
    const run = catalog.run;
    if (run === null) {
      return;
    }
    const instance = instanceDir(this.options.layout, profile.folderId);
    try {
      await placeRunShaders(run, this.options.layout, instance, withFabric, this.log);
    } catch (error) {
      operation.signal.throwIfAborted();
      this.log(`mods: shader pack not laid out: ${String(error)}`);
      const pack = run.plan.shaderPack;
      catalog.run = pack === null ? run : lose(run, new Set([pack]), operation);
      await placeRunShaders(catalog.run, this.options.layout, instance, false, this.log).catch(
        () => undefined,
      );
    }
  }

  private modsUnavailable(
    operation: Operation,
    plan: SkinsPlan,
    error: unknown,
    catalog: CatalogHolder,
  ): void {
    if (catalog.run !== null) {
      catalog.run = loseAll(catalog.run, operation);
    }
    if (error !== null) {
      this.log(`skins: loader not installed: ${toLaunchError(error).code}`);
    }
    if (plan.clientMod !== null) {
      this.log('client mod: not installed');
      operation.clientMod = 'unavailable';
    }
    if (plan.skins !== null) {
      operation.setSkins('unavailable');
    }
  }

  private get log(): (message: string) => void {
    return this.options.log ?? console.warn;
  }

  private loaderOptions(runtime: InstanceRuntime, signal: AbortSignal): LoaderStepOptions {
    const { layout, folder } = this.options;
    return { layout, folder, runtime, fetch: this.options.fetchText ?? fetchText, signal };
  }

  // The site API has no field for skins yet, so loader stays what the catalog chose: Fabric
  // that the launcher adds for its own mods is not the server's choice of a loader.
  private reportInstall(
    profile: LaunchProfile,
    operation: Operation,
    startedAt: number,
    errorCode: string | null,
  ): void {
    const { now, report } = this.options;
    const bytes = operation.progress.snapshot().bytesDone;
    if (errorCode === null && bytes === 0) {
      return;
    }
    report({
      type: 'install.finished',
      at: new Date(now()).toISOString(),
      minecraft: profile.runtime.minecraft,
      loader: profile.runtime.loader,
      outcome: errorCode === null ? 'ok' : 'error',
      error_code: errorCode,
      duration_s: Math.round((now() - startedAt) / 1000),
      bytes,
    });
  }
}
