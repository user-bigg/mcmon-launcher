import {
  windowFailureLine,
  type WindowFailure,
  type WindowFailureKind,
} from '@shared/window-failure';

export const RETRY_WINDOW_MS = 60_000;
export const BOOT_GRACE_MS = 8_000;
export const UNRESPONSIVE_GRACE_MS = 10_000;
export const RECOVERY_ACTION_PREFIX = 'app://launcher/~recovery/';
const ERR_ABORTED = -3;
const FIRST_HTTP_ERROR = 400;

export type RecoveryAction = 'restart' | 'close';

export interface RecoveryView {
  kind: WindowFailureKind;
  playing: boolean;
  reported: boolean;
}

export interface RecoveryDeps {
  appUrl: string;
  loadApp: () => void;
  showPage: (view: RecoveryView) => void;
  closeWindow: () => void;
  crashRenderer: () => void;
  playing: () => boolean;
  report: ((failure: WindowFailure) => void) | null;
  log: (line: string) => void;
  now: () => number;
  setTimer: (action: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

export interface GoneDetails {
  reason: string;
  exitCode: number;
}

export interface LoadFailure {
  errorCode: number;
  description: string;
  url: string;
  isMainFrame: boolean;
}

function samePage(left: string, right: string): boolean {
  const a = URL.parse(left);
  const b = URL.parse(right);
  if (a === null || b === null) {
    return false;
  }
  const path = (url: URL): string => (url.pathname === '/' ? '/index.html' : url.pathname);
  return a.origin === b.origin && a.protocol === b.protocol && path(a) === path(b);
}

export function recoveryAction(url: string): RecoveryAction | null {
  if (!url.startsWith(RECOVERY_ACTION_PREFIX)) {
    return null;
  }
  const action = url.slice(RECOVERY_ACTION_PREFIX.length);
  return action === 'restart' || action === 'close' ? action : null;
}

export class WindowRecovery {
  private showing: RecoveryView | null = null;
  private pageRedrawn = false;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private mounted = false;
  private hung = false;
  private currentUrl: string;
  private bootTimer: unknown = null;
  private hangTimer: unknown = null;

  constructor(private readonly deps: RecoveryDeps) {
    this.currentUrl = deps.appUrl;
  }

  get shown(): RecoveryView | null {
    return this.showing;
  }

  gone(details: GoneDetails): void {
    this.stopTimers();
    if (details.reason === 'clean-exit') {
      return;
    }
    const kind = this.hung ? 'hang' : 'gone';
    this.hung = false;
    if (this.showing !== null) {
      this.redrawPage();
      return;
    }
    this.fail({ kind, reason: details.reason, exitCode: details.exitCode });
  }

  // The window shows a black rectangle when the graphics process dies under a live renderer,
  // and no renderer event comes; a hidden window has nothing to repaint.
  gpuGone(details: GoneDetails, visible: boolean): void {
    if (visible && this.showing === null && details.reason !== 'clean-exit') {
      this.fail({ kind: 'gpu', reason: details.reason, exitCode: details.exitCode });
    }
  }

  loadFailed(failure: LoadFailure): void {
    if (!failure.isMainFrame || failure.errorCode === ERR_ABORTED || this.showing !== null) {
      return;
    }
    this.currentUrl = failure.url;
    this.fail({ kind: 'load', reason: failure.description, errorCode: failure.errorCode });
  }

  navigated(url: string, httpStatus: number): void {
    this.currentUrl = url;
    if (this.showing === null && httpStatus >= FIRST_HTTP_ERROR) {
      this.fail({ kind: 'load', reason: `http-${String(httpStatus)}` });
    }
  }

  navigatedInPage(url: string): void {
    this.currentUrl = url;
  }

  navigationStarted(): void {
    this.mounted = false;
    this.stopTimers();
  }

  loaded(url: string): void {
    if (this.showing !== null || this.mounted || !samePage(url, this.deps.appUrl)) {
      return;
    }
    this.clear('bootTimer');
    this.bootTimer = this.deps.setTimer(() => {
      this.bootTimer = null;
      this.fail({ kind: 'boot', reason: 'not-mounted' });
    }, BOOT_GRACE_MS);
  }

  ready(): void {
    this.mounted = true;
    this.clear('bootTimer');
  }

  bootFailed(): void {
    if (this.showing === null && !this.mounted) {
      this.clear('bootTimer');
      this.fail({ kind: 'boot', reason: 'start-failed' });
    }
  }

  unresponsive(): void {
    if (this.hangTimer !== null) {
      return;
    }
    this.hangTimer = this.deps.setTimer(() => {
      this.hangTimer = null;
      this.hang();
    }, UNRESPONSIVE_GRACE_MS);
  }

  responsive(): void {
    this.clear('hangTimer');
  }

  act(url: string): boolean {
    const action = this.showing === null ? null : recoveryAction(url);
    if (action === 'restart') {
      this.restart();
    } else if (action === 'close') {
      this.deps.closeWindow();
    }
    return action !== null;
  }

  dispose(): void {
    this.stopTimers();
  }

  private restart(): void {
    this.showing = null;
    this.pageRedrawn = false;
    this.lastAttemptAt = this.deps.now();
    this.deps.loadApp();
  }

  // The renderer of a hung page cannot be reloaded: it is ended first, and the exit that
  // follows is counted as this hang, not as a crash of its own.
  private hang(): void {
    this.hung = true;
    this.deps.crashRenderer();
  }

  private fail(partial: Partial<WindowFailure> & Pick<WindowFailure, 'kind'>): void {
    const failure: WindowFailure = {
      reason: null,
      exitCode: null,
      errorCode: null,
      url: this.currentUrl,
      ...partial,
    };
    this.stopTimers();
    this.deps.log(windowFailureLine(failure));
    this.deps.report?.(failure);
    const now = this.deps.now();
    if (now - this.lastAttemptAt < RETRY_WINDOW_MS) {
      this.showing = {
        kind: failure.kind,
        playing: this.deps.playing(),
        reported: this.deps.report !== null,
      };
      this.pageRedrawn = false;
      this.deps.showPage(this.showing);
      return;
    }
    this.lastAttemptAt = now;
    this.deps.loadApp();
  }

  private redrawPage(): void {
    if (this.showing === null || this.pageRedrawn) {
      return;
    }
    this.pageRedrawn = true;
    this.deps.showPage(this.showing);
  }

  private clear(name: 'bootTimer' | 'hangTimer'): void {
    if (this[name] !== null) {
      this.deps.clearTimer(this[name]);
      this[name] = null;
    }
  }

  private stopTimers(): void {
    this.clear('bootTimer');
    this.clear('hangTimer');
  }
}
