import type { LaunchError, NetworkErrorReason } from '@shared/launch';

export class LaunchFailure extends Error {
  constructor(readonly error: LaunchError) {
    super(error.code);
    this.name = 'LaunchFailure';
  }
}

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  path?: unknown;
  cause?: unknown;
  errors?: unknown;
  error?: unknown;
  statusCode?: unknown;
  downloadUrl?: unknown;
  downloadUrls?: unknown;
  destination?: unknown;
}

const NETWORK_CODES = new Map<string, NetworkErrorReason>([
  ['ENOTFOUND', 'dns'],
  ['EAI_AGAIN', 'dns'],
  ['EAI_FAIL', 'dns'],
  ['ETIMEDOUT', 'timeout'],
  ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
  ['UND_ERR_HEADERS_TIMEOUT', 'timeout'],
  ['UND_ERR_BODY_TIMEOUT', 'timeout'],
  ['ECONNRESET', 'connection'],
  ['ECONNREFUSED', 'connection'],
  ['ECONNABORTED', 'connection'],
  ['ENETUNREACH', 'connection'],
  ['ENETDOWN', 'connection'],
  ['EHOSTUNREACH', 'connection'],
  ['EHOSTDOWN', 'connection'],
  ['EPIPE', 'connection'],
  ['EPROTO', 'tls'],
  ['CERT_HAS_EXPIRED', 'tls'],
  ['CERT_NOT_YET_VALID', 'tls'],
  ['CERT_REVOKED', 'tls'],
  ['CERT_UNTRUSTED', 'tls'],
  ['CERT_REJECTED', 'tls'],
  ['CERT_SIGNATURE_FAILURE', 'tls'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls'],
  ['UNABLE_TO_GET_ISSUER_CERT', 'tls'],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'tls'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
]);
const PERMISSION_CODES = new Set(['EPERM', 'EACCES', 'EROFS']);
const TOO_MANY_FILES_CODES = new Set(['EMFILE', 'ENFILE']);
const PRIORITY: LaunchError['code'][] = [
  'cancelled',
  'disk-full',
  'permission-denied',
  'file-locked',
  'too-many-files',
  'checksum-mismatch',
  'loader-install-failed',
  'java-missing',
  'network',
  'version-not-found',
  'file-missing',
  'game-start-failed',
  'unknown',
];

// executeInstallManifest throws this message when a file was downloaded but its hash
// never matched.
const UNRECOVERED_FILES = /^Cannot recover \d+ install file\(s\): (.+)$/s;

// Chromium (net.fetch) reports network errors as a `net::ERR_…` string, without a code.
const CHROMIUM_NET_ERROR = /net::ERR_([A-Z0-9_]+)/;

function asErrorLike(value: unknown): ErrorLike | null {
  return typeof value === 'object' && value !== null ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function firstUrl(error: ErrorLike): string | null {
  const direct = text(error.downloadUrl);
  if (direct !== null) {
    return direct;
  }
  const list = text(error.downloadUrls);
  if (list === null) {
    return null;
  }
  try {
    const urls: unknown = JSON.parse(list);
    return Array.isArray(urls) ? text(urls[0]) : null;
  } catch {
    return null;
  }
}

function network(error: ErrorLike, reason: NetworkErrorReason): LaunchError {
  return { code: 'network', url: firstUrl(error), reason };
}

function networkReasonOf(code: string): NetworkErrorReason | null {
  const known = NETWORK_CODES.get(code);
  if (known !== undefined) {
    return known;
  }
  if (code.startsWith('ERR_SSL_') || code.startsWith('ERR_TLS_')) {
    return 'tls';
  }
  if (code.startsWith('UND_ERR_PRX')) {
    return 'proxy';
  }
  return code.startsWith('UND_ERR_') ? 'connection' : null;
}

function chromiumReason(name: string): NetworkErrorReason {
  if (name.includes('CERT') || name.includes('SSL')) {
    return 'tls';
  }
  if (name.includes('PROXY') || name.includes('TUNNEL')) {
    return 'proxy';
  }
  if (name.includes('NAME_NOT_RESOLVED') || name.includes('NAME_RESOLUTION')) {
    return 'dns';
  }
  return name.includes('TIMED_OUT') ? 'timeout' : 'connection';
}

function fromFileCode(code: string, error: ErrorLike): LaunchError | null {
  const path = text(error.path);
  if (code === 'ENOSPC') {
    return { code: 'disk-full', path, bytesNeeded: null };
  }
  if (PERMISSION_CODES.has(code)) {
    return { code: 'permission-denied', path };
  }
  if (code === 'EBUSY') {
    return { code: 'file-locked', path };
  }
  if (code === 'ENOENT') {
    return { code: 'file-missing', path };
  }
  return TOO_MANY_FILES_CODES.has(code) ? { code: 'too-many-files' } : null;
}

function fromCode(error: ErrorLike): LaunchError | null {
  const code = text(error.code);
  if (code === null) {
    return null;
  }
  if (code === 'ABORT_ERR') {
    return { code: 'cancelled' };
  }
  const reason = networkReasonOf(code);
  return reason === null ? fromFileCode(code, error) : network(error, reason);
}

function fromShape(error: ErrorLike): LaunchError | null {
  if (error.name === 'AbortError') {
    return { code: 'cancelled' };
  }
  if (error.name === 'TimeoutError') {
    return network(error, 'timeout');
  }
  const chromium = CHROMIUM_NET_ERROR.exec(text(error.message) ?? '');
  if (chromium?.[1] !== undefined) {
    return chromium[1] === 'ABORTED'
      ? { code: 'cancelled' }
      : network(error, chromiumReason(chromium[1]));
  }
  if (error.error === 'CorruptedVersionJar') {
    return { code: 'checksum-mismatch', file: 'client.jar' };
  }
  if (error.error === 'MissingLibraries') {
    return { code: 'game-start-failed', message: 'MissingLibraries' };
  }
  const unrecovered = UNRECOVERED_FILES.exec(text(error.message) ?? '');
  if (unrecovered?.[1] !== undefined) {
    return { code: 'checksum-mismatch', file: unrecovered[1].split(', ')[0] ?? unrecovered[1] };
  }
  if (typeof error.statusCode === 'number') {
    return network(error, 'http');
  }
  return error.name === 'DownloadError' ? network(error, 'connection') : null;
}

function fetchFailed(error: ErrorLike): LaunchError | null {
  return error.message === 'fetch failed' ? network(error, 'connection') : null;
}

function mostImportant(errors: LaunchError[]): LaunchError | null {
  const ranked = [...errors].sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code));
  return ranked[0] ?? null;
}

function unknownError(value: unknown): LaunchError {
  const message = text(asErrorLike(value)?.message) ?? String(value);
  return { code: 'unknown', message: message.split('\n')[0] ?? message };
}

function classify(value: unknown, depth: number): LaunchError | null {
  if (value instanceof LaunchFailure) {
    return value.error;
  }
  const error = asErrorLike(value);
  if (error === null || depth > 5) {
    return null;
  }
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    const nested = error.errors
      .map((item: unknown) => classify(item, depth + 1))
      .filter((item): item is LaunchError => item !== null);
    const best = mostImportant(nested);
    if (best !== null) {
      return best;
    }
  }
  const direct = fromCode(error) ?? fromShape(error);
  if (direct !== null) {
    return direct;
  }
  const cause = error.cause === undefined ? null : classify(error.cause, depth + 1);
  if (cause?.code === 'network' && cause.url === null) {
    return { ...cause, url: firstUrl(error) };
  }
  return cause ?? fetchFailed(error);
}

export function toLaunchError(value: unknown): LaunchError {
  return classify(value, 0) ?? unknownError(value);
}

export function failure(error: LaunchError): LaunchFailure {
  return new LaunchFailure(error);
}
