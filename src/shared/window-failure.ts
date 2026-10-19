export type WindowFailureKind = 'gone' | 'load' | 'hang' | 'boot' | 'gpu';

export interface WindowFailure {
  kind: WindowFailureKind;
  reason: string | null;
  exitCode: number | null;
  errorCode: number | null;
  url: string;
}

export interface WindowFailureReport {
  type: 'window.failed';
  at: string;
  kind: WindowFailureKind;
  reason: string | null;
  exit_code: number | null;
  error_code: number | null;
  screen: string;
  game_running: boolean;
  launcher: string;
  os: string;
  os_release: string;
  arch: string;
}

export interface WindowReportContext {
  at: string;
  gameRunning: boolean;
  launcher: string;
  os: string;
  osRelease: string;
  arch: string;
}

export const WINDOW_REPORTS_ENV = 'MCMONITOR_WINDOW_REPORTS';

declare const __WINDOW_REPORTS__: string | undefined;

// Off until the site has an intake for the launcher's own failures: nothing is sent and
// nothing is promised to the player.
export function windowReportsEnabled(
  built: string | undefined = typeof __WINDOW_REPORTS__ === 'string'
    ? __WINDOW_REPORTS__
    : undefined,
): boolean {
  return built === 'on';
}

// Origin and path only: a query or a hash may carry a search text or a server address.
export function safeWindowUrl(url: string): string {
  const parsed = URL.parse(url);
  if (parsed === null) {
    return 'invalid';
  }
  const known = ['app:', 'http:', 'https:'].includes(parsed.protocol);
  return known ? `${parsed.protocol}//${parsed.host}${parsed.pathname}` : parsed.protocol;
}

export function screenOfUrl(url: string): string {
  const route = URL.parse(url)?.hash.replace(/^#\/?/, '') ?? '';
  const first = route.split(/[/?]/)[0] ?? '';
  if (first === '') {
    return 'home';
  }
  return /^[a-z][a-z-]{0,23}$/.test(first) ? first : 'other';
}

export function windowFailureLine(failure: WindowFailure): string {
  const parts = [
    `window: ${failure.kind}`,
    failure.reason === null ? null : `reason=${failure.reason}`,
    failure.exitCode === null ? null : `exitCode=${String(failure.exitCode)}`,
    failure.errorCode === null ? null : `errorCode=${String(failure.errorCode)}`,
    `url=${safeWindowUrl(failure.url)}`,
  ];
  return parts.filter((part) => part !== null).join(' ');
}

const CONSOLE_LINE_MAX = 300;

// The renderer console is the only trace of an error a screen boundary has caught; a stack
// would bring file paths into the log, so only the first line is kept.
export function windowConsoleLine(message: string): string {
  const first = message.split('\n')[0]?.trim() ?? '';
  const short =
    first.length > CONSOLE_LINE_MAX ? `${first.slice(0, CONSOLE_LINE_MAX - 1)}…` : first;
  return `window: console ${short}`;
}

export function windowFailureReport(
  failure: WindowFailure,
  context: WindowReportContext,
): WindowFailureReport {
  return {
    type: 'window.failed',
    at: context.at,
    kind: failure.kind,
    reason: failure.reason,
    exit_code: failure.exitCode,
    error_code: failure.errorCode,
    screen: screenOfUrl(failure.url),
    game_running: context.gameRunning,
    launcher: context.launcher,
    os: context.os,
    os_release: context.osRelease,
    arch: context.arch,
  };
}
