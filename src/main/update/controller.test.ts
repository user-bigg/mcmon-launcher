import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { LaunchPhase } from '@shared/launch';
import {
  UPDATE_BASE_URL,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_MS,
  type UpdateState,
} from '@shared/update';
import {
  engineChannel,
  UpdateController,
  updateErrorCode,
  type EngineEvent,
  type SignatureFetch,
  type UpdatePreferences,
  type UpdaterEngine,
} from './controller';
import { generateUpdateKeys, privateKeyFromBase64, signRelease } from './signature';

const KEYS = generateUpdateKeys();
const PRIVATE = privateKeyFromBase64(KEYS.privateKey);
const FILE = '/tmp/pending/mcmonitor-launcher-0.2.0-win-x64.exe';

function sha(text: string): string {
  return createHash('sha512').update(text).digest('base64');
}

function info(version = '0.2.0', sha512 = sha(version)): unknown {
  return {
    version,
    files: [{ url: `mcmonitor-launcher-${version}-win-x64.exe`, sha512, size: 10 }],
    releaseNotes: '<p>Fixes</p>',
  };
}

function signatureOf(version = '0.2.0', sha512 = sha(version)): SignatureFetch {
  return { ok: true, text: signRelease({ version, sha512 }, PRIVATE) };
}

class FakeEngine implements UpdaterEngine {
  channel = '';
  installOnQuit = false;
  installed = 0;
  checks = 0;
  downloads = 0;
  private listener: ((event: EngineEvent) => void) | null = null;
  setChannel = (channel: string): void => {
    this.channel = channel;
  };
  check = (): Promise<void> => {
    this.checks += 1;
    return Promise.resolve();
  };
  download = (): Promise<void> => {
    this.downloads += 1;
    return Promise.resolve();
  };
  installResult = true;
  prepared: string[] = [];
  prepareError: Error | null = null;
  installNow = (): boolean => {
    this.installed += 1;
    return this.installResult;
  };
  prepare = (file: string): Promise<void> => {
    this.prepared.push(file);
    return this.prepareError === null ? Promise.resolve() : Promise.reject(this.prepareError);
  };
  setInstallOnQuit = (allowed: boolean): void => {
    this.installOnQuit = allowed;
  };
  onEvent = (listener: (event: EngineEvent) => void): void => {
    this.listener = listener;
  };
  emit(event: EngineEvent): void {
    this.listener?.(event);
  }
}

interface Setup {
  controller: UpdateController;
  engine: FakeEngine;
  states: UpdateState[];
  timers: { run: () => void; ms: number }[];
  removed: string[];
  logs: string[];
  skipped: string[];
  prefs: UpdatePreferences;
  setPhase: (phase: LaunchPhase) => void;
  signature: ReturnType<typeof vi.fn<(url: string) => Promise<SignatureFetch>>>;
  hash: { value: string };
}

function setup(
  options: {
    enabled?: boolean;
    prefs?: Partial<UpdatePreferences>;
    failedLoads?: number;
    background?: () => boolean;
    installBlocker?: () => 'move' | 'readonly' | null;
  } = {},
): Setup {
  let failedLoads = options.failedLoads ?? 0;
  const engine = new FakeEngine();
  const states: UpdateState[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const removed: string[] = [];
  const logs: string[] = [];
  const skipped: string[] = [];
  const prefs: UpdatePreferences = { channel: 'stable', autoDownload: true, ...options.prefs };
  let phase: LaunchPhase = 'idle';
  const hash = { value: sha('0.2.0') };
  const signature = vi.fn<(url: string) => Promise<SignatureFetch>>(() =>
    Promise.resolve(signatureOf()),
  );
  const controller = new UpdateController({
    enabled: options.enabled ?? true,
    currentVersion: '0.1.0',
    builtAt: '2026-10-03T09:00:00.000Z',
    platform: { os: 'win32', arch: 'x64' },
    base: UPDATE_BASE_URL,
    publicKey: KEYS.publicKey,
    loadEngine: (): Promise<UpdaterEngine> => {
      if (failedLoads > 0) {
        failedLoads -= 1;
        return Promise.reject(new Error('chunk is missing'));
      }
      return Promise.resolve(engine);
    },
    preferences: (): UpdatePreferences => ({ ...prefs }),
    skipped: {
      list: (): string[] => [...skipped],
      save: (versions): Promise<void> => {
        skipped.splice(0, skipped.length, ...versions);
        return Promise.resolve();
      },
    },
    launchPhase: (): LaunchPhase => phase,
    ...(options.background === undefined ? {} : { background: options.background }),
    ...(options.installBlocker === undefined ? {} : { installBlocker: options.installBlocker }),
    fetchSignature: signature,
    hashFile: (): Promise<string> => Promise.resolve(hash.value),
    removeFile: (path): Promise<void> => {
      removed.push(path);
      return Promise.resolve();
    },
    isOnline: (): boolean => true,
    now: (): number => Date.parse('2026-10-03T12:00:00Z'),
    setTimer: (run, ms): (() => void) => {
      timers.push({ run, ms });
      return (): void => undefined;
    },
    log: (message): void => {
      logs.push(message);
    },
  });
  controller.onEvent((state) => {
    states.push(state);
  });
  return {
    controller,
    engine,
    states,
    timers,
    removed,
    logs,
    skipped,
    prefs,
    setPhase: (next): void => {
      phase = next;
      controller.onLaunchPhase(next);
    },
    signature,
    hash,
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

async function available(s: Setup, version = '0.2.0'): Promise<void> {
  await s.controller.check();
  s.engine.emit({ type: 'checking' });
  s.engine.emit({ type: 'available', info: info(version) });
  await settle();
}

async function downloaded(s: Setup, version = '0.2.0'): Promise<void> {
  s.engine.emit({ type: 'downloaded', info: info(version), file: FILE });
  await settle();
}

describe('updates: states', () => {
  it('disabled in development: no timers and no engine', async () => {
    const s = setup({ enabled: false });
    s.controller.start();
    expect(s.timers).toHaveLength(0);
    expect((await s.controller.check()).status).toEqual({ kind: 'disabled' });
    expect(s.engine.checks).toBe(0);
  });

  it('first check after 30 s, then every 6 hours', async () => {
    const s = setup();
    s.controller.start();
    expect(s.timers.map((timer) => timer.ms)).toEqual([UPDATE_FIRST_CHECK_MS]);
    s.timers[0]?.run();
    await settle();
    expect(s.engine.checks).toBe(1);
    expect(s.engine.channel).toBe('latest');
    expect(s.timers.map((timer) => timer.ms)).toEqual([
      UPDATE_FIRST_CHECK_MS,
      UPDATE_CHECK_INTERVAL_MS,
    ]);
  });

  it('checking → none: check time in UTC', async () => {
    const s = setup();
    await s.controller.check();
    s.engine.emit({ type: 'checking' });
    expect(s.controller.state().status).toEqual({ kind: 'checking' });
    s.engine.emit({ type: 'not-available' });
    expect(s.controller.state()).toMatchObject({
      status: { kind: 'none' },
      checkedAt: '2026-10-03T12:00:00.000Z',
      current: { version: '0.1.0', builtAt: '2026-10-03T09:00:00.000Z', os: 'win32', arch: 'x64' },
    });
  });

  it('available → downloading → verifying → ready, signature is checked against the adjacent .sig', async () => {
    const s = setup();
    await available(s);
    expect(s.engine.downloads).toBe(1);
    expect(s.controller.state().status).toEqual({
      kind: 'downloading',
      version: '0.2.0',
      percent: 0,
    });
    s.engine.emit({ type: 'progress', percent: 41.7 });
    s.engine.emit({ type: 'progress', percent: 41.9 });
    expect(s.controller.state().status).toMatchObject({ kind: 'downloading', percent: 41 });
    const progressStates = s.states.filter((state) => state.status.kind === 'downloading');
    expect(progressStates).toHaveLength(2);
    await downloaded(s);
    expect(s.signature).toHaveBeenCalledWith(
      'https://mc-mon.ru/downloads/launcher/mcmonitor-launcher-0.2.0-win-x64.exe.sig',
    );
    expect(s.states.some((state) => state.status.kind === 'verifying')).toBe(true);
    expect(s.controller.state().status).toEqual({
      kind: 'ready',
      version: '0.2.0',
      notes: 'Fixes',
    });
    expect(s.removed).toEqual([]);
    expect(s.states.map((state) => state.seq)).toEqual(
      [...s.states.map((state) => state.seq)].sort((a, b) => a - b),
    );
  });

  it('without auto-download — only available, downloads via the button', async () => {
    const s = setup({ prefs: { autoDownload: false } });
    await available(s);
    expect(s.engine.downloads).toBe(0);
    expect(s.controller.state().status).toEqual({
      kind: 'available',
      version: '0.2.0',
      notes: 'Fixes',
    });
    await s.controller.download();
    expect(s.engine.downloads).toBe(1);
    expect(s.controller.state().status.kind).toBe('downloading');
  });

  it('errors by code: Windows signature, no network, other', () => {
    const signed = Object.assign(new Error('not signed by the application owner'), {
      code: 'ERR_UPDATER_INVALID_SIGNATURE',
    });
    expect(updateErrorCode(signed, true)).toBe('signature');
    expect(updateErrorCode(new Error('net::ERR_INTERNET_DISCONNECTED'), true)).toBe('offline');
    expect(updateErrorCode(new Error('anything'), false)).toBe('offline');
    expect(updateErrorCode(new Error('HttpError: 500'), true)).toBe('failed');
    expect(engineChannel('stable')).toBe('latest');
    expect(engineChannel('beta')).toBe('beta');
  });

  it('an error during download remembers the version', async () => {
    const s = setup();
    await available(s);
    s.engine.emit({ type: 'error', error: new Error('net::ERR_CONNECTION_RESET') });
    expect(s.controller.state().status).toEqual({
      kind: 'error',
      code: 'offline',
      version: '0.2.0',
    });
  });

  it('an installer without a Windows signature — the same version is not re-downloaded before restart', async () => {
    const s = setup();
    await available(s);
    const unsigned = Object.assign(new Error('not signed by the application owner'), {
      code: 'ERR_UPDATER_INVALID_SIGNATURE',
    });
    s.engine.emit({ type: 'error', error: unsigned });
    expect(s.controller.state().status).toEqual({
      kind: 'error',
      code: 'signature',
      version: '0.2.0',
    });
    s.engine.emit({ type: 'available', info: info() });
    await settle();
    expect(s.engine.downloads).toBe(1);
    expect(s.controller.state().status.kind).toBe('error');

    s.engine.emit({ type: 'available', info: info('0.2.1') });
    await settle();
    expect(s.engine.downloads).toBe(2);
  });
});

describe('updates: second signature', () => {
  it('signature mismatch — the file is deleted, not installed, the version is not downloaded again', async () => {
    const s = setup();
    s.signature.mockResolvedValue(signatureOf('0.2.0', sha('other')));
    await available(s);
    await downloaded(s);
    expect(s.controller.state().status).toEqual({
      kind: 'error',
      code: 'signature',
      version: '0.2.0',
    });
    expect(s.removed).toEqual([FILE]);
    expect(s.logs.some((line) => line.includes('rejected'))).toBe(true);
    expect(s.controller.installOnQuitAllowed()).toBe(false);
    s.controller.prepareQuit();
    expect(s.engine.installOnQuit).toBe(false);
    expect(await s.controller.restart()).toEqual({ ok: false, error: { code: 'not-ready' } });

    s.engine.emit({ type: 'available', info: info() });
    await settle();
    expect(s.engine.downloads).toBe(1);
    expect(s.controller.state().status.kind).toBe('error');
  });

  it('file does not match sha512 from latest.yml — rejected, even with a valid signature', async () => {
    const s = setup();
    s.hash.value = sha('tampered');
    await available(s);
    await downloaded(s);
    expect(s.controller.state().status).toMatchObject({ kind: 'error', code: 'signature' });
    expect(s.removed).toEqual([FILE]);
  });

  it("signature with someone else's key — rejected", async () => {
    const s = setup();
    const stranger = privateKeyFromBase64(generateUpdateKeys().privateKey);
    s.signature.mockResolvedValue({
      ok: true,
      text: signRelease({ version: '0.2.0', sha512: sha('0.2.0') }, stranger),
    });
    await available(s);
    await downloaded(s);
    expect(s.controller.state().status).toMatchObject({ kind: 'error', code: 'signature' });
  });

  it('.sig missing on the server — rejected; no network — the file remains but is not installed', async () => {
    const missing = setup();
    missing.signature.mockResolvedValue({ ok: false, reason: 'missing' });
    await available(missing);
    await downloaded(missing);
    expect(missing.controller.state().status).toMatchObject({ kind: 'error', code: 'signature' });
    expect(missing.removed).toEqual([FILE]);

    const offline = setup();
    offline.signature.mockResolvedValue({ ok: false, reason: 'offline' });
    await available(offline);
    await downloaded(offline);
    expect(offline.controller.state().status).toMatchObject({ kind: 'error', code: 'offline' });
    expect(offline.removed).toEqual([]);
    expect(offline.controller.installOnQuitAllowed()).toBe(false);
  });

  it('a connection drop while reading .sig — not a signature failure: the file remains, the check retries', async () => {
    const s = setup();
    s.signature.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'));
    await available(s);
    await downloaded(s);
    expect(s.controller.state().status).toMatchObject({ kind: 'error', code: 'offline' });
    expect(s.removed).toEqual([]);
    const retry = s.timers.at(-1);
    expect(retry?.ms).toBe(10 * 60_000);
    retry?.run();
    await settle();
    s.engine.emit({ type: 'available', info: info() });
    await settle();
    expect(s.engine.downloads).toBe(2);
    await downloaded(s);
    expect(s.controller.state().status).toMatchObject({ kind: 'ready', version: '0.2.0' });
    expect(s.controller.installOnQuitAllowed()).toBe(true);
  });
});

describe('updates: preparing and installing on macOS', () => {
  it('unpacks the verified file before it is ready; a failure there is an install error', async () => {
    const s = setup();
    await available(s);
    await downloaded(s);
    expect(s.engine.prepared).toEqual([FILE]);
    expect(s.controller.state().status).toMatchObject({ kind: 'ready', version: '0.2.0' });

    const t = setup();
    t.engine.prepareError = new Error('ditto could not unpack the update');
    await available(t);
    await downloaded(t);
    expect(t.controller.state().status).toEqual({
      kind: 'error',
      code: 'install',
      version: '0.2.0',
    });
    expect(await t.controller.restart()).toEqual({ ok: false, error: { code: 'not-ready' } });
  });

  it('a swap that cannot start is reported, not shown as ready again', async () => {
    const s = setup();
    await available(s);
    await downloaded(s);
    s.engine.installResult = false;
    expect(await s.controller.restart()).toEqual({ ok: false, error: { code: 'not-ready' } });
    expect(s.controller.state().status).toEqual({
      kind: 'error',
      code: 'install',
      version: '0.2.0',
    });
  });

  it('without a prepare step (Windows) the verified file is ready at once', async () => {
    const s = setup();
    Reflect.deleteProperty(s.engine, 'prepare');
    await available(s);
    await downloaded(s);
    expect(s.controller.state().status).toMatchObject({ kind: 'ready', version: '0.2.0' });
  });

  it('a version that failed to replace the app last time is not downloaded or offered again', async () => {
    const s = setup();
    s.controller.rememberFailedInstall('0.2.0');
    await available(s);
    expect(s.engine.downloads).toBe(0);
    expect(s.controller.state().status).toEqual({
      kind: 'error',
      code: 'install',
      version: '0.2.0',
    });
    await available(s, '0.2.1');
    expect(s.engine.downloads).toBe(1);
  });

  it('a failure mark for the running version or older is ignored', () => {
    const s = setup();
    s.controller.rememberFailedInstall('0.1.0');
    expect(s.controller.state().status).not.toMatchObject({ kind: 'error' });
  });

  it('an install error from the engine at quit does not fall back to ready', async () => {
    const s = setup();
    await available(s);
    await downloaded(s);
    s.engine.emit({ type: 'error', error: new Error('ERR_MAC_INSTALL the update is not ready') });
    expect(s.controller.state().status).toEqual({
      kind: 'error',
      code: 'install',
      version: '0.2.0',
    });
  });
});

describe('updates: a launcher that cannot replace itself', () => {
  it('reports the version and why, and downloads nothing', async () => {
    let blocker: 'move' | 'readonly' | null = 'move';
    const s = setup({ installBlocker: () => blocker });
    await available(s);
    expect(s.controller.state().status).toEqual({ kind: 'error', code: 'move', version: '0.2.0' });
    expect(s.engine.downloads).toBe(0);
    await s.controller.download();
    expect(s.engine.downloads).toBe(0);
    blocker = null;
    await available(s);
    expect(s.engine.downloads).toBe(1);
  });
});

describe('updates: installing and playing', () => {
  it('a ready update is installed on exit if the game is not running', async () => {
    const s = setup();
    await available(s);
    await downloaded(s);
    expect(s.engine.installOnQuit).toBe(true);
    s.controller.prepareQuit();
    expect(s.engine.installOnQuit).toBe(true);
    s.setPhase('running');
    s.controller.prepareQuit();
    expect(s.engine.installOnQuit).toBe(false);
    s.setPhase('idle');
    s.controller.prepareQuit();
    expect(s.engine.installOnQuit).toBe(true);
  });

  it("'Restart now' is unavailable during gameplay and installation", async () => {
    const s = setup();
    await available(s);
    await downloaded(s);
    s.setPhase('running');
    expect(s.controller.state().blocked).toBe('game');
    expect(await s.controller.restart()).toEqual({
      ok: false,
      error: { code: 'busy', blocked: 'game' },
    });
    s.setPhase('preparing');
    expect(await s.controller.restart()).toEqual({
      ok: false,
      error: { code: 'busy', blocked: 'install' },
    });
    expect(s.engine.installed).toBe(0);
    s.setPhase('idle');
    expect(await s.controller.restart()).toEqual({ ok: true });
    expect(s.engine.installed).toBe(1);
  });

  it('does not download during gameplay, starts after the game exits', async () => {
    const s = setup();
    s.setPhase('running');
    await available(s);
    expect(s.engine.downloads).toBe(0);
    expect(s.controller.state().status.kind).toBe('available');
    s.setPhase('idle');
    await settle();
    expect(s.engine.downloads).toBe(1);
  });

  it('in the tray without a window only learns about an update, downloads once the window opens', async () => {
    let background = true;
    const s = setup({ background: () => background });
    await available(s);
    expect(s.engine.downloads).toBe(0);
    expect(s.controller.state().status.kind).toBe('available');
    background = false;
    s.controller.onForeground();
    await settle();
    expect(s.engine.downloads).toBe(1);
  });

  it('an error on the next check does not cancel a ready update', async () => {
    const s = setup();
    await available(s);
    await downloaded(s);
    await s.controller.check();
    s.engine.emit({ type: 'checking' });
    s.engine.emit({ type: 'error', error: new Error('HttpError: 500') });
    expect(s.controller.state().status).toMatchObject({ kind: 'ready', version: '0.2.0' });
    s.engine.emit({ type: 'available', info: info() });
    await settle();
    expect(s.controller.state().status.kind).toBe('ready');
    expect(s.engine.downloads).toBe(1);
  });

  it('a new version on top of a ready one: the old installer is not installed on exit or manually', async () => {
    const s = setup();
    await available(s);
    await downloaded(s);
    expect(s.controller.installOnQuitAllowed()).toBe(true);
    s.prefs.autoDownload = false;
    await s.controller.check();
    s.engine.emit({ type: 'checking' });
    s.engine.emit({ type: 'available', info: info('0.2.1') });
    await settle();
    expect(s.controller.state().status).toMatchObject({ kind: 'available', version: '0.2.1' });
    expect(s.controller.installOnQuitAllowed()).toBe(false);
    s.controller.prepareQuit();
    expect(s.engine.installOnQuit).toBe(false);
    expect(await s.controller.restart()).toEqual({ ok: false, error: { code: 'not-ready' } });
    expect(s.engine.installed).toBe(0);
  });

  it('the engine failed to load — an error, the next check tries again', async () => {
    const s = setup({ failedLoads: 1 });
    await expect(s.controller.check()).rejects.toThrow('chunk is missing');
    expect(s.controller.state().status).toMatchObject({ kind: 'error', code: 'failed' });
    await s.controller.check();
    expect(s.engine.checks).toBe(1);
  });

  it('changing the channel switches the engine and checks again', async () => {
    const s = setup();
    await s.controller.check();
    s.engine.emit({ type: 'not-available' });
    const previous = { ...s.prefs };
    s.prefs.channel = 'beta';
    s.controller.onPreferencesChanged(previous);
    await settle();
    expect(s.engine.channel).toBe('beta');
    expect(s.engine.checks).toBe(2);
  });

  it('auto-download turned on — an available version starts downloading', async () => {
    const s = setup({ prefs: { autoDownload: false } });
    await available(s);
    const previous = { ...s.prefs };
    s.prefs.autoDownload = true;
    s.controller.onPreferencesChanged(previous);
    await settle();
    expect(s.engine.downloads).toBe(1);
  });
});

describe('updates: skip version', () => {
  it('a skipped version is not downloaded on its own and not installed on exit', async () => {
    const s = setup();
    await s.controller.skip('0.2.0');
    expect(s.skipped).toEqual(['0.2.0']);
    await available(s);
    expect(s.engine.downloads).toBe(0);
    expect(s.controller.state()).toMatchObject({
      status: { kind: 'available', version: '0.2.0' },
      skipped: ['0.2.0'],
    });
    await s.controller.unskip('0.2.0');
    await settle();
    expect(s.skipped).toEqual([]);
    expect(s.engine.downloads).toBe(1);
  });

  it('skipping a ready version — not installed on exit; a manual restart clears the skip', async () => {
    const s = setup();
    await available(s);
    await downloaded(s);
    await s.controller.skip('0.2.0');
    expect(s.controller.installOnQuitAllowed()).toBe(false);
    s.controller.prepareQuit();
    expect(s.engine.installOnQuit).toBe(false);
    expect(await s.controller.restart()).toEqual({ ok: true });
    expect(s.skipped).toEqual([]);
  });

  it('the skipped list has no duplicates and is no longer than 20', async () => {
    const s = setup();
    for (let i = 0; i < 25; i++) {
      await s.controller.skip(`0.${String(i)}.0`);
    }
    await s.controller.skip('0.24.0');
    expect(s.skipped).toHaveLength(20);
    expect(s.skipped.at(-1)).toBe('0.24.0');
    expect(new Set(s.skipped).size).toBe(20);
  });
});
