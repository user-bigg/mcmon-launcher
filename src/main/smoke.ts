import { app, ipcMain, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { IpcChannels, SMOKE_CLI_ARGUMENT } from '@shared/ipc';
import { isTrustedSender } from './ipc';

export const SMOKE_ENV = 'MCMONITOR_SMOKE';
export const SMOKE_REPORT_ENV = 'MCMONITOR_SMOKE_REPORT';
export const SMOKE_TIMEOUT_MS = 20_000;

export interface SmokeReport {
  readyToShowMs: number;
  loadedMs: number;
  handshakeMs: number;
  engineMs: number;
}

export function isSmokeRun(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  return env[SMOKE_ENV] === '1' && argv.includes(SMOKE_CLI_ARGUMENT);
}

function since(): number {
  return Math.round(performance.now());
}

function once(register: (done: () => void) => void): Promise<number> {
  return new Promise((resolve) => {
    register(() => {
      resolve(since());
    });
  });
}

function writeReport(report: SmokeReport | null): boolean {
  const file = process.env[SMOKE_REPORT_ENV];
  if (file === undefined || file.length === 0 || report === null) {
    return true;
  }
  try {
    writeFileSync(file, JSON.stringify(report));
    return true;
  } catch {
    return false;
  }
}

function finish(code: number, report: SmokeReport | null): void {
  try {
    const line = report === null ? 'smoke: failed' : `smoke: ok ${JSON.stringify(report)}`;
    process.stdout.write(`${line}\n`);
    const written = writeReport(report);
    app.exit(written ? code : 1);
  } catch {
    app.exit(1);
  }
}

export function failSmoke(): void {
  finish(1, null);
}

export function watchSmoke(
  window: BrowserWindow,
  devServerUrl: string | undefined,
  loadEngine: () => Promise<unknown>,
): void {
  const timeout = setTimeout(() => {
    finish(1, null);
  }, SMOKE_TIMEOUT_MS);
  const readyToShow = once((done) => window.once('ready-to-show', done));
  const loaded = once((done) => window.webContents.once('did-finish-load', done));
  const handshake = once((done) => {
    ipcMain.on(IpcChannels.smoke.ready, (event, payload: unknown) => {
      const mounted =
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { mounted?: unknown }).mounted === true;
      if (isTrustedSender(event, devServerUrl) && mounted) {
        done();
      }
    });
  });
  const engine = handshake.then(async () => {
    const started = performance.now();
    await loadEngine();
    return Math.round(performance.now() - started);
  });
  window.webContents.once('did-fail-load', () => {
    clearTimeout(timeout);
    finish(1, null);
  });
  Promise.all([readyToShow, loaded, handshake, engine]).then(
    ([readyToShowMs, loadedMs, handshakeMs, engineMs]) => {
      clearTimeout(timeout);
      finish(0, { readyToShowMs, loadedMs, handshakeMs, engineMs });
    },
    () => {
      clearTimeout(timeout);
      finish(1, null);
    },
  );
}
