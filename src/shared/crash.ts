import type { LaunchError } from './launch';

export const CRASH_CAUSE_CODES = [
  'closed',
  'out-of-memory',
  'system-memory',
  'java-version',
  'graphics',
  'mod-duplicate',
  'mod-conflict',
  'mod-dependency',
  'mod-version',
  'mod-crash',
  'corrupt-file',
  'disk-full',
  'join-before-load',
  'unknown',
] as const;
export type CrashCauseCode = (typeof CRASH_CAUSE_CODES)[number];

export type GraphicsProblem =
  'no-opengl' | 'pixel-format' | 'context' | 'driver-crash' | 'display' | 'not-responding';

export const WINDOW_GRAPHICS_PROBLEMS: readonly GraphicsProblem[] = [
  'no-opengl',
  'pixel-format',
  'context',
];

export type SystemMemoryKind = 'insufficient' | 'reserve' | 'reserve-32bit' | 'paging' | 'threads';

export type CrashCause =
  | { code: 'closed' }
  | { code: 'out-of-memory'; memoryMb: number | null; area: string | null; heap?: boolean }
  | { code: 'system-memory'; memoryMb: number | null; kind: SystemMemoryKind }
  | {
      code: 'java-version';
      direction: 'too-old' | 'too-new';
      requiredMajor: number | null;
      currentMajor: number | null;
    }
  | { code: 'graphics'; problem: GraphicsProblem }
  | { code: 'mod-duplicate'; mod: string | null; files: string[] }
  | {
      code: 'mod-conflict';
      mod: string | null;
      other: string | null;
      mixin: boolean;
      modId?: string | null;
      otherId?: string | null;
    }
  | {
      code: 'mod-dependency';
      mod: string | null;
      dependency: string;
      range: string | null;
      modId?: string | null;
    }
  | {
      code: 'mod-version';
      mod: string | null;
      dependency: string;
      range: string | null;
      present: string | null;
      modId?: string | null;
    }
  | { code: 'mod-crash'; mod: string | null; modId?: string | null }
  | { code: 'corrupt-file'; file: string | null }
  | { code: 'disk-full' }
  | { code: 'join-before-load' }
  | { code: 'unknown' };

export type CrashFolder = 'instance' | 'mods' | 'logs' | 'crash-reports';

export type CrashAdvice =
  | 'close-programs'
  | 'paging-file'
  | 'update-driver'
  | 'discrete-gpu'
  | 'vm-graphics'
  | 'free-disk'
  | 'install-dependency'
  | 'update-mod'
  | 'lower-render-distance'
  | 'java-64bit'
  | 'antivirus';

export type CrashFix =
  | { type: 'set-memory'; mb: number }
  | { type: 'install-java'; major: number }
  | { type: 'reset-java' }
  | { type: 'disable-mod'; file: string }
  | { type: 'remove-file'; path: string }
  | { type: 'launch-without-join' }
  | { type: 'open-log' }
  | { type: 'open-folder'; folder: CrashFolder }
  | { type: 'report' }
  | { type: 'advice'; advice: CrashAdvice };

export type CrashFixType = CrashFix['type'];

export const AUTOMATIC_FIXES: readonly CrashFixType[] = [
  'set-memory',
  'install-java',
  'reset-java',
  'disable-mod',
  'remove-file',
  'launch-without-join',
];

export interface CrashExit {
  code: number | null;
  signal: string | null;
}

export interface CrashAnalysis {
  id: string;
  at: string;
  instance: string;
  minecraft: string | null;
  memoryMb: number | null;
  totalMemoryMb: number;
  javaMajor: number | null;
  exit: CrashExit;
  uptimeMs: number | null;
  cause: CrashCause;
  rule: string | null;
  evidence: string | null;
  fixes: CrashFix[];
  autoFixable: boolean;
  files: { log: boolean; crashReport: boolean; jvmReport: boolean };
}

export interface CrashReportPackage {
  format: 1;
  created_at: string;
  launcher: { name: string; version: string };
  system: { platform: string; arch: string; release: string; total_memory_mb: number };
  game: {
    instance_kind: 'server';
    server_id: number | null;
    minecraft: string | null;
    loader: string;
    java_major: number | null;
    memory_mb: number | null;
  };
  exit: { code: number | null; signal: string | null; uptime_s: number | null };
  cause: { code: CrashCauseCode; rule: string | null; evidence: string | null };
  mods: string[];
  log_tail: string[];
  crash_report: string[];
  jvm_report: string[];
}

export interface CrashReportPreview {
  path: string;
  bytes: number;
  report: CrashReportPackage;
}

export interface CrashFixRequest {
  analysisId: string;
  fix: number;
  relaunch?: boolean;
}

export interface CrashFixOutcome {
  fix: CrashFix;
  report: CrashReportPreview | null;
  relaunched?: boolean;
}

export type CrashError =
  | { code: 'invalid-request'; field: string }
  | { code: 'analysis-not-found' }
  | { code: 'fix-not-available' }
  | { code: 'outside-game-dir' }
  | { code: 'file-missing'; file: string }
  | { code: 'file-locked'; file: string }
  | { code: 'game-running' }
  | { code: 'busy' }
  | { code: 'launch'; error: LaunchError }
  | { code: 'failed'; message: string };

export type CrashResult<T> = { ok: true; value: T } | { ok: false; error: CrashError };

export interface CrashEvent {
  kind: 'analyzed';
  analysis: CrashAnalysis;
}

export interface CrashService {
  last: () => Promise<CrashResult<CrashAnalysis | null>>;
  apply: (request: CrashFixRequest) => Promise<CrashResult<CrashFixOutcome>>;
  report: (analysisId: string) => Promise<CrashResult<CrashReportPreview>>;
  onEvent: (listener: (event: CrashEvent) => void) => () => void;
}

export const CRASH_ANALYSIS_ID_PATTERN = /^[a-z0-9-]{8,64}$/;

export const GAME_DIALOG_RULE = 'game-dialog';

const UINT32 = 2 ** 32;
const INT32_MAX = 2 ** 31 - 1;

// Node reports a Windows exit code as unsigned: the game's -1 arrives as 4294967295.
export function signedExitCode(code: number): number {
  return code > INT32_MAX && code < UINT32 ? code - UINT32 : code;
}

export function isCrash(analysis: CrashAnalysis): boolean {
  return analysis.cause.code !== 'closed';
}

export function isAutomaticFix(fix: CrashFix): boolean {
  return AUTOMATIC_FIXES.includes(fix.type);
}
