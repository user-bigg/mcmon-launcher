import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '@shared/ipc';

class FakeContents extends EventEmitter {
  url = '';
  loading = false;
  devTools = false;
  readonly sent: [string, unknown][] = [];
  readonly forcefullyCrashRenderer = vi.fn();
  readonly setVisualZoomLevelLimits = vi.fn(() => Promise.resolve());

  isDestroyed(): boolean {
    return false;
  }

  isLoading(): boolean {
    return this.loading;
  }

  isDevToolsOpened(): boolean {
    return this.devTools;
  }

  getURL(): string {
    return this.url;
  }

  send(channel: string, payload: unknown): void {
    this.sent.push([channel, payload]);
  }
}

class FakeWindow extends EventEmitter {
  static all: FakeWindow[] = [];
  readonly webContents = new FakeContents();
  readonly loaded: string[] = [];
  readonly show = vi.fn(() => {
    this.visible = true;
  });
  readonly close = vi.fn();
  visible = false;
  minimized = false;

  constructor(readonly options: Record<string, unknown>) {
    super();
    FakeWindow.all.push(this);
  }

  static getAllWindows(): FakeWindow[] {
    return FakeWindow.all;
  }

  loadURL(url: string): Promise<void> {
    this.loaded.push(url);
    this.webContents.url = url;
    return Promise.resolve();
  }

  isDestroyed(): boolean {
    return false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isMinimized(): boolean {
    return this.minimized;
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  screen: {
    getPrimaryDisplay: (): object => ({ workAreaSize: { width: 1920, height: 1080 } }),
  },
}));
vi.mock('./app-icon', () => ({ windowIcon: (): object => ({}) }));

const { createMainWindow, reportBoot, reportGpuGone } = await import('./window');
const { BOOT_GRACE_MS, RECOVERY_ACTION_PREFIX, UNRESPONSIVE_GRACE_MS } =
  await import('./recovery/recovery');

const APP = 'app://launcher/index.html';
const CRASH = { reason: 'crashed', exitCode: 5 };

function open(options: Partial<Parameters<typeof createMainWindow>[0]> = {}): FakeWindow {
  return createMainWindow({ devServerUrl: undefined, ...options }) as unknown as FakeWindow;
}

function pages(window: FakeWindow): string[] {
  return window.loaded.map((url) => (url.startsWith('data:') ? 'recovery' : url));
}

function asContents(window: FakeWindow): Parameters<typeof reportBoot>[0] {
  return window.webContents as unknown as Parameters<typeof reportBoot>[0];
}

beforeEach(() => {
  FakeWindow.all = [];
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the main window and its recovery', () => {
  it('a lost renderer is reloaded, a second loss shows the page drawn by main', () => {
    const window = open();
    window.webContents.emit('render-process-gone', {}, CRASH);
    expect(pages(window)).toEqual([APP, APP]);
    window.webContents.emit('render-process-gone', {}, CRASH);
    expect(pages(window)).toEqual([APP, APP, 'recovery']);
    expect(window.show).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      'window: gone reason=crashed exitCode=5 url=app://launcher/index.html',
    );
  });

  it('the links of the page are taken by main and never followed', () => {
    const window = open();
    window.webContents.emit('render-process-gone', {}, CRASH);
    window.webContents.emit('render-process-gone', {}, CRASH);
    const restart = { preventDefault: vi.fn() };
    window.webContents.emit('will-navigate', restart, `${RECOVERY_ACTION_PREFIX}restart`);
    expect(restart.preventDefault).toHaveBeenCalledOnce();
    expect(pages(window).at(-1)).toBe(APP);
    const ordinary = { preventDefault: vi.fn() };
    window.webContents.emit('will-navigate', ordinary, `${RECOVERY_ACTION_PREFIX}close`);
    expect(ordinary.preventDefault).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it('the close link closes the window while the page is shown', () => {
    const window = open();
    window.webContents.emit('render-process-gone', {}, CRASH);
    window.webContents.emit('render-process-gone', {}, CRASH);
    window.webContents.emit(
      'will-navigate',
      { preventDefault: vi.fn() },
      `${RECOVERY_ACTION_PREFIX}close`,
    );
    expect(window.close).toHaveBeenCalledOnce();
  });

  it('a window hidden for the game is not pulled out by the page and goes back to the empty route', () => {
    const window = open({ canShow: () => false, idle: () => true });
    window.webContents.emit('render-process-gone', {}, CRASH);
    expect(window.webContents.sent).toEqual([[IpcChannels.app.navigate, { kind: 'idle' }]]);
    window.webContents.emit('render-process-gone', {}, CRASH);
    expect(pages(window).at(-1)).toBe('recovery');
    expect(window.show).not.toHaveBeenCalled();
  });

  it('a shown window gets no empty route after a reload', () => {
    const window = open({ idle: () => false });
    window.webContents.emit('render-process-gone', {}, CRASH);
    expect(window.webContents.sent).toEqual([]);
  });

  it('a failed load and a missing file both count', () => {
    const window = open();
    window.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', APP, true);
    expect(pages(window)).toEqual([APP, APP]);
    window.webContents.emit('did-navigate', {}, APP, 404);
    expect(pages(window).at(-1)).toBe('recovery');
  });

  it('a hung window is ended after the grace time, but not while the debugger holds it', () => {
    const window = open();
    window.webContents.devTools = true;
    window.emit('unresponsive');
    vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS * 2);
    expect(window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled();
    window.webContents.devTools = false;
    window.emit('unresponsive');
    vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS);
    expect(window.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce();
    window.emit('unresponsive');
    window.emit('responsive');
    vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS);
    expect(window.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce();
  });

  it('a page that never reports its start is reloaded; a report in time stops the wait', () => {
    const silent = open();
    silent.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    silent.webContents.emit('did-finish-load');
    vi.advanceTimersByTime(BOOT_GRACE_MS);
    expect(pages(silent)).toEqual([APP, APP]);

    const fine = open();
    fine.webContents.emit('did-finish-load');
    reportBoot(asContents(fine), true);
    vi.advanceTimersByTime(BOOT_GRACE_MS);
    expect(pages(fine)).toEqual([APP]);

    const broken = open();
    reportBoot(asContents(broken), false);
    expect(pages(broken)).toEqual([APP, APP]);
  });

  it('a lost graphics process reloads only a window that is on the screen', () => {
    const hidden = open();
    const shown = open();
    shown.visible = true;
    const minimized = open();
    minimized.visible = true;
    minimized.minimized = true;
    reportGpuGone({ reason: 'crashed', exitCode: 133 });
    expect(pages(hidden)).toEqual([APP]);
    expect(pages(minimized)).toEqual([APP]);
    expect(pages(shown)).toEqual([APP, APP]);
    reportGpuGone({ reason: 'crashed', exitCode: 133 });
    expect(pages(shown).at(-1)).toBe('recovery');
  });

  it('an error in the renderer console reaches the log of main, one line of it', () => {
    const window = open();
    window.webContents.emit('console-message', { level: 'info', message: 'ready' });
    expect(console.warn).not.toHaveBeenCalled();
    window.webContents.emit('console-message', {
      level: 'error',
      message: 'Error: screen\n    at setup (app.js:1)',
    });
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('window: console Error: screen');
  });

  it('the development window has no page of the build to lean on and still recovers', () => {
    const window = open({ devServerUrl: 'http://localhost:5190' });
    window.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'x', true);
    window.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'x', true);
    expect(pages(window)).toEqual(['http://localhost:5190', 'http://localhost:5190', 'recovery']);
  });
});
