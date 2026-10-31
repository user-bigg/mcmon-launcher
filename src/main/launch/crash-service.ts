import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  isAutomaticFix,
  type CrashAnalysis,
  type CrashEvent,
  type CrashFixOutcome,
  type CrashFixRequest,
  type CrashReportPreview,
  type CrashResult,
  type CrashService,
} from '@shared/crash';
import { isJavaMajor, type JavaMajor } from '@shared/instance';
import type { GameSession, LaunchEvent, LaunchRequest, LaunchService } from '@shared/launch';
import { parseServerAddress } from '@shared/server-address';
import { analyzeCrash, type CrashVerdict } from './crash-analyzer';
import { applyCrashFix } from './crash-fixes';
import { redactText, serverWords, type RedactOptions } from './crash-redact';
import { buildCrashReport, writeCrashReport } from './crash-report';
import { NO_LOG_ORDER } from './crash-rules';
import { collectCrashFiles, waitForStableFile, type CrashFiles } from './crash-sources';
import type { CrashUpload } from '@shared/telemetry';
import { buildCrashUpload, shouldUpload } from './crash-upload';
import type { ClientModRun } from './skins/client-mod-blocks';
import { crashedOnClientMod, readStartLog } from './skins/client-mod-crash';
import { withDeadline } from '../deadline';
import { toLaunchError } from './errors';
import { readInstanceOverrides, writeInstanceOverrides } from './instance-overrides';
import { readJson } from './json-cache';
import { gameLayout, gameLogFile, instanceDir, type GameLayout } from './layout';

export interface RelaunchControl {
  lastLaunchRequest: () => LaunchRequest | null;
  exclusive: <T>(action: () => Promise<T>) => Promise<T>;
  clientModRunOf: (pid: number) => ClientModRun | null;
  blockClientMod: (run: ClientModRun) => Promise<void>;
  holdLaunchesUntil: (check: Promise<unknown>) => void;
}

export interface CrashServiceOptions {
  root: string;
  platform: NodeJS.Platform;
  arch: string;
  osRelease: string;
  totalMemoryBytes: number;
  launch: LaunchService & Partial<RelaunchControl>;
  launcher: { name: string; version: string };
  userName: string | null;
  homeDir: string | null;
  openPath: (path: string) => Promise<string>;
  virtualMachine?: () => Promise<boolean | null>;
  upload?: (report: CrashUpload) => void;
  now?: () => number;
  settle?: { intervalMs: number; timeoutMs: number };
}

interface TrackedGame {
  session: GameSession;
  startedAt: number;
  nick: string | null;
  request: LaunchRequest | null;
  clientMod: ClientModRun | null;
  crash: { code: number | null; reportPath: string | null } | null;
}

interface StoredAnalysis {
  analysis: CrashAnalysis;
  instance: string;
  loader: string;
  files: CrashFiles;
  nick: string | null;
  request: LaunchRequest | null;
}

interface InstanceSettings {
  javaOverride: JavaMajor | null;
  saveMemory: (memoryMb: number) => Promise<void>;
  saveJava: (major: JavaMajor | null) => Promise<void>;
}

const RELAUNCH_FIXES = new Set([
  'set-memory',
  'install-java',
  'reset-java',
  'disable-mod',
  'remove-file',
]);

const KEEP_ANALYSES = 5;
const VIRTUAL_MACHINE_DEADLINE_MS = 2000;
const DEFAULT_SETTLE = { intervalMs: 150, timeoutMs: 3000 };
const MIB = 1024 * 1024;

function ok<T>(value: T): CrashResult<T> {
  return { ok: true, value };
}

function emptyFiles(): CrashFiles {
  return {
    logLines: [],
    logHead: '',
    logOrder: NO_LOG_ORDER,
    crashReport: null,
    jvmReport: null,
    modFiles: [],
    note: null,
    nick: null,
    javaMajor: null,
  };
}

export class GameCrashService implements CrashService {
  private readonly layout: GameLayout;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: CrashEvent) => void>();
  private readonly analyses: StoredAnalysis[] = [];
  private readonly pending = new Set<Promise<void>>();
  private game: TrackedGame | null = null;
  private applying = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly options: CrashServiceOptions) {
    this.layout = gameLayout(options.root);
    this.now = options.now ?? Date.now;
    this.unsubscribe = options.launch.onEvent((event) => {
      this.onLaunchEvent(event);
    });
  }

  onEvent(listener: (event: CrashEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  last(): Promise<CrashResult<CrashAnalysis | null>> {
    return Promise.resolve(ok(this.analyses.at(-1)?.analysis ?? null));
  }

  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  async apply(request: CrashFixRequest): Promise<CrashResult<CrashFixOutcome>> {
    const stored = this.find(request.analysisId);
    if (stored === null) {
      return { ok: false, error: { code: 'analysis-not-found' } };
    }
    const fix = stored.analysis.fixes[request.fix];
    if (fix === undefined) {
      return { ok: false, error: { code: 'fix-not-available' } };
    }
    if (this.applying) {
      return { ok: false, error: { code: 'busy' } };
    }
    if (isAutomaticFix(fix) && !(await this.launchIdle())) {
      return { ok: false, error: { code: 'game-running' } };
    }
    this.applying = true;
    try {
      const run = (): Promise<CrashResult<CrashFixOutcome>> => this.applyFix(stored, fix);
      const outcome =
        isAutomaticFix(fix) && this.options.launch.exclusive !== undefined
          ? await this.options.launch.exclusive(run)
          : await run();
      if (!outcome.ok || request.relaunch !== true || !RELAUNCH_FIXES.has(fix.type)) {
        return outcome;
      }
      return ok({ ...outcome.value, relaunched: this.relaunch(stored) });
    } catch (error) {
      const launchError = toLaunchError(error);
      return launchError.code === 'busy'
        ? { ok: false, error: { code: 'game-running' } }
        : { ok: false, error: { code: 'failed', message: launchError.code } };
    } finally {
      this.applying = false;
    }
  }

  async report(analysisId: string): Promise<CrashResult<CrashReportPreview>> {
    const stored = this.find(analysisId);
    if (stored === null) {
      return { ok: false, error: { code: 'analysis-not-found' } };
    }
    return ok(await this.writeReport(stored));
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private async applyFix(
    stored: StoredAnalysis,
    fix: CrashAnalysis['fixes'][number],
  ): Promise<CrashResult<CrashFixOutcome>> {
    return applyCrashFix(fix, {
      root: this.layout.root,
      instance: stored.instance,
      totalMemoryBytes: this.options.totalMemoryBytes,
      crashReportPath: stored.files.crashReport?.path ?? null,
      ...(await this.settingsFor(stored)),
      openPath: this.options.openPath,
      writeReport: () => this.writeReport(stored),
    });
  }

  private relaunch(stored: StoredAnalysis): boolean {
    const request = stored.request ?? this.options.launch.lastLaunchRequest?.() ?? null;
    if (request === null) {
      return false;
    }
    void this.options.launch.launch(request).catch(() => undefined);
    return true;
  }

  private find(id: string): StoredAnalysis | null {
    return this.analyses.find((item) => item.analysis.id === id) ?? null;
  }

  private async launchIdle(): Promise<boolean> {
    const state = await this.options.launch.state();
    return state.ok && state.value.phase === 'idle';
  }

  private onLaunchEvent(event: LaunchEvent): void {
    if (event.kind !== 'game') {
      return;
    }
    const game = event.event;
    if (game.type === 'started') {
      this.track(game.session ?? null, this.options.launch.clientModRunOf?.(game.pid) ?? null);
    } else if (game.type === 'crash' && this.game !== null) {
      this.game.crash = { code: game.code, reportPath: game.reportPath };
    } else if (game.type === 'exit' && this.game !== null) {
      const tracked = this.game;
      this.game = null;
      const exit = { code: game.code, signal: game.signal };
      const byUser = game.byUser ?? (tracked.crash === null && exit.code !== 0);
      const task = this.analyze(tracked, exit, byUser, game.gameDialog === true)
        .catch(async () => {
          const verdict: CrashVerdict = {
            cause: { code: 'unknown' },
            rule: null,
            source: null,
            evidence: null,
            fixes: [{ type: 'open-log' }, { type: 'report' }],
            autoFixable: false,
          };
          this.publish(tracked, exit, emptyFiles(), verdict);
          await this.upload(tracked, exit, byUser, emptyFiles(), verdict);
        })
        .finally(() => {
          this.pending.delete(task);
        });
      this.pending.add(task);
      this.options.launch.holdLaunchesUntil?.(task);
    }
  }

  private track(session: GameSession | null, clientMod: ClientModRun | null): void {
    const startedAt = this.now();
    const request = this.options.launch.lastLaunchRequest?.() ?? null;
    const begin = (value: GameSession): void => {
      this.game = {
        session: value,
        startedAt,
        nick: value.nick,
        request,
        clientMod,
        crash: null,
      };
    };
    if (session !== null) {
      begin(session);
      return;
    }
    void this.options.launch.state().then((state) => {
      if (state.ok && state.value.session !== null) {
        begin(state.value.session);
      }
    });
  }

  private redactOptions(nick: string | null, request: LaunchRequest | null): RedactOptions {
    const address =
      request?.launcherOnly === true ? parseServerAddress(request.target.address) : null;
    return {
      nick,
      userName: this.options.userName,
      homeDir: this.options.homeDir,
      gameRoot: this.layout.root,
      ...(address === null ? {} : { server: serverWords(address) }),
    };
  }

  private async gameJavaMajor(minecraft: string): Promise<number | null> {
    const folder = join(this.layout.versions, minecraft);
    const version = (await readJson(join(folder, `${minecraft}.json`))) as
      { javaVersion?: { majorVersion?: unknown } } | undefined;
    const major = version?.javaVersion?.majorVersion;
    return typeof major === 'number' ? major : null;
  }

  private async analyze(
    tracked: TrackedGame,
    exit: { code: number | null; signal: string | null },
    stoppedByUser: boolean,
    gameDialog: boolean,
  ): Promise<void> {
    const instance = instanceDir(this.layout, tracked.session.instance);
    const settle = this.options.settle ?? DEFAULT_SETTLE;
    await waitForStableFile(gameLogFile(instance), settle.intervalMs, settle.timeoutMs);
    const files = await collectCrashFiles(
      instance,
      tracked.startedAt - 1000,
      tracked.crash?.reportPath ?? null,
    );
    const settings = await this.settingsFor({
      analysis: { minecraft: tracked.session.minecraft },
      instance,
    });
    const verdict = analyzeCrash({
      exit,
      stoppedByUser,
      gameDialog,
      logLines: files.logLines,
      logOrder: files.logOrder,
      crashReport: files.crashReport?.text ?? null,
      jvmReport: files.jvmReport?.text ?? null,
      memoryMb: tracked.session.memoryMb,
      totalMemoryBytes: this.options.totalMemoryBytes,
      javaMajor: files.javaMajor,
      modFiles: files.modFiles,
      platform: this.options.platform,
      arch: this.options.arch,
      virtualMachine: await this.virtualMachine(),
      gameJavaMajor: await this.gameJavaMajor(tracked.session.minecraft).catch(() => null),
      javaOverride: settings.javaOverride,
    });
    await this.blockClientModAfter(tracked, exit, stoppedByUser, files, verdict);
    this.publish(tracked, exit, files, verdict);
    await this.upload(tracked, exit, stoppedByUser, files, verdict);
  }

  private async upload(
    tracked: TrackedGame,
    exit: { code: number | null; signal: string | null },
    stoppedByUser: boolean,
    files: CrashFiles,
    verdict: CrashVerdict,
  ): Promise<void> {
    const send = this.options.upload;
    const uptimeMs = this.now() - tracked.startedAt;
    const moment = {
      stoppedByUser,
      crashed: tracked.crash !== null,
      exitCode: exit.code,
      uptimeMs,
      cause: verdict.cause,
    };
    if (send === undefined || !shouldUpload(moment)) {
      return;
    }
    const report = await buildCrashUpload({
      instanceDir: instanceDir(this.layout, tracked.session.instance),
      folderId: tracked.session.instance,
      minecraft: tracked.session.minecraft,
      loader: tracked.session.loader,
      launchId: tracked.request?.launchId ?? null,
      clientMod: tracked.clientMod !== null,
      javaMajor: files.javaMajor,
      exitCode: exit.code,
      uptimeMs,
      cause: verdict.cause,
      crashReport: files.crashReport?.text ?? files.jvmReport?.text ?? null,
      since: tracked.startedAt - 1000,
    }).catch(() => null);
    if (report !== null) {
      send(report);
    }
  }

  private async blockClientModAfter(
    tracked: TrackedGame,
    exit: { code: number | null; signal: string | null },
    stoppedByUser: boolean,
    files: CrashFiles,
    verdict: CrashVerdict,
  ): Promise<void> {
    const run = tracked.clientMod;
    const block = this.options.launch.blockClientMod;
    if (run === null || block === undefined) {
      return;
    }
    const instance = instanceDir(this.layout, tracked.session.instance);
    const crashed = !stoppedByUser && (tracked.crash !== null || exit.code !== 0);
    const blamed = crashedOnClientMod({
      crashed: crashed && verdict.cause.code !== 'closed',
      cause: verdict.cause,
      logText: crashed ? await readStartLog(gameLogFile(instance)) : null,
      crashReport: files.crashReport?.text ?? null,
    });
    if (blamed) {
      await block(run);
    }
  }

  private publish(
    tracked: TrackedGame,
    exit: { code: number | null; signal: string | null },
    files: CrashFiles,
    verdict: CrashVerdict,
  ): void {
    const nick = tracked.nick ?? files.nick;
    const analysis: CrashAnalysis = {
      id: randomUUID(),
      at: new Date(this.now()).toISOString(),
      instance: tracked.session.instance,
      minecraft: tracked.session.minecraft,
      memoryMb: tracked.session.memoryMb,
      totalMemoryMb: Math.floor(this.options.totalMemoryBytes / MIB),
      javaMajor: files.javaMajor,
      exit,
      uptimeMs: this.now() - tracked.startedAt,
      cause: verdict.cause,
      rule: verdict.rule,
      evidence:
        verdict.evidence === null
          ? null
          : redactText(verdict.evidence, this.redactOptions(nick, tracked.request)),
      fixes: verdict.fixes,
      autoFixable: verdict.autoFixable,
      files: {
        log: files.logLines.length > 0,
        crashReport: files.crashReport !== null,
        jvmReport: files.jvmReport !== null,
      },
    };
    this.analyses.push({
      analysis,
      instance: this.instancePath(tracked.session.instance),
      loader: tracked.session.loader,
      files,
      nick,
      request: tracked.request,
    });
    this.analyses.splice(0, Math.max(0, this.analyses.length - KEEP_ANALYSES));
    this.emit({ kind: 'analyzed', analysis });
  }

  private instancePath(folderId: string): string {
    try {
      return instanceDir(this.layout, folderId);
    } catch {
      return this.layout.instances;
    }
  }

  private async settingsFor(stored: {
    analysis: Pick<CrashAnalysis, 'minecraft'>;
    instance: string;
  }): Promise<InstanceSettings> {
    const minecraft = stored.analysis.minecraft;
    const overrides = await readInstanceOverrides(stored.instance);
    const javaOverride =
      overrides.javaFor === minecraft && isJavaMajor(overrides.javaMajor)
        ? overrides.javaMajor
        : null;
    return {
      javaOverride,
      saveMemory: (memoryMb) => writeInstanceOverrides(stored.instance, { memoryMb }),
      saveJava: (javaMajor) =>
        writeInstanceOverrides(
          stored.instance,
          javaMajor === null || minecraft === null
            ? { javaMajor: null }
            : { javaMajor, javaFor: minecraft },
        ),
    };
  }

  private virtualMachine(): Promise<boolean | null> {
    const read = this.options.virtualMachine;
    return read === undefined
      ? Promise.resolve(null)
      : withDeadline(Promise.resolve().then(read), VIRTUAL_MACHINE_DEADLINE_MS, null);
  }

  private async writeReport(stored: StoredAnalysis): Promise<CrashReportPreview> {
    const report = buildCrashReport({
      analysis: stored.analysis,
      logLines: stored.files.logLines,
      crashReport: stored.files.crashReport?.text ?? null,
      jvmReport: stored.files.jvmReport?.text ?? null,
      modFiles: stored.files.modFiles,
      loader: stored.loader,
      launcher: this.options.launcher,
      system: {
        platform: this.options.platform,
        arch: this.options.arch,
        release: this.options.osRelease,
      },
      redact: this.redactOptions(stored.nick, stored.request),
      now: this.now(),
    });
    return writeCrashReport(join(this.layout.root, 'reports'), stored.analysis.id, report);
  }

  private emit(event: CrashEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createCrashService(options: CrashServiceOptions): GameCrashService {
  return new GameCrashService(options);
}
