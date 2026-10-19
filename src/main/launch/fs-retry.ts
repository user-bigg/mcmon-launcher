import { setTimeout as sleep } from 'node:timers/promises';

const TRANSIENT_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const BACKOFF_MS = [50, 100, 200, 400, 800, 1000, 1000, 1000];

export interface FsRetryOptions {
  platform?: NodeJS.Platform;
  backoffMs?: readonly number[];
}

export function isTransientFsError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

// Windows antivirus and the indexer keep a fresh file open for hundreds of milliseconds:
// rename and writes fail with EPERM/EACCES/EBUSY meanwhile. Retry with a pause, as graceful-fs.
export async function withFsRetry<T>(
  operation: () => Promise<T>,
  options: FsRetryOptions = {},
): Promise<T> {
  if ((options.platform ?? process.platform) !== 'win32') {
    return operation();
  }
  const backoff = options.backoffMs ?? BACKOFF_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = backoff[attempt];
      if (delay === undefined || !isTransientFsError(error)) {
        throw error;
      }
      await sleep(delay);
    }
  }
}

export async function bestEffort(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch {
    return false;
  }
}
