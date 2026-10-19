import { statfs } from 'node:fs/promises';
import { getCACertificates } from 'node:tls';
import {
  createFileTransferInstallDownload,
  createNodeInstallRuntime,
  executeInstallManifest,
  ProgressTrackerMultiple,
  type InstallEvent,
  type InstallFile,
  type InstallManifest,
  type InstallMaterializeOperation,
  type InstallRuntime,
} from '@xmcl/installer';
import { Agent, interceptors, ProxyAgent, type Dispatcher, type RetryHandler } from 'undici';
import { failure } from './errors';
import { withFsRetry } from './fs-retry';
import { DIRECT_NETWORK, type NetworkSetup } from './network';

export { DIRECT_NETWORK, proxyFromPac, type NetworkSetup } from './network';

const MAX_CONCURRENCY = 16;
const DISK_RESERVE_BYTES = 256 * 1024 * 1024;
const CONNECTIONS = 16;
const MAX_REDIRECTIONS = 5;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5000;

// By default undici waits 5 minutes for headers and for each next body chunk; a stalled
// connection must be dropped after 30 s and retried, resuming via Range.
export const HEADERS_TIMEOUT_MS = 30_000;
export const BODY_STALL_TIMEOUT_MS = 30_000;

const RETRY_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETDOWN',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'EPIPE',
]);
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const LINK_UNSUPPORTED_CODES = new Set([
  'EXDEV',
  'EPERM',
  'EACCES',
  'ENOTSUP',
  'ENOSYS',
  'EINVAL',
  'EMLINK',
  'EISDIR',
]);

export interface TransferCounters {
  onPlanned: (bytes: number) => void;
  onQueued: (bytes: number) => void;
  onRetry?: () => void;
}

export interface TrackedRuntime {
  runtime: InstallRuntime;
  downloadedBytes: () => number;
  execute: (plan: InstallManifest) => Promise<void>;
  onInstallEvent: (event: InstallEvent) => void;
}

export function sizeOf(files: readonly InstallFile[]): number {
  return files.reduce((total, file) => total + Math.max(0, file.size ?? 0), 0);
}

export function filesPlan(id: string, files: InstallFile[]): InstallManifest {
  return { schemaVersion: 1, tasks: [{ id, type: 'files', files }] };
}

export type FreeSpace = (path: string) => Promise<number>;

const statFreeSpace: FreeSpace = async (path) => {
  const info = await statfs(path);
  return info.bavail * info.bsize;
};

export async function ensureFreeSpace(
  root: string,
  bytes: number,
  freeSpace: FreeSpace = statFreeSpace,
): Promise<void> {
  if (bytes <= 0) {
    return;
  }
  let free: number;
  try {
    free = await freeSpace(root);
  } catch {
    return;
  }
  const needed = bytes + DISK_RESERVE_BYTES;
  if (free < needed) {
    throw failure({ code: 'disk-full', path: root, bytesNeeded: needed });
  }
}

let trusted: string[] | undefined | null = null;

export function trustedCertificates(): string[] | undefined {
  if (trusted !== null) {
    return trusted;
  }
  try {
    trusted = [...new Set([...getCACertificates('default'), ...getCACertificates('system')])];
  } catch {
    trusted = undefined;
  }
  return trusted;
}

const agents = new Map<string, Dispatcher>();

function baseAgent(network: NetworkSetup): Dispatcher {
  const key = network.proxyUrl ?? 'direct';
  const existing = agents.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const ca = trustedCertificates();
  const tls = ca === undefined ? {} : { ca };
  const options = {
    connections: CONNECTIONS,
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_STALL_TIMEOUT_MS,
  };
  const agent =
    network.proxyUrl === null
      ? new Agent({ ...options, connect: tls })
      : new ProxyAgent({ ...options, uri: network.proxyUrl, requestTls: tls, proxyTls: tls });
  agents.set(key, agent);
  return agent;
}

export async function closeDownloadAgents(): Promise<void> {
  const closing = [...agents.values()].map((agent) => agent.close().catch(() => undefined));
  agents.clear();
  await Promise.all(closing);
}

export function retryDelayMs(counter: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, counter - 1), RETRY_MAX_DELAY_MS);
}

export function shouldRetryRequest(error: unknown, counter: number): boolean {
  const { code, statusCode } = (error ?? {}) as { code?: unknown; statusCode?: unknown };
  if (typeof code === 'string' && code !== 'UND_ERR_REQ_RETRY' && !RETRY_ERROR_CODES.has(code)) {
    return false;
  }
  if (typeof statusCode === 'number' && !RETRY_STATUS_CODES.has(statusCode)) {
    return false;
  }
  return counter <= MAX_RETRIES;
}

function retryCallback(onRetry: () => void): RetryHandler.RetryCallback {
  return (error, { state }, callback) => {
    if (!shouldRetryRequest(error, state.counter)) {
      callback(error);
      return;
    }
    onRetry();
    setTimeout(() => {
      callback(null);
    }, retryDelayMs(state.counter));
  };
}

export function downloadDispatcher(network: NetworkSetup, onRetry: () => void): Dispatcher {
  return baseAgent(network).compose(
    interceptors.retry({ maxRetries: MAX_RETRIES, retry: retryCallback(onRetry) }),
    interceptors.redirect({ maxRedirections: MAX_REDIRECTIONS }),
  );
}

function errorCode(error: unknown): string | null {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  return typeof code === 'string' ? code : null;
}

function linkAsCopy(operation: InstallMaterializeOperation): InstallMaterializeOperation {
  return operation.type === 'link'
    ? { type: 'copy', source: operation.source, path: operation.path }
    : operation;
}

// Hard links do not work on FAT32, exFAT and some network drives; materialize rolls back
// everything it did on failure, so retrying with a copy instead of a link is safe.
export function resilientRuntime(runtime: InstallRuntime): InstallRuntime {
  return {
    ...runtime,
    materialize: async (
      operations: InstallMaterializeOperation[],
    ): ReturnType<InstallRuntime['materialize']> => {
      try {
        return await withFsRetry(() => runtime.materialize(operations));
      } catch (error) {
        const code = errorCode(error);
        const hasLinks = operations.some((operation) => operation.type === 'link');
        if (!hasLinks || code === null || !LINK_UNSUPPORTED_CODES.has(code)) {
          throw error;
        }
        return withFsRetry(() => runtime.materialize(operations.map(linkAsCopy)));
      }
    },
  };
}

export function createTrackedRuntime(
  root: string,
  signal: AbortSignal,
  counters: TransferCounters,
  network: NetworkSetup = DIRECT_NETWORK,
): TrackedRuntime {
  const onRetry = (): void => {
    counters.onRetry?.();
  };
  const tracker = new ProgressTrackerMultiple();
  const transfer = createFileTransferInstallDownload({
    signal,
    tracker,
    maxConcurrency: MAX_CONCURRENCY,
    dispatcher: downloadDispatcher(network, onRetry),
  });
  const download = async (files: InstallFile[]): Promise<void> => {
    const bytes = sizeOf(files);
    await ensureFreeSpace(root, bytes);
    counters.onQueued(bytes);
    await transfer(files);
  };
  const runtime = resilientRuntime(createNodeInstallRuntime({ signal, download }));
  const onInstallEvent = (event: InstallEvent): void => {
    if (event.type === 'task-start' && event.task.type === 'files') {
      counters.onPlanned(sizeOf(event.task.files));
    }
    if (event.type === 'file-retry') {
      onRetry();
    }
  };
  return {
    runtime,
    downloadedBytes: () => tracker.progress,
    onInstallEvent,
    execute: async (plan): Promise<void> => {
      await executeInstallManifest(plan, runtime, { signal, onEvent: onInstallEvent });
    },
  };
}
