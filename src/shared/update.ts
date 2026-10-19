export const UPDATE_BASE_URL = 'https://mc-mon.ru/downloads/launcher/';
export const UPDATE_FIRST_CHECK_MS = 30_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 3_600_000;
export const MAX_SKIPPED_VERSIONS = 20;
export const MAX_VERSION_LENGTH = 64;
export const MAX_RELEASE_NOTES_LENGTH = 2_000;

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export const UPDATE_ERROR_CODES = [
  'offline',
  'signature',
  'failed',
  'move',
  'readonly',
  'install',
] as const;
export type UpdateErrorCode = (typeof UPDATE_ERROR_CODES)[number];

export type UpdateStatus =
  | { kind: 'disabled' }
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'verifying'; version: string }
  | { kind: 'ready'; version: string; notes: string | null }
  | { kind: 'error'; code: UpdateErrorCode; version: string | null };

export type UpdateBlock = 'game' | 'install' | null;

export interface LauncherBuild {
  version: string;
  builtAt: string | null;
  os: string;
  arch: string;
}

export interface UpdateState {
  seq: number;
  status: UpdateStatus;
  current: LauncherBuild;
  skipped: string[];
  checkedAt: string | null;
  blocked: UpdateBlock;
}

export type RestartError = { code: 'busy'; blocked: 'game' | 'install' } | { code: 'not-ready' };

export type RestartResult = { ok: true } | { ok: false; error: RestartError };

export interface UpdateService {
  state: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  skip: (version: string) => Promise<UpdateState>;
  unskip: (version: string) => Promise<UpdateState>;
  restart: () => Promise<RestartResult>;
}

export interface UpdateApi extends UpdateService {
  onEvent: (listener: (state: UpdateState) => void) => () => void;
}

export function isUpdateVersion(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_VERSION_LENGTH && VERSION_PATTERN.test(value)
  );
}

export function statusVersion(status: UpdateStatus): string | null {
  return 'version' in status ? status.version : null;
}

export function isSkipped(state: UpdateState): boolean {
  const version = statusVersion(state.status);
  return version !== null && state.skipped.includes(version);
}

// Numeric parts first; a pre-release sorts before the release of the same numbers.
export function compareUpdateVersions(left: string, right: string): number {
  const [leftCore = '', leftPre] = left.split('-', 2);
  const [rightCore = '', rightPre] = right.split('-', 2);
  const leftParts = leftCore.split('.').map(Number);
  const rightParts = rightCore.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  if (leftPre === rightPre) {
    return 0;
  }
  if (leftPre === undefined) {
    return 1;
  }
  return rightPre === undefined ? -1 : Math.sign(leftPre.localeCompare(rightPre));
}
