import {
  type GameCrashRecord,
  type GameEvent,
  type GameExitRecord,
  type GameSession,
  type LaunchChange,
  type LaunchError,
  type LaunchEvent,
  type LaunchFailureRecord,
  type LaunchFailureSource,
  type LaunchRequest,
  type LaunchResult,
  type LaunchService,
  type LaunchState,
  type ModsAnswer,
  type LaunchTarget,
  type PreparedGame,
  instanceIdOf,
} from '@shared/launch';
import {
  optionalOffFor,
  type ModCatalog,
  type ModChoices,
  type ServerModsSource,
} from '@shared/mods';
import { parseServerAddress } from '@shared/server-address';
import type { GameWindow } from '@shared/settings';
import { skinsOffBeforeTable, wantsClientMod, type SkinModTable } from '@shared/skin-mod';
import type { LaunchTelemetryEvent, TelemetrySink } from '@shared/telemetry';
import { resolveOfflinePlayer, type GamePlayer, type PlayerResolver } from './accounts';
import type { LaunchDependencies } from './dependencies';
import type { Engine } from './engine';
import { failure, toLaunchError } from './errors';
import type { RegistryArchReader } from './game-arch';
import type { GameExit } from './game-process';
import type { Installed } from './install';
import { InstanceStore } from './instances';
import type { FetchJson } from './json-cache';
import { gameLayout, type GameLayout } from './layout';
import { concealServer, serverWords } from './crash-redact';
import type { ModsRequest } from './mods/run';
import type { FetchText } from './loaders/sources';
import { Operation, PROGRESS_INTERVAL_MS } from './operation';
import { bestEffort } from './fs-retry';
import { openPlayGate, playCheckQuery, type PlayChecker, type PlayGate } from './play-check';
import { clearPlayCode } from './play-code';
import type { ProgressModel } from './progress';
import {
  finishedTelemetry,
  isCrashExit,
  markWindowReady,
  safely,
  settleSteps,
  startedTelemetry,
  type RunningGame,
} from './running';
import { ClientModBlocks, type ClientModRun } from './skins/client-mod-blocks';
import type { SkinModSource, SkinsRequest } from './skins/variant';
import { WINDOW_FAILURE_GRACE_MS, WindowWait } from './window-wait';
import { withDeadline } from '../deadline';

export type { LaunchDependencies } from './dependencies';

export interface LaunchServiceOptions {
  root: string;
  platform: NodeJS.Platform;
  arch: string;
  registryArch?: RegistryArchReader;
  totalMemoryBytes: number;
  fetch: FetchJson;
  fetchText?: FetchText;
  instances?: InstanceStore;
  telemetry: TelemetrySink;
  resolvePlayer?: PlayerResolver;
  playCheck?: PlayChecker;
  skinMod?: SkinModSource;
  mods?: CatalogModsSource;
  launcherOnly?: (serverId: number) => boolean;
  withoutMods?: (folderId: string) => Promise<boolean>;
  gameWindow?: () => GameWindow;
  systemLanguages?: () => readonly string[];
  now?: () => number;
  dependencies?: Partial<LaunchDependencies>;
}

export interface CatalogModsSource {
  catalog: () => Promise<ModCatalog | null>;
  server: (serverId: number) => Promise<ServerModsSource>;
  choices: () => Promise<ModChoices>;
}

export const DIALOG_QUIET_MS = 1000;
export const SKIN_TABLE_TIMEOUT_MS = 5000;
const CRASH_CHECK_TIMEOUT_MS = 15_000;

type ServiceState =
  | { phase: 'idle' }
  | { phase: 'preparing'; operation: Operation; target: LaunchTarget }
  | { phase: 'running'; game: RunningGame; target: LaunchTarget };

interface Claim {
  operation: Operation;
  release: () => void;
}

interface LastLog {
  file: string;
  since: number;
  concealed: readonly string[] | null;
}

function ok<T>(value: T): LaunchResult<T> {
  return { ok: true, value };
}

function rejected(error: LaunchError): LaunchResult<never> {
  return { ok: false, error };
}

export class GameLaunchService implements LaunchService {
  private readonly layout: GameLayout;
  private readonly instances: InstanceStore;
  private readonly now: () => number;
  private readonly resolvePlayer: PlayerResolver;
  private readonly listeners = new Set<(event: LaunchEvent) => void>();
  private status: ServiceState = { phase: 'idle' };
  private engine: Engine | null = null;
  private loading: Promise<Engine> | null = null;
  private seq = 0;
  private operationId = 0;
  private progress: ProgressModel | null = null;
  private lastTarget: LaunchTarget | null = null;
  private lastLog: LastLog | null = null;
  private lastProgressAt = 0;
  private lastError: LaunchFailureRecord | null = null;
  private lastExit: GameExitRecord | null = null;
  private lastCrash: GameCrashRecord | null = null;
  private lastRequest: LaunchRequest | null = null;
  private readonly clientModByPid = new Map<number, ClientModRun>();
  private readonly crashChecks = new Set<Promise<unknown>>();
  private readonly clientModBlocks: ClientModBlocks;
  private blockedClientMods: ClientModRun[] = [];
  private blocksRead: Promise<void> | null = null;
  private windowWait: WindowWait | null = null;
  private dialogAt = 0;
  private failureTimer: NodeJS.Timeout | null = null;
  private holds = 0;

  constructor(private readonly options: LaunchServiceOptions) {
    this.layout = gameLayout(options.root);
    this.now = options.now ?? Date.now;
    this.resolvePlayer = options.resolvePlayer ?? resolveOfflinePlayer;
    this.instances = options.instances ?? new InstanceStore({ layout: this.layout, now: this.now });
    this.clientModBlocks = new ClientModBlocks(this.layout);
  }

  activeInstance(): string | null {
    return this.status.phase === 'idle' ? null : instanceIdOf(this.status.target);
  }

  lastLaunchRequest(): LaunchRequest | null {
    return this.lastRequest;
  }

  clientModRunOf(pid: number): ClientModRun | null {
    return this.clientModByPid.get(pid) ?? null;
  }

  // The crash check of a game that just ended may still be reading its files: a launch waits
  // for it, so a quick "Retry" does not put back the jar that has only now been found guilty.
  holdLaunchesUntil(check: Promise<unknown>): void {
    const settled = check
      .catch(() => undefined)
      .finally(() => {
        this.crashChecks.delete(settled);
      });
    this.crashChecks.add(settled);
  }

  async blockClientMod(run: ClientModRun): Promise<void> {
    try {
      await this.clientModBlocks.add(run);
    } catch (error) {
      console.warn(`client mod: block not saved: ${String(error)}`);
    }
    this.blockedClientMods = await this.clientModBlocks.list();
    this.emit({ kind: 'progress' });
  }

  private async isClientModBlocked(run: ClientModRun): Promise<boolean> {
    await withDeadline(Promise.all([...this.crashChecks]), CRASH_CHECK_TIMEOUT_MS, []);
    return this.clientModBlocks.has(run);
  }

  private readBlocks(): Promise<void> {
    this.blocksRead ??= this.clientModBlocks.list().then((list) => {
      this.blockedClientMods = list;
    });
    return this.blocksRead;
  }

  checkingCrash(): boolean {
    return this.crashChecks.size > 0;
  }

  isIdle(): boolean {
    return this.status.phase === 'idle' && this.holds === 0;
  }

  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (!this.isIdle()) {
      throw failure({ code: 'busy' });
    }
    this.holds += 1;
    try {
      return await action();
    } finally {
      this.holds -= 1;
    }
  }

  onEvent(listener: (event: LaunchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async state(): Promise<LaunchResult<LaunchState>> {
    await this.readBlocks();
    return ok(this.snapshot());
  }

  async prepare(target: LaunchTarget): Promise<LaunchResult<PreparedGame>> {
    const claim = this.claim(target);
    if (claim === null) {
      return rejected({ code: 'busy' });
    }
    const { operation, release } = claim;
    try {
      const engine = await this.loadEngine();
      const installed = await engine.installer.install({ target, joinServer: true }, operation);
      operation.progress.skipWaiting();
      this.finishOperation(operation);
      return ok(installed.prepared);
    } catch (error) {
      return this.failOperation(error, operation);
    } finally {
      release();
    }
  }

  async launch(request: LaunchRequest): Promise<LaunchResult<GameSession>> {
    const address = parseServerAddress(request.target.address);
    if (address === null) {
      return rejected({ code: 'invalid-request', field: 'address' });
    }
    const claim = this.claim(request.target);
    if (claim === null) {
      return rejected({ code: 'busy' });
    }
    const { operation, release } = claim;
    let gate: PlayGate | null = null;
    try {
      const resolved = await this.resolvePlayer(request.account);
      const query = playCheckQuery(request, resolved);
      const stopDownload = (): void => {
        operation.controller.abort();
      };
      // The site is asked while the files download; the game waits for the answer, and a
      // refusal stops the download at once.
      gate = openPlayGate(this.options.playCheck, query, stopDownload);
      const mods = this.modsRequest(request);
      const skins = await this.skinsRequest(request);
      const engine = await this.loadEngine();
      operation.joinServer = request.joinServer !== false;
      const installed = await engine.installer.install(
        {
          target: request.target,
          joinServer: operation.joinServer,
          skins,
          ...(mods === null ? {} : { mods }),
        },
        operation,
      );
      const admission = await gate.verdict;
      if (!admission.go) {
        throw failure(admission.error);
      }
      const player = { ...resolved, nick: admission.nick };
      const launched = this.withLauncherOnly(request);
      operation.progress.start('launch');
      this.emitProgress(true);
      const running = await engine.sessions.spawn({
        installed,
        player,
        serverId: request.target.serverId,
        address,
        playCode: admission.code,
        name: request.name ?? null,
        memoryMb: request.memoryMb,
        window: this.options.gameWindow?.(),
        operation,
        release,
      });
      await this.adopt(engine, running, installed, launched, player);
      return ok(running.session);
    } catch (error) {
      release();
      return this.failOperation(error, operation, gate?.refusal() ?? null);
    }
  }

  // The window's word is enough to hide the address; the site's word, read after the card the
  // mods step asked for, hides it as well.
  private withLauncherOnly(request: LaunchRequest): LaunchRequest {
    const known = this.options.launcherOnly?.(request.target.serverId) === true;
    return known ? { ...request, launcherOnly: true } : request;
  }

  // The catalog and the server's line are asked for at once; a slow site costs the launch no
  // more than the deadline. The window's word on the server's mods is not taken: main reads
  // them from the site, so a launch from the tray or a link knows them as well.
  private modsRequest(request: LaunchRequest): ModsRequest | null {
    const source = this.options.mods;
    if (source === undefined) {
      return null;
    }
    const deadline = <T>(work: () => Promise<T>, late: T): Promise<T> =>
      withDeadline<T>(Promise.resolve().then(work), SKIN_TABLE_TIMEOUT_MS, late);
    const catalog = deadline<ModCatalog | null>(source.catalog, null);
    const { serverId } = request.target;
    const server = deadline<ServerModsSource>(() => source.server(serverId), { state: 'unknown' });
    return {
      modpack: request.serverModpack === true,
      server: () => server,
      catalog: () => catalog,
      choices: async (): ReturnType<ModsRequest['choices']> => {
        const choices = await source.choices();
        return {
          enabled: choices.enabled,
          shaders: choices.shaders,
          optionalOff: optionalOffFor(choices, serverId),
        };
      },
    };
  }

  // The table is asked for while the game files download; a slow site costs the launch no
  // more than the deadline, and then the game starts without skins.
  private async skinsRequest(request: LaunchRequest): Promise<SkinsRequest> {
    const source = this.options.skinMod;
    const chosen = this.options.withoutMods;
    const folderId = instanceIdOf(request.target);
    const withoutMods = (): Promise<boolean> =>
      chosen === undefined ? Promise.resolve(false) : chosen(folderId).catch(() => false);
    const asked: SkinsRequest = {
      auth: request.account.kind === 'nick' ? 'nick' : 'license',
      serverSkins: request.serverSkins,
      modpack: request.serverModpack === true,
      withoutMods,
      table: () => Promise.resolve(null),
      clientModBlocked: (run) => this.isClientModBlocked(run),
    };
    if (source === undefined) {
      return asked;
    }
    let table: Promise<SkinModTable | null> | null = null;
    const ask = (): Promise<SkinModTable | null> => {
      table ??= withDeadline<SkinModTable | null>(
        Promise.resolve().then(source),
        SKIN_TABLE_TIMEOUT_MS,
        null,
      );
      return table;
    };
    const off = skinsOffBeforeTable({
      auth: asked.auth,
      serverSkins: asked.serverSkins,
      modpack: asked.modpack,
      withoutMods: await withoutMods(),
      loader: 'vanilla',
    });
    const client = wantsClientMod({ ...asked, loader: 'vanilla' });
    // With catalog mods the table also gives the loader the game version needs.
    if (off === null || client || this.options.mods !== undefined) {
      void ask();
    }
    return { ...asked, table: ask };
  }

  // The choice is read when the process starts, so it follows the switch until then.
  setJoinServer(join: boolean): Promise<LaunchResult<null>> {
    const current = this.status;
    if (current.phase === 'idle') {
      return Promise.resolve(rejected({ code: 'not-running' }));
    }
    if (current.phase === 'running' || current.operation.joinFixed) {
      return Promise.resolve(rejected({ code: 'running' }));
    }
    current.operation.joinServer = join;
    return Promise.resolve(ok(null));
  }

  answerMods(answer: ModsAnswer): Promise<LaunchResult<null>> {
    const current = this.status;
    if (current.phase !== 'preparing' || !current.operation.answerMods(answer)) {
      return Promise.resolve(rejected({ code: 'not-running' }));
    }
    return Promise.resolve(ok(null));
  }

  keepWaiting(): Promise<LaunchResult<null>> {
    const current = this.status;
    if (current.phase !== 'running') {
      return Promise.resolve(rejected({ code: 'not-running' }));
    }
    const { game } = current;
    if (game.windowReadyAt === null && !game.windowFailed && game.windowSlow) {
      game.windowSlow = false;
      this.windowWait?.start();
      this.emitProgress(true);
    }
    return Promise.resolve(ok(null));
  }

  // Main tells it from the state of the launcher window, the game's log says nothing yet.
  noteGameDialog(): void {
    const current = this.status;
    if (current.phase !== 'running') {
      return;
    }
    const { game } = current;
    if (game.windowReadyAt === null && !game.windowFailed && !game.windowDialog) {
      game.windowDialog = true;
      this.dialogAt = this.now();
      this.emitProgress(true);
    }
  }

  // The launcher window was enabled again by the launcher itself, so it no longer tells when
  // the player pressed "OK". The game's render thread waits in the dialog and writes nothing;
  // a new line of the log after a pause means the dialog is gone and the game goes on.
  private dialogClosed(running: RunningGame): void {
    if (running.windowDialog && this.now() - this.dialogAt >= DIALOG_QUIET_MS) {
      running.windowDialog = false;
      this.emitProgress(true);
    }
  }

  cancel(): Promise<LaunchResult<null>> {
    const current = this.status;
    if (current.phase === 'preparing') {
      current.operation.controller.abort();
      return Promise.resolve(ok(null));
    }
    if (current.phase === 'running' && current.game.windowReadyAt === null) {
      // The game's own error dialog was up: the player stops a game that has already failed,
      // so the exit is its crash, not the player's cancel.
      if (current.game.windowDialog) {
        this.engine?.sessions.terminate(current.game);
      } else {
        this.engine?.sessions.stop(current.game, 'force');
      }
      return Promise.resolve(ok(null));
    }
    if (current.phase === 'running') {
      return Promise.resolve(rejected({ code: 'running' }));
    }
    return Promise.resolve(rejected({ code: 'not-running' }));
  }

  kill(): Promise<LaunchResult<null>> {
    const current = this.status;
    if (current.phase !== 'running') {
      return Promise.resolve(rejected({ code: 'not-running' }));
    }
    this.engine?.sessions.stop(current.game, 'close');
    return Promise.resolve(ok(null));
  }

  whenIdle(): Promise<void> {
    if (this.status.phase === 'idle') {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const unsubscribe = this.onEvent((event) => {
        if (event.kind === 'phase' && event.phase === 'idle') {
          unsubscribe();
          resolve();
        }
      });
    });
  }

  async logTail(lines: number): Promise<LaunchResult<string[]>> {
    const current = this.status;
    const log =
      current.phase === 'running'
        ? { file: current.game.log.file, since: current.game.log.startOffset }
        : this.lastLog;
    if (log === null || this.engine === null) {
      return ok([]);
    }
    const concealed = this.lastLog?.concealed ?? null;
    try {
      const tail = await this.engine.deps.readLog(log.file, lines, log.since);
      return ok(concealed === null ? tail : tail.map((line) => concealServer(line, concealed)));
    } catch (error) {
      return rejected(toLaunchError(error));
    }
  }

  dispose(): void {
    const current = this.status;
    if (current.phase === 'preparing') {
      current.operation.controller.abort();
      current.operation.stop();
    }
    if (current.phase === 'running') {
      void current.game.log.close();
    }
    this.stopWindowWatch();
    void this.engine?.deps.closeNetwork();
    this.listeners.clear();
  }

  loadEngine(): Promise<Engine> {
    this.loading ??= import('./engine').then(({ createEngine }) => {
      const engine = createEngine({
        layout: this.layout,
        platform: this.options.platform,
        arch: this.options.arch,
        registryArch: this.options.registryArch,
        totalMemoryBytes: this.options.totalMemoryBytes,
        fetch: this.options.fetch,
        fetchText: this.options.fetchText,
        instances: this.instances,
        systemLanguages: this.options.systemLanguages ?? ((): readonly string[] => []),
        overrides: this.options.dependencies ?? {},
        now: this.now,
        report: (event) => {
          this.report(event);
        },
      });
      this.engine = engine;
      return engine;
    });
    this.loading.catch(() => {
      this.loading = null;
    });
    return this.loading;
  }

  // The server folder stays busy from the first line of the launch until the game exits:
  // otherwise its removal could slip in between installation and the process start.
  private claim(target: LaunchTarget): Claim | null {
    if (!this.isIdle()) {
      return null;
    }
    let release: () => void;
    try {
      release = this.instances.acquire(instanceIdOf(target));
    } catch {
      return null;
    }
    this.operationId += 1;
    const operation = new Operation(this.operationId, this.now, (force) => {
      this.emitProgress(force);
    });
    this.status = { phase: 'preparing', operation, target };
    this.lastTarget = target;
    this.progress = operation.progress;
    this.lastError = null;
    this.emit({ kind: 'phase', phase: 'preparing', operationId: this.operationId });
    this.emitProgress(true);
    return { operation, release };
  }

  private finishOperation(operation: Operation): void {
    operation.stop();
    const current = this.status;
    if (current.phase === 'preparing' && current.operation === operation) {
      this.status = { phase: 'idle' };
      this.emit({ kind: 'phase', phase: 'idle', operationId: this.operationId });
    }
    this.emitProgress(true);
  }

  private failOperation(
    error: unknown,
    operation: Operation,
    refusal: LaunchError | null = null,
  ): LaunchResult<never> {
    const launchError: LaunchError =
      refusal ?? (operation.signal.aborted ? { code: 'cancelled' } : toLaunchError(error));
    operation.progress.failActive('files');
    this.finishOperation(operation);
    this.fail(launchError, 'operation');
    return rejected(launchError);
  }

  private fail(error: LaunchError, source: LaunchFailureSource): void {
    this.lastError = {
      error,
      source,
      operationId: this.operationId,
      at: new Date(this.now()).toISOString(),
    };
    this.emit({ kind: 'failed', error, source });
  }

  private async adopt(
    engine: Engine,
    running: RunningGame,
    installed: Installed,
    request: LaunchRequest,
    player: GamePlayer,
  ): Promise<void> {
    const current = this.status;
    if (current.phase !== 'preparing' || current.operation.signal.aborted) {
      engine.sessions.abandon(running.child);
      await bestEffort(() => clearPlayCode(running.instanceDir));
      await running.log.close();
      throw failure({ code: 'cancelled' });
    }
    current.operation.stop();
    this.status = { phase: 'running', game: running, target: current.target };
    // The id belongs to one click: a relaunch from the crash screen must not carry it over.
    const { launchId, ...repeatable } = request;
    this.lastRequest = repeatable;
    if (installed.clientModRun !== null) {
      this.clientModByPid.set(running.session.pid, installed.clientModRun);
    }
    const address = parseServerAddress(request.target.address);
    this.lastLog = {
      file: running.log.file,
      since: running.log.startOffset,
      concealed: request.launcherOnly === true && address !== null ? serverWords(address) : null,
    };
    this.lastExit = null;
    this.lastCrash = null;
    this.emit({ kind: 'phase', phase: 'running', operationId: this.operationId });
    this.windowWait = new WindowWait(this.now, () => {
      this.onWindowSlow(running);
    });
    this.windowWait.start();
    engine.sessions.watch(running, {
      output: () => {
        this.windowWait?.output();
        this.dialogClosed(running);
      },
      windowReady: (game) => {
        this.onWindowReady(game);
      },
      windowFailed: (game) => {
        this.onWindowFailed(engine, game);
      },
      connecting: (_game, target) => {
        this.emitGame({ type: 'connecting', host: target.host, port: target.port });
      },
      failed: (error) => {
        this.fail(error, 'process');
      },
      exited: (game, exit) => {
        void this.finishGame(game, exit);
      },
    });
    this.emitGame({ type: 'started', pid: running.session.pid, session: running.session });
    this.report(startedTelemetry(running, installed, player, launchId));
  }

  private stopWindowWatch(): void {
    this.windowWait?.stop();
    this.windowWait = null;
    if (this.failureTimer !== null) {
      clearTimeout(this.failureTimer);
      this.failureTimer = null;
    }
  }

  private onWindowSlow(running: RunningGame): void {
    if (running.windowReadyAt === null && !running.windowFailed) {
      running.windowSlow = true;
      this.emitProgress(true);
    }
  }

  // Without a window the game is of no use, and its own error dialog would keep the process
  // alive until someone clicks it. The pause lets the game finish its log or exit by itself.
  private onWindowFailed(engine: Engine, running: RunningGame): void {
    if (running.windowReadyAt !== null || running.windowFailed || running.killedByUser) {
      return;
    }
    running.windowFailed = true;
    running.windowSlow = false;
    running.windowDialog = false;
    this.windowWait?.stop();
    this.emitProgress(true);
    this.failureTimer = setTimeout(() => {
      this.failureTimer = null;
      if (running.windowFailed) {
        engine.sessions.terminate(running);
      }
    }, WINDOW_FAILURE_GRACE_MS);
    this.failureTimer.unref();
  }

  private onWindowReady(running: RunningGame): void {
    if (running.windowReadyAt !== null) {
      return;
    }
    this.stopWindowWatch();
    const at = this.now();
    markWindowReady(running, at);
    this.emitProgress(true);
    this.emitGame({ type: 'window-ready', afterMs: at - running.startedAt });
  }

  private async finishGame(running: RunningGame, exit: GameExit): Promise<void> {
    const at = new Date(this.now()).toISOString();
    const crashed = isCrashExit(running, exit);
    this.stopWindowWatch();
    try {
      settleSteps(running);
      this.lastExit = { code: exit.code, signal: exit.signal, at };
      if (crashed) {
        this.lastCrash = { code: exit.code, reportPath: exit.crashReportPath, at };
        this.emitGame({ type: 'crash', code: exit.code, reportPath: exit.crashReportPath });
      }
      if (running.windowReadyAt === null && !running.killedByUser) {
        this.fail(
          { code: 'game-start-failed', message: `exit code ${String(exit.code)}` },
          'process',
        );
      }
      this.emitGame({
        type: 'exit',
        code: exit.code,
        signal: exit.signal,
        byUser: running.killedByUser,
        ...(running.windowDialog ? { gameDialog: true } : {}),
      });
      this.report(finishedTelemetry(running, exit, crashed, this.now()));
    } finally {
      this.clientModByPid.delete(running.session.pid);
      await running.log.close();
      running.release();
      const current = this.status;
      if (current.phase === 'running' && current.game === running) {
        this.status = { phase: 'idle' };
        this.emit({ kind: 'phase', phase: 'idle', operationId: this.operationId });
      }
      this.emitProgress(true);
    }
  }

  private snapshot(): LaunchState {
    const current = this.status;
    const game = current.phase === 'running' ? current.game : null;
    return {
      seq: this.seq,
      phase: current.phase,
      operationId: this.operationId,
      target: current.phase === 'idle' ? this.lastTarget : current.target,
      progress: this.progress?.snapshot() ?? null,
      session: game?.session ?? null,
      skins: this.skinsOf(current),
      windowReady: game !== null && game.windowReadyAt !== null,
      windowSlow: game?.windowSlow === true,
      windowDialog: game?.windowDialog === true,
      lastError: this.lastError,
      lastExit: this.lastExit,
      lastCrash: this.lastCrash,
      blockedClientMods: this.blockedClientMods,
      ...this.modsWaitingOf(current),
    };
  }

  private modsWaitingOf(current: ServiceState): Pick<LaunchState, 'modsWaiting'> {
    const waiting = current.phase === 'preparing' ? current.operation.modsWaiting : null;
    return waiting === null ? {} : { modsWaiting: waiting };
  }

  private skinsOf(current: ServiceState): LaunchState['skins'] {
    if (current.phase === 'preparing') {
      return current.operation.skins;
    }
    return current.phase === 'running' ? current.game.session.skins : null;
  }

  private report(event: LaunchTelemetryEvent): void {
    safely(() => {
      this.options.telemetry(event);
    });
  }

  private emitGame(event: GameEvent): void {
    this.emit({ kind: 'game', event });
  }

  private emitProgress(force: boolean): void {
    const now = this.now();
    if (this.progress === null || (!force && now - this.lastProgressAt < PROGRESS_INTERVAL_MS)) {
      return;
    }
    this.lastProgressAt = now;
    this.emit({ kind: 'progress' });
  }

  private emit(change: LaunchChange): void {
    this.seq += 1;
    const event: LaunchEvent = { ...change, state: this.snapshot() };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        continue;
      }
    }
  }
}

export function createLaunchService(options: LaunchServiceOptions): GameLaunchService {
  return new GameLaunchService(options);
}
