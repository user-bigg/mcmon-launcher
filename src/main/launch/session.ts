import type { ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { LaunchOption } from '@xmcl/core';
import { GAME_RESOLUTION, type LaunchError } from '@shared/launch';
import { defaultMemoryMb, maxMemoryMb } from '@shared/memory';
import { legacyJoinSkipsSrv, serverJoinMode } from '@shared/minecraft-version';
import { DEFAULT_SERVER_PORT, gameListAddress, type ServerAddress } from '@shared/server-address';
import type { GameWindow } from '@shared/settings';
import type { GamePlayer } from './accounts';
import type { LaunchDependencies } from './dependencies';
import { failure, toLaunchError } from './errors';
import { bestEffort } from './fs-retry';
import { isPrecheckFailure } from './game-files';
import { clearGameMark, isGameRunningIn, markGameStarted } from './game-mark';
import { installedLanguage } from './game-language';
import { addMissingOptions, firstRunOptions } from './game-options';
import {
  argFileSpawn,
  gameLaunchOptions,
  type GameExit,
  type GameLaunchInput,
  type StopMode,
} from './game-process';
import type { GameInstaller, Installed } from './install';
import { crashReportsDir, gameLogFile, instanceDir, type GameLayout } from './layout';
import type { LaunchProfile } from './launch-profile';
import { clearPlayCode, writePlayCode } from './play-code';
import { safely, type RunningGame } from './running';
import { scrubLaunchError } from './secrets';
import { listServerInGame, serverListName } from './server-list';
import type { Operation } from './operation';

const SPAWN_ERROR_TIMEOUT_MS = 5000;

export interface SpawnRequest {
  installed: Installed;
  player: GamePlayer;
  serverId: number;
  address: ServerAddress;
  playCode?: string | null;
  name: string | null;
  memoryMb: number | undefined;
  window?: GameWindow | undefined;
  operation: Operation;
  release: () => void;
}

export interface SessionHooks {
  output: () => void;
  windowReady: (running: RunningGame) => void;
  windowFailed: (running: RunningGame) => void;
  connecting: (running: RunningGame, target: { host: string; port: number }) => void;
  failed: (error: LaunchError) => void;
  exited: (running: RunningGame, exit: GameExit) => void;
}

export interface SessionOptions {
  layout: GameLayout;
  platform: NodeJS.Platform;
  totalMemoryBytes: number;
  deps: LaunchDependencies;
  installer: GameInstaller;
  systemLanguages: () => readonly string[];
  now: () => number;
}

export function windowChoice(
  chosen: GameWindow | undefined,
): Pick<GameLaunchInput, 'resolution' | 'fullscreen'> {
  if (chosen === undefined) {
    return { resolution: GAME_RESOLUTION };
  }
  const sized = chosen.width > 0 && chosen.height > 0;
  return {
    resolution: sized ? { width: chosen.width, height: chosen.height } : GAME_RESOLUTION,
    fullscreen: chosen.fullscreen,
  };
}

function spawnFailure(error: unknown): LaunchError {
  const launchError = toLaunchError(error);
  if (launchError.code === 'permission-denied' || launchError.code === 'cancelled') {
    return launchError;
  }
  if (launchError.code === 'unknown' || launchError.code === 'game-start-failed') {
    return { code: 'game-start-failed', message: launchError.message };
  }
  const text = error instanceof Error ? error.message.split('\n')[0] : undefined;
  return { code: 'game-start-failed', message: text ?? launchError.code };
}

// --server in 1.6–1.16 connects to the host directly and does not read the _minecraft._tcp SRV
// record. The launcher does not look it up either; a port the server owner did not enter is
// the standard one there. Elsewhere no port goes to the game.
export function joinAddress(
  installed: Pick<Installed, 'entry'>,
  address: ServerAddress | null,
): ServerAddress | null {
  const moment = { id: installed.entry.id, releaseTime: installed.entry.releaseTime };
  if (address?.port !== null || !legacyJoinSkipsSrv(moment)) {
    return address;
  }
  return { host: address.host, port: DEFAULT_SERVER_PORT };
}

export class GameSessions {
  constructor(private readonly options: SessionOptions) {}

  async spawn(request: SpawnRequest): Promise<RunningGame> {
    const { installed, operation } = request;
    const { version, entry, profile, runtime } = installed;
    const signal = operation.signal;
    const instance = instanceDir(this.options.layout, profile.folderId);
    await mkdir(instance, { recursive: true });
    // From here the address goes into the command line: a later switch is for the next launch.
    operation.joinFixed = true;
    const server = operation.joinServer ? request.address : null;
    const mode =
      server === null ? null : serverJoinMode({ id: entry.id, releaseTime: entry.releaseTime });
    // The choice may have been switched on after the installer checked it.
    if (server !== null && mode === null) {
      throw failure({ code: 'join-unsupported', minecraft: entry.id });
    }
    const target = joinAddress(installed, server);
    signal.throwIfAborted();
    const memoryMb = request.memoryMb ?? this.memoryFor(profile);
    const log = await this.options.deps.openLog(gameLogFile(instance));
    const secrets = request.player.auth === null ? [] : [request.player.auth.accessToken];
    for (const secret of [...secrets, ...(request.playCode ? [request.playCode] : [])]) {
      log.hide(secret);
    }
    try {
      log.note(
        `minecraft=${entry.id} version=${version.id} loader=${runtime.loader} skins=${installed.skins ?? 'none'} java=${installed.javaPath} memory=${String(memoryMb)}MB join=${mode ?? 'none'}`,
      );
      if (!(await bestEffort(() => this.prepareOptions(instance, version.assets)))) {
        log.note('options.txt: first run options not written');
      }
      log.note(`servers.dat: ${await this.listServer(request, instance)}`);
      log.note(`play code: ${await this.preparePlayCode(request, instance)}`);
      signal.throwIfAborted();
      const options = gameLaunchOptions({
        version,
        gamePath: instance,
        resourcePath: this.options.layout.root,
        javaPath: installed.javaPath,
        nick: request.player.nick,
        auth: request.player.auth,
        memoryMb,
        ...windowChoice(request.window),
        mode,
        address: target,
        modsDir: installed.modsDir,
        glfwLibrary: installed.glfwLibrary,
        minecraft: entry.id,
      });
      options.spawn = argFileSpawn({
        dir: instance,
        javaMajor: installed.java.major,
        mainClass: version.mainClass,
        platform: this.options.platform,
      });
      const child = await this.startGame(options, installed, operation);
      const pid = await this.ensureSpawned(child);
      if (signal.aborted) {
        this.abandon(child);
        throw failure({ code: 'cancelled' });
      }
      const startedAt = this.options.now();
      await bestEffort(() => markGameStarted(instance, pid, Date.now()));
      return {
        child,
        session: {
          pid,
          instance: profile.folderId,
          nick: request.player.nick,
          minecraft: entry.id,
          loader: runtime.loader,
          memoryMb,
          join: mode === null || server === null ? null : { mode, address: server },
          skins: installed.skins,
          startedAt: new Date(startedAt).toISOString(),
        },
        serverId: request.serverId,
        instanceDir: instance,
        log,
        progress: operation.progress,
        startedAt,
        windowReadyAt: null,
        windowFailed: false,
        windowSlow: false,
        windowDialog: false,
        killedByUser: false,
        release: request.release,
      };
    } catch (error) {
      await bestEffort(() => clearPlayCode(instance));
      await log.close();
      throw secrets.length === 0 || signal.aborted
        ? error
        : failure(scrubLaunchError(toLaunchError(error), secrets));
    }
  }

  watch(running: RunningGame, hooks: SessionHooks): void {
    this.options.deps.watchGame(
      running.child,
      {
        log: running.log,
        crashReportsDir: crashReportsDir(running.instanceDir),
        startedAt: running.startedAt,
        instanceDir: running.instanceDir,
      },
      {
        onOutput: () => {
          safely(hooks.output);
        },
        onWindowReady: () => {
          safely(() => {
            hooks.windowReady(running);
          });
        },
        onWindowFailed: () => {
          safely(() => {
            hooks.windowFailed(running);
          });
        },
        onConnecting: (target) => {
          safely(() => {
            hooks.connecting(running, target);
          });
        },
        onError: (error) => {
          safely(() => {
            hooks.failed(toLaunchError(error));
          });
        },
        onExit: (exit) => {
          void bestEffort(() => clearGameMark(running.instanceDir));
          // The instance is freed only after the code is gone, so a removal that is late cannot
          // take the code of the next launch on the same server.
          void bestEffort(() => clearPlayCode(running.instanceDir)).then(() => {
            hooks.exited(running, exit);
          });
        },
      },
    );
  }

  stop(running: RunningGame, mode: StopMode): void {
    running.killedByUser = true;
    safely(() => {
      this.options.deps.killGame(running.child, mode);
    });
  }

  // Not the player's doing: the exit that follows is reported as a crash.
  terminate(running: RunningGame): void {
    safely(() => {
      this.options.deps.killGame(running.child, 'force');
    });
  }

  abandon(child: ChildProcess): void {
    child.on('error', () => undefined);
    safely(() => {
      this.options.deps.killGame(child, 'force');
    });
  }

  private async prepareOptions(instance: string, assetIndex: string): Promise<void> {
    const language = await installedLanguage(
      this.options.layout.assets,
      assetIndex,
      this.options.systemLanguages(),
    );
    await addMissingOptions(instance, firstRunOptions(language));
  }

  // The address is the one in the game's server list and in Quick Play: without a port the mod
  // matches the host alone, so the standard port --server adds on old versions still matches.
  // The log tells only whether the file was written.
  private async preparePlayCode(request: SpawnRequest, instance: string): Promise<string> {
    const { serverId, playCode, address } = request;
    if (playCode === undefined || playCode === null) {
      return (await bestEffort(() => clearPlayCode(instance))) ? 'none' : 'stale file left';
    }
    const play = { serverId, nick: request.player.nick, code: playCode, address };
    return (await bestEffort(() => writePlayCode(instance, play))) ? 'written' : 'not written';
  }

  // Independent of joining at once: thrown back to the title screen, the player finds the
  // server in the game's own list.
  private async listServer(request: SpawnRequest, instance: string): Promise<string> {
    const { address } = request;
    try {
      return await listServerInGame({
        instance,
        server: { name: serverListName(request.name, gameListAddress(address)), address },
        gameRunning: await isGameRunningIn(instance),
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      return `not written (${typeof code === 'string' ? code : 'error'})`;
    }
  }

  private memoryFor(profile: LaunchProfile): number {
    const total = this.options.totalMemoryBytes;
    return profile.memoryMb === null
      ? defaultMemoryMb(total)
      : Math.min(profile.memoryMb, maxMemoryMb(total));
  }

  private async startGame(
    options: LaunchOption,
    installed: Installed,
    operation: Operation,
  ): Promise<ChildProcess> {
    try {
      return await this.options.deps.launchGame(options);
    } catch (error) {
      if (!isPrecheckFailure(error) || operation.signal.aborted) {
        throw error;
      }
      await this.options.installer.repairBeforeLaunch(installed, operation);
      return this.options.deps.launchGame(options);
    }
  }

  private ensureSpawned(child: ChildProcess): Promise<number> {
    if (child.pid !== undefined) {
      return Promise.resolve(child.pid);
    }
    return new Promise<number>((_resolve, reject) => {
      const onError = (error: unknown): void => {
        clearTimeout(timer);
        reject(failure(spawnFailure(error)));
      };
      const timer = setTimeout(() => {
        child.off('error', onError);
        this.abandon(child);
        reject(
          failure({
            code: 'game-start-failed',
            message: `Java process did not start within ${String(SPAWN_ERROR_TIMEOUT_MS / 1000)} s`,
          }),
        );
      }, SPAWN_ERROR_TIMEOUT_MS);
      child.once('error', onError);
    });
  }
}
