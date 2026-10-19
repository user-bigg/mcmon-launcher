import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import {
  createMinecraftProcessWatcher,
  DEFAULT_EXTRA_JVM_ARGS,
  type LaunchOption,
  type ResolvedVersion,
} from '@xmcl/core';
import { offline } from '@xmcl/user';
import { GAME_RESOLUTION, LAUNCHER_NAME, type JoinMode } from '@shared/launch';
import { nickNeedsServicesBlock } from '@shared/minecraft-version';
import { gameListAddress, type ServerAddress } from '@shared/server-address';
import { locateCrashReport } from './crash-files';
import type { GameAuth } from './accounts';
import { connectingTarget, type GameLogWriter } from './game-log';
import { isWindowFailure, isWindowReady, WINDOW_SIGN_TAIL } from './window-signs';

export {
  findCrashReport,
  findJvmCrashLog,
  firstReportLine,
  locateCrashReport,
  reportedCrashFile,
} from './crash-files';

export interface GameExit {
  code: number | null;
  signal: string | null;
  crashReportPath: string | null;
}

export interface GameProcessHandlers {
  onOutput: () => void;
  onWindowReady: () => void;
  onWindowFailed: () => void;
  onConnecting: (target: { host: string; port: number }) => void;
  onExit: (exit: GameExit) => void;
  onError: (error: unknown) => void;
}

export interface WatchOptions {
  log: GameLogWriter;
  crashReportsDir: string;
  startedAt: number;
  instanceDir?: string;
  closeTimeoutMs?: number;
}

const CONNECTING_WINDOW = 512;
const CLOSE_TIMEOUT_MS = 5000;
const KILL_ESCALATION_MS = 5000;

export const ENCODING_JVM_ARGS = [
  '-Dfile.encoding=UTF-8',
  '-Dsun.jnu.encoding=UTF-8',
  '-Dstdout.encoding=UTF-8',
  '-Dstderr.encoding=UTF-8',
  '-Dsun.stdout.encoding=UTF-8',
  '-Dsun.stderr.encoding=UTF-8',
] as const;

export const WINDOWS_COMMAND_LIMIT = 28_000;
export const JVM_ARG_FILE = 'mcmonitor-jvm-args.txt';
const FIRST_ARG_FILE_JAVA = 9;

export type SpawnGame = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

export interface ArgFileOptions {
  dir: string;
  javaMajor: number;
  mainClass: string;
  platform: NodeJS.Platform;
  limit?: number;
  spawnImpl?: SpawnGame;
  writeFile?: (file: string, content: string) => void;
}

export function commandLength(command: string, args: readonly string[]): number {
  return [command, ...args].reduce((total, arg) => total + arg.length + 3, 0);
}

export function quoteArgFileValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function splitAtMainClass(
  args: readonly string[],
  mainClass: string,
): { jvm: string[]; rest: string[] } | null {
  const index = args.indexOf(mainClass);
  return index <= 0 ? null : { jvm: args.slice(0, index), rest: args.slice(index) };
}

// The Windows command line is limited to 32,767 characters, and the classpath, with the full
// path of the data folder in each of its entries, can get close to it. Java 9+ reads arguments
// from an @file in the system code page, so only pure-ASCII JVM arguments go there: Java would
// misread a path with Cyrillic.
export function argFileSpawn(options: ArgFileOptions): SpawnGame {
  const spawnImpl: SpawnGame =
    options.spawnImpl ??
    ((command, args, spawnOptions): ChildProcess => spawn(command, args ?? [], spawnOptions ?? {}));
  const write =
    options.writeFile ??
    ((file: string, content: string): void => {
      writeFileSync(file, content, 'ascii');
    });
  const limit = options.limit ?? WINDOWS_COMMAND_LIMIT;
  return (command, args = [], spawnOptions = {}) => {
    const tooLong =
      options.platform === 'win32' &&
      options.javaMajor >= FIRST_ARG_FILE_JAVA &&
      commandLength(command, args) > limit;
    const split = tooLong ? splitAtMainClass(args, options.mainClass) : null;
    const content = split === null ? null : `${split.jvm.map(quoteArgFileValue).join('\n')}\n`;
    if (split === null || content === null || !/^[\x20-\x7e\n]*$/.test(content)) {
      return spawnImpl(command, args, spawnOptions);
    }
    const file = join(options.dir, JVM_ARG_FILE);
    write(file, content);
    return spawnImpl(command, [`@${file}`, ...split.rest], spawnOptions);
  };
}

// When extraJVMArgs is passed, @xmcl/core drops its default G1 flags:
// we add them ourselves and append the encoding so the game output reads as UTF-8.
export function gameJvmArgs(modsDir: string | null = null, blockServices = false): string[] {
  return [
    ...DEFAULT_EXTRA_JVM_ARGS.filter((arg) => !arg.startsWith('-Xmx')),
    ...ENCODING_JVM_ARGS,
    ...modsFolderArgs(modsDir),
    ...(blockServices ? SERVICES_BLOCK_JVM_ARGS : []),
  ];
}

// .invalid is reserved (RFC 2606) and never resolves; a loopback address could reach
// something that listens on the player's own computer. authlib ignores the set unless the
// auth, account and session hosts are all given.
export const SERVICES_BLOCK_HOST = 'https://nope.invalid';
export const SERVICES_BLOCK_JVM_ARGS: readonly string[] = [
  'auth',
  'account',
  'session',
  'services',
].map((service) => `-Dminecraft.api.${service}.host=${SERVICES_BLOCK_HOST}`);

// A licence must reach the real services to join servers that check it, so the block is for
// a nickname only.
export function blocksServices(input: Pick<GameLaunchInput, 'auth' | 'minecraft'>): boolean {
  return (
    input.auth == null &&
    input.minecraft !== undefined &&
    nickNeedsServicesBlock({ id: input.minecraft })
  );
}

// The skins variant shares the game folder with the plain one; Fabric is pointed at a folder
// of its own, so the mod never sits in the instance and the instance mods are not loaded.
export function modsFolderArgs(modsDir: string | null): string[] {
  return modsDir === null ? [] : [`-Dfabric.modsFolder=${modsDir}`];
}

export function isConsoleJava(javaPath: string): boolean {
  return win32.basename(javaPath).toLowerCase() === 'java.exe';
}

// windowsHide hides the first window of the process: for javaw that is the game window,
// not a console.
export function gameSpawnOptions(javaPath: string): SpawnOptions {
  return { detached: true, windowsHide: isConsoleJava(javaPath) };
}

export interface GameLaunchInput {
  version: ResolvedVersion;
  gamePath: string;
  resourcePath: string;
  javaPath: string;
  nick: string;
  auth?: GameAuth | null;
  memoryMb: number;
  resolution?: { width: number; height: number };
  fullscreen?: boolean;
  mode: JoinMode | null;
  address: ServerAddress | null;
  modsDir?: string | null;
  minecraft?: string;
}

type GameIdentity = Required<Pick<LaunchOption, 'gameProfile' | 'accessToken'>> & {
  userType: 'legacy' | 'msa';
};

type GameLaunchOption = Omit<LaunchOption, 'userType'> & Pick<GameIdentity, 'userType'>;

// @xmcl/core types userType as 'mojang' | 'legacy' but passes the value to --userType as is.
// A Microsoft session must say 'msa', so the type is widened here, in one place.
function asLaunchOption(option: GameLaunchOption): LaunchOption {
  return option as LaunchOption;
}

function gameIdentity(input: GameLaunchInput): GameIdentity {
  if (input.auth != null) {
    return {
      gameProfile: { id: input.auth.uuid, name: input.nick },
      accessToken: input.auth.accessToken,
      userType: 'msa',
    };
  }
  const auth = offline(input.nick);
  return {
    gameProfile: { id: auth.selectedProfile.id, name: auth.selectedProfile.name },
    accessToken: auth.accessToken,
    userType: 'legacy',
  };
}

const IDENTITY_PLACEHOLDERS: ReadonlySet<string> = new Set(['${clientid}', '${auth_xuid}']);

// @xmcl/core keeps a placeholder it has no value for, so 1.19+ got `--clientId ${clientid}
// --xuid ${auth_xuid}`. The launcher has no client id of the official launcher and does not
// hand the game the Xbox user id: the flag goes together with its placeholder.
export function withoutIdentityPlaceholders(version: ResolvedVersion): ResolvedVersion {
  const game = version.arguments.game;
  const kept = game.filter((arg, index) => {
    const value = game[index + 1];
    const flag = typeof value === 'string' && IDENTITY_PLACEHOLDERS.has(value);
    return !flag && !(typeof arg === 'string' && IDENTITY_PLACEHOLDERS.has(arg));
  });
  if (kept.length === game.length) {
    return version;
  }
  return { ...version, arguments: { ...version.arguments, game: kept } };
}

export function gameLaunchOptions(input: GameLaunchInput): LaunchOption {
  return asLaunchOption({
    version: withoutIdentityPlaceholders(input.version),
    gamePath: input.gamePath,
    resourcePath: input.resourcePath,
    javaPath: input.javaPath,
    ...gameIdentity(input),
    launcherName: LAUNCHER_NAME,
    launcherBrand: LAUNCHER_NAME,
    maxMemory: input.memoryMb,
    extraJVMArgs: gameJvmArgs(input.modsDir ?? null, blocksServices(input)),
    resolution: {
      width: input.resolution?.width ?? GAME_RESOLUTION.width,
      height: input.resolution?.height ?? GAME_RESOLUTION.height,
      ...(input.fullscreen === true ? { fullscreen: true as const } : {}),
    },
    ...joinOptions(input.mode, input.address),
    extraExecOption: gameSpawnOptions(input.javaPath),
  });
}

export function joinOptions(
  mode: JoinMode | null,
  address: ServerAddress | null,
): Pick<LaunchOption, 'quickPlayMultiplayer' | 'server'> {
  if (mode === null || address === null) {
    return {};
  }
  if (mode === 'quick-play') {
    return { quickPlayMultiplayer: gameListAddress(address) };
  }
  return {
    server: address.port === null ? { ip: address.host } : { ip: address.host, port: address.port },
  };
}

export function killWithEscalation(
  child: ChildProcess,
  escalateAfterMs = KILL_ESCALATION_MS,
): void {
  if (hasExited(child)) {
    return;
  }
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, escalateAfterMs);
  timer.unref();
  child.once('exit', () => {
    clearTimeout(timer);
  });
}

export type StopMode = 'close' | 'force';

export const CLOSE_ESCALATION_MS = 15_000;

export interface CloseOptions {
  platform: NodeJS.Platform;
  escalateAfterMs?: number;
  spawnImpl?: SpawnGame;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

// taskkill without /F sends WM_CLOSE to the game window: Minecraft closes as if by the close
// button and saves the world. child.kill on Windows is TerminateProcess, which loses unsaved
// progress.
function askToClose(child: ChildProcess, options: CloseOptions, onRefused: () => void): void {
  if (options.platform !== 'win32' || child.pid === undefined) {
    child.kill('SIGTERM');
    return;
  }
  const run =
    options.spawnImpl ??
    ((command, args, spawnOptions): ChildProcess => spawn(command, args ?? [], spawnOptions ?? {}));
  const taskkill = run('taskkill', ['/PID', String(child.pid)], { windowsHide: true });
  taskkill.once('error', onRefused);
  taskkill.once('exit', (code) => {
    if (code !== 0) {
      onRefused();
    }
  });
}

export function closeGracefully(child: ChildProcess, options: CloseOptions): void {
  if (hasExited(child)) {
    return;
  }
  const force = (): void => {
    clearTimeout(timer);
    if (!hasExited(child)) {
      child.kill('SIGKILL');
    }
  };
  const timer = setTimeout(force, options.escalateAfterMs ?? CLOSE_ESCALATION_MS);
  child.once('exit', () => {
    clearTimeout(timer);
  });
  askToClose(child, options, force);
}

function watchConnecting(
  child: ChildProcess,
  onConnecting: GameProcessHandlers['onConnecting'],
): void {
  let tail = '';
  let seen = false;
  child.stdout?.on('data', (chunk: Buffer) => {
    if (seen) {
      return;
    }
    tail = (tail + chunk.toString('utf8')).slice(-CONNECTING_WINDOW * 4);
    const target = connectingTarget(tail);
    if (target !== null) {
      seen = true;
      onConnecting(target);
    }
  });
}

interface WindowWatch {
  ready: () => void;
  failed: () => void;
}

// Signs are looked for only until the window is settled: a GLFW error in the middle of a
// game is not a window that failed to open.
function watchWindowSigns(child: ChildProcess, onOutput: () => void, watch: WindowWatch): void {
  let tail = '';
  const onData = (chunk: Buffer): void => {
    onOutput();
    tail = (tail + chunk.toString('utf8')).slice(-WINDOW_SIGN_TAIL);
    if (isWindowReady(tail)) {
      watch.ready();
    } else if (isWindowFailure(tail)) {
      watch.failed();
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
}

// A failure does not close the way for a window: the game may still open one, and then the
// launcher must learn of it to call off the stop.
function windowWatch(handlers: GameProcessHandlers): WindowWatch {
  let ready = false;
  let failed = false;
  return {
    ready: (): void => {
      if (!ready) {
        ready = true;
        handlers.onWindowReady();
      }
    },
    failed: (): void => {
      if (!ready && !failed) {
        failed = true;
        handlers.onWindowFailed();
      }
    },
  };
}

// 'exit' arrives before stdout is fully read: the log is closed on 'close', but without
// waiting forever, since processes spawned by the game may keep the pipe open through
// inherited handles.
function closeWaiter(child: ChildProcess, timeoutMs: number): () => Promise<void> {
  let isClosed = false;
  const waiting = new Set<() => void>();
  child.once('close', () => {
    isClosed = true;
    for (const done of waiting) {
      done();
    }
  });
  return () =>
    isClosed
      ? Promise.resolve()
      : new Promise<void>((done) => {
          const finish = (): void => {
            clearTimeout(timer);
            waiting.delete(finish);
            done();
          };
          const timer = setTimeout(finish, timeoutMs);
          waiting.add(finish);
        });
}

export function watchGameProcess(
  child: ChildProcess,
  options: WatchOptions,
  handlers: GameProcessHandlers,
): void {
  options.log.attach(child.stdout);
  options.log.attach(child.stderr);
  const window = windowWatch(handlers);
  watchWindowSigns(child, handlers.onOutput, window);
  // The game connects to a server only from an open window.
  watchConnecting(child, (target) => {
    window.ready();
    handlers.onConnecting(target);
  });
  const whenClosed = closeWaiter(child, options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS);
  const watcher = createMinecraftProcessWatcher(child);
  watcher.on('minecraft-window-ready', window.ready);
  watcher.on('error', handlers.onError);
  watcher.on('minecraft-exit', (event) => {
    const code = typeof event.code === 'number' ? event.code : null;
    const signal = typeof event.signal === 'string' ? event.signal : null;
    const reported = typeof event.crashReportLocation === 'string' ? event.crashReportLocation : '';
    const crashReportPath =
      reported.length === 0 && code === 0
        ? Promise.resolve(null)
        : locateCrashReport(reported, options);
    void Promise.all([crashReportPath, whenClosed()]).then(([path]) => {
      handlers.onExit({ code, signal, crashReportPath: path });
    });
  });
}
