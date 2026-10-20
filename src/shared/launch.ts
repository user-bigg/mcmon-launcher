import type { LoaderId } from './instance';
import type { MicrosoftErrorCode } from './microsoft';
import type { ModLabel, ModsStepState } from './mods';
import type { ServerAddress } from './server-address';
import type { ClientModRun, SkinsStatus } from './skin-mod';

export type NetworkErrorReason = 'dns' | 'timeout' | 'tls' | 'proxy' | 'connection' | 'http';

export type LoaderInstallStage = 'manifest' | 'library';

export interface LaunchTarget {
  kind: 'server';
  serverId: number;
  minecraft: string;
  address: string;
}

export type LaunchAccount = { kind: 'nick'; nick: string } | { kind: 'account'; id: string };

export interface LaunchRequest {
  target: LaunchTarget;
  account: LaunchAccount;
  memoryMb?: number;
  joinServer?: boolean;
  serverSkins?: boolean;
  serverModpack?: boolean;
  launcherOnly?: boolean;
  launchId?: string;
  name?: string;
}

export const MAX_LAUNCH_NAME_LENGTH = 80;

export const LAUNCH_STEPS = ['java', 'files', 'loader', 'verify', 'launch', 'join'] as const;
export type LaunchStepId = (typeof LAUNCH_STEPS)[number];
export type LaunchStepStatus = 'wait' | 'active' | 'done' | 'skipped' | 'failed';

export interface LaunchStep {
  id: LaunchStepId;
  status: LaunchStepStatus;
  startedAt: string | null;
  durationMs: number | null;
  bytesPlanned: number;
  bytesQueued: number;
  bytesDone: number;
  filesTotal: number;
  filesDone: number;
}

export interface LaunchProgress {
  steps: LaunchStep[];
  current: LaunchStepId | null;
  percent: number;
  bytesDone: number;
  bytesTotal: number;
  bytesPerSecond: number;
  remainingSeconds: number | null;
  retries: number;
  mods?: ModsStepState;
}

export type GameEvent =
  | { type: 'started'; pid: number; session?: GameSession }
  | { type: 'window-ready'; afterMs: number }
  | { type: 'connecting'; host: string; port: number }
  | {
      type: 'exit';
      code: number | null;
      signal: string | null;
      byUser?: boolean;
      gameDialog?: boolean;
    }
  | { type: 'crash'; code: number | null; reportPath: string | null };

export type LaunchError =
  | { code: 'java-missing'; component: string; major: number }
  | { code: 'network'; url: string | null; reason?: NetworkErrorReason }
  | { code: 'disk-full'; path: string | null; bytesNeeded: number | null }
  | { code: 'checksum-mismatch'; file: string }
  | { code: 'permission-denied'; path: string | null }
  | { code: 'file-locked'; path: string | null }
  | { code: 'file-missing'; path: string | null }
  | { code: 'too-many-files' }
  | { code: 'version-not-found'; minecraft: string }
  | { code: 'loader-not-found'; loader: LoaderId; minecraft: string; version: string | null }
  | {
      code: 'loader-install-failed';
      loader: LoaderId;
      stage: LoaderInstallStage;
      detail: string | null;
    }
  | { code: 'invalid-request'; field: string }
  | { code: 'account-unsupported' }
  | { code: 'account-relogin' }
  | { code: 'account-failed'; reason: MicrosoftErrorCode }
  | { code: 'nick-taken' }
  | { code: 'banned'; reason: string | null; until: string | null; forever: boolean }
  | { code: 'join-unsupported'; minecraft: string }
  | { code: 'mods-required-missing'; mods: ModLabel[] }
  | { code: 'mods-required-failed'; mods: ModLabel[] }
  | { code: 'mods-server-unknown' }
  | { code: 'busy' }
  | { code: 'server-in-use' }
  | { code: 'not-running' }
  | { code: 'running' }
  | { code: 'cancelled' }
  | { code: 'game-start-failed'; message: string }
  | { code: 'unknown'; message: string };

export type LaunchErrorCode = LaunchError['code'];

export type LaunchResult<T> = { ok: true; value: T } | { ok: false; error: LaunchError };

export type JoinMode = 'quick-play' | 'legacy';

export interface PreparedGame {
  instance: string;
  minecraft: string;
  loader: LoaderId;
  versionId: string;
  javaMajor: number;
  bytesDownloaded: number;
  durationMs: number;
}

export interface GameSession {
  pid: number;
  instance: string;
  nick: string;
  minecraft: string;
  loader: LoaderId;
  memoryMb: number;
  join: { mode: JoinMode; address: ServerAddress } | null;
  skins: SkinsStatus | null;
  startedAt: string;
}

export type LaunchPhase = 'idle' | 'preparing' | 'running';

export type LaunchFailureSource = 'operation' | 'process';

export interface LaunchFailureRecord {
  error: LaunchError;
  source: LaunchFailureSource;
  operationId: number;
  at: string;
}

export interface GameExitRecord {
  code: number | null;
  signal: string | null;
  at: string;
}

export interface GameCrashRecord {
  code: number | null;
  reportPath: string | null;
  at: string;
}

export const MODS_ANSWERS = ['retry', 'without'] as const;
export type ModsAnswer = (typeof MODS_ANSWERS)[number];

export function isModsAnswer(value: unknown): value is ModsAnswer {
  return typeof value === 'string' && (MODS_ANSWERS as readonly string[]).includes(value);
}

export interface LaunchState {
  seq: number;
  phase: LaunchPhase;
  operationId: number;
  target: LaunchTarget | null;
  progress: LaunchProgress | null;
  session: GameSession | null;
  skins: SkinsStatus | null;
  windowReady: boolean;
  windowSlow: boolean;
  windowDialog: boolean;
  lastError: LaunchFailureRecord | null;
  lastExit: GameExitRecord | null;
  lastCrash: GameCrashRecord | null;
  blockedClientMods?: ClientModRun[];
  modsWaiting?: ModLabel[];
}

export type LaunchChange =
  | { kind: 'phase'; phase: LaunchPhase; operationId: number }
  | { kind: 'progress' }
  | { kind: 'game'; event: GameEvent }
  | { kind: 'failed'; error: LaunchError; source: LaunchFailureSource };

export type LaunchEvent = LaunchChange & { state: LaunchState };

export interface LaunchService {
  prepare: (target: LaunchTarget) => Promise<LaunchResult<PreparedGame>>;
  launch: (request: LaunchRequest) => Promise<LaunchResult<GameSession>>;
  cancel: () => Promise<LaunchResult<null>>;
  kill: () => Promise<LaunchResult<null>>;
  keepWaiting: () => Promise<LaunchResult<null>>;
  setJoinServer: (join: boolean) => Promise<LaunchResult<null>>;
  answerMods: (answer: ModsAnswer) => Promise<LaunchResult<null>>;
  logTail: (lines: number) => Promise<LaunchResult<string[]>>;
  state: () => Promise<LaunchResult<LaunchState>>;
  onEvent: (listener: (event: LaunchEvent) => void) => () => void;
}

export const LAUNCHER_NAME = 'MC Monitor';
export const LOG_TAIL_MAX_LINES = 2000;
export const GAME_RESOLUTION = { width: 1280, height: 720 } as const;
export const NICK_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
export const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_SERVER_ID = 999_999_999_999;

export function isValidServerId(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_SERVER_ID
  );
}

export function isValidNick(nick: string): boolean {
  return NICK_PATTERN.test(nick);
}

export function isValidVersionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._ +-]{0,63}$/.test(id) && !id.includes('..');
}

export function serverFolderId(serverId: number): string {
  return `server-${String(serverId)}`;
}

export function instanceIdOf(target: LaunchTarget): string {
  return serverFolderId(target.serverId);
}
