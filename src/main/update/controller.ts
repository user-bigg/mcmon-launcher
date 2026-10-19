import type { LaunchPhase } from '@shared/launch';
import type { Channel } from '@shared/settings';
import {
  compareUpdateVersions,
  MAX_SKIPPED_VERSIONS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_MS,
  type RestartResult,
  type UpdateBlock,
  type UpdateErrorCode,
  type UpdateState,
  type UpdateStatus,
} from '@shared/update';
import {
  installerRelease,
  releaseNotes,
  type InstallerExtension,
  type InstallerRelease,
} from './release';
import { verifyRelease } from './signature';
import { logTextOf } from './log-text';

export type EngineEvent =
  | { type: 'checking' }
  | { type: 'available'; info: unknown }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; info: unknown; file: string }
  | { type: 'error'; error: unknown };

export interface UpdaterEngine {
  setChannel: (channel: string) => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  installNow: () => boolean;
  prepare?: (file: string, version: string) => Promise<void>;
  cancelRestart?: () => void;
  setInstallOnQuit: (allowed: boolean) => void;
  onEvent: (listener: (event: EngineEvent) => void) => void;
}

export type SignatureFetch =
  { ok: true; text: string } | { ok: false; reason: 'offline' | 'missing' };

export interface UpdatePreferences {
  channel: Channel;
  autoDownload: boolean;
}

export interface SkippedStore {
  list: () => string[];
  save: (versions: string[]) => Promise<void>;
}

export interface UpdateControllerOptions {
  enabled: boolean;
  currentVersion: string;
  builtAt: string | null;
  platform: { os: string; arch: string };
  base: string;
  installerExtension?: InstallerExtension;
  installBlocker?: () => 'move' | 'readonly' | null;
  publicKey: string;
  loadEngine: () => Promise<UpdaterEngine>;
  preferences: () => UpdatePreferences;
  skipped: SkippedStore;
  launchPhase: () => LaunchPhase;
  background?: () => boolean;
  fetchSignature: (url: string) => Promise<SignatureFetch>;
  hashFile: (path: string) => Promise<string>;
  removeFile: (path: string) => Promise<void>;
  isOnline: () => boolean;
  now: () => number;
  setTimer: (run: () => void, ms: number) => () => void;
  log: (message: string) => void;
}

const SIGNATURE_RETRY_MS = 10 * 60_000;

const OFFLINE_ERRORS =
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_|TIMED_OUT|PROXY_|ADDRESS_UNREACHABLE)|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/;

export function engineChannel(channel: Channel): string {
  return channel === 'stable' ? 'latest' : channel;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${code} ${error.message}` : error.message;
  }
  return String(error);
}

export function updateErrorCode(error: unknown, online: boolean): UpdateErrorCode {
  const text = errorText(error);
  if (text.includes('ERR_UPDATER_INVALID_SIGNATURE')) {
    return 'signature';
  }
  if (text.includes('ERR_MAC_INSTALL')) {
    return 'install';
  }
  if (!online || OFFLINE_ERRORS.test(text)) {
    return 'offline';
  }
  return 'failed';
}

function blockOf(phase: LaunchPhase): UpdateBlock {
  if (phase === 'running') {
    return 'game';
  }
  return phase === 'preparing' ? 'install' : null;
}

function isBusy(status: UpdateStatus): boolean {
  return status.kind === 'checking' || status.kind === 'downloading' || status.kind === 'verifying';
}

export class UpdateController {
  private status: UpdateStatus;
  private seq = 0;
  private checkedAt: string | null = null;
  private engine: Promise<UpdaterEngine> | null = null;
  private loaded: UpdaterEngine | null = null;
  private verified: string | null = null;
  private offer: InstallerRelease | null = null;
  private notes: string | null = null;
  private downloadAfterGame = false;
  private readonly rejected = new Set<string>();
  private readonly listeners = new Set<(state: UpdateState) => void>();
  private cancelTimer: (() => void) | null = null;
  private disposed = false;
  private failedInstall: string | null = null;

  constructor(private readonly options: UpdateControllerOptions) {
    this.status = options.enabled ? { kind: 'idle' } : { kind: 'disabled' };
  }

  start(): void {
    if (this.options.enabled) {
      this.schedule(UPDATE_FIRST_CHECK_MS);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  onEvent(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  state(): UpdateState {
    return {
      seq: this.seq,
      status: this.status,
      current: {
        version: this.options.currentVersion,
        builtAt: this.options.builtAt,
        ...this.options.platform,
      },
      skipped: this.options.skipped.list(),
      checkedAt: this.checkedAt,
      blocked: blockOf(this.options.launchPhase()),
    };
  }

  async check(): Promise<UpdateState> {
    if (!this.options.enabled || isBusy(this.status)) {
      return this.state();
    }
    const engine = await this.ensureEngine();
    await engine.check();
    return this.state();
  }

  async download(): Promise<UpdateState> {
    if (this.status.kind !== 'available' || this.offer === null) {
      return this.state();
    }
    await this.startDownload(this.offer);
    return this.state();
  }

  async skip(version: string): Promise<UpdateState> {
    const skipped = this.options.skipped.list().filter((entry) => entry !== version);
    skipped.push(version);
    await this.options.skipped.save(skipped.slice(-MAX_SKIPPED_VERSIONS));
    this.emit();
    return this.state();
  }

  async unskip(version: string): Promise<UpdateState> {
    const skipped = this.options.skipped.list();
    if (skipped.includes(version)) {
      await this.options.skipped.save(skipped.filter((entry) => entry !== version));
      this.emit();
      this.maybeAutoDownload();
    }
    return this.state();
  }

  async restart(): Promise<RestartResult> {
    const blocked = blockOf(this.options.launchPhase());
    if (blocked !== null) {
      return { ok: false, error: { code: 'busy', blocked } };
    }
    const ready = this.readyVersion();
    if (ready === null || this.loaded === null) {
      return { ok: false, error: { code: 'not-ready' } };
    }
    if (this.options.skipped.list().includes(ready)) {
      await this.unskip(ready);
    }
    if (!this.loaded.installNow()) {
      this.failInstall(ready);
      return { ok: false, error: { code: 'not-ready' } };
    }
    return { ok: true };
  }

  // A swap after the last quit could not put this version in place; offering it again would
  // only repeat the failure, so the player is sent to the download page instead.
  rememberFailedInstall(version: string): void {
    if (compareUpdateVersions(version, this.options.currentVersion) <= 0) {
      return;
    }
    this.failedInstall = version;
    this.failInstall(version);
  }

  cancelRestart(): void {
    this.loaded?.cancelRestart?.();
  }

  onLaunchPhase(phase: LaunchPhase): void {
    if (phase === 'idle' && this.downloadAfterGame) {
      this.downloadAfterGame = false;
      this.maybeAutoDownload();
    }
    this.emit();
  }

  // A launcher waiting in the tray only learns about an update; the installer is downloaded
  // once its window is opened.
  onForeground(): void {
    this.maybeAutoDownload();
  }

  onPreferencesChanged(previous: UpdatePreferences): void {
    const next = this.options.preferences();
    if (next.channel !== previous.channel && this.engine !== null) {
      void this.engine
        .then(async (engine) => {
          engine.setChannel(engineChannel(next.channel));
          if (!isBusy(this.status)) {
            await this.check();
          }
        })
        .catch((error: unknown) => {
          this.options.log(`update: channel change failed ${logTextOf(error)}`);
        });
    }
    if (next.autoDownload && !previous.autoDownload) {
      this.maybeAutoDownload();
    }
  }

  installOnQuitAllowed(): boolean {
    const ready = this.readyVersion();
    return (
      ready !== null &&
      this.options.launchPhase() !== 'running' &&
      !this.options.skipped.list().includes(ready)
    );
  }

  // Runs synchronously from the app "quit" listener registered before electron-updater's own,
  // so the updater reads the final decision when it decides whether to start the installer.
  prepareQuit(): void {
    this.loaded?.setInstallOnQuit(this.installOnQuitAllowed());
  }

  private failInstall(version: string | null): void {
    this.verified = null;
    this.setStatus({ kind: 'error', code: 'install', version });
  }

  private releaseOf(info: unknown): InstallerRelease | null {
    return installerRelease(info, this.options.base, this.options.installerExtension);
  }

  private readyVersion(): string | null {
    return this.status.kind === 'ready' && this.status.version === this.verified
      ? this.verified
      : null;
  }

  private schedule(ms: number): void {
    this.cancelTimer?.();
    this.cancelTimer = this.options.setTimer(() => {
      this.cancelTimer = null;
      if (this.disposed) {
        return;
      }
      void this.check()
        .catch((error: unknown) => {
          this.options.log(`update: check failed ${logTextOf(error)}`);
        })
        .finally(() => {
          if (!this.disposed) {
            this.schedule(UPDATE_CHECK_INTERVAL_MS);
          }
        });
    }, ms);
  }

  private ensureEngine(): Promise<UpdaterEngine> {
    this.engine ??= this.options.loadEngine().then(
      (engine) => {
        engine.setChannel(engineChannel(this.options.preferences().channel));
        engine.setInstallOnQuit(true);
        engine.onEvent((event) => {
          this.onEngineEvent(event);
        });
        this.loaded = engine;
        return engine;
      },
      (error: unknown) => {
        this.engine = null;
        this.options.log(`update: engine is unavailable ${logTextOf(error)}`);
        this.setStatus({ kind: 'error', code: 'failed', version: null });
        throw error;
      },
    );
    return this.engine;
  }

  private onEngineEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'checking':
        if (!isBusy(this.status) && this.verified === null) {
          this.setStatus({ kind: 'checking' });
        }
        return;
      case 'not-available':
        this.checkedAt = new Date(this.options.now()).toISOString();
        this.verified = null;
        this.setStatus({ kind: 'none' });
        return;
      case 'available':
        this.checkedAt = new Date(this.options.now()).toISOString();
        this.onAvailable(event.info);
        return;
      case 'progress':
        this.onProgress(event.percent);
        return;
      case 'downloaded':
        void this.verify(event.info, event.file);
        return;
      case 'error':
        this.onError(event.error);
        return;
    }
  }

  private onAvailable(info: unknown): void {
    const release = this.releaseOf(info);
    if (release === null) {
      this.options.log('update: latest.yml has no installer under the update URL');
      this.setStatus({ kind: 'error', code: 'failed', version: null });
      return;
    }
    if (this.verified === release.version) {
      this.setStatus({ kind: 'ready', version: release.version, notes: this.notes });
      return;
    }
    if (this.verified !== null) {
      this.options.log(`update: ${this.verified} is superseded by ${release.version}`);
      this.verified = null;
    }
    if (this.status.kind === 'downloading' || this.status.kind === 'verifying') {
      return;
    }
    if (this.failedInstall === release.version) {
      this.offer = null;
      this.failInstall(release.version);
      return;
    }
    const blocker = this.options.installBlocker?.() ?? null;
    if (blocker !== null) {
      this.offer = null;
      this.setStatus({ kind: 'error', code: blocker, version: release.version });
      return;
    }
    this.offer = release;
    this.notes = releaseNotes((info as { releaseNotes?: unknown }).releaseNotes);
    if (this.rejected.has(release.sha512)) {
      this.setStatus({ kind: 'error', code: 'signature', version: release.version });
      return;
    }
    this.setStatus({ kind: 'available', version: release.version, notes: this.notes });
    this.maybeAutoDownload();
  }

  private maybeAutoDownload(): void {
    const offer = this.offer;
    if (
      this.status.kind !== 'available' ||
      offer === null ||
      !this.options.preferences().autoDownload ||
      this.options.skipped.list().includes(offer.version) ||
      this.options.background?.() === true
    ) {
      return;
    }
    if (this.options.launchPhase() === 'running') {
      this.downloadAfterGame = true;
      return;
    }
    void this.startDownload(offer).catch((error: unknown) => {
      this.options.log(`update: download failed ${logTextOf(error)}`);
    });
  }

  private async startDownload(offer: InstallerRelease): Promise<void> {
    this.verified = null;
    this.setStatus({ kind: 'downloading', version: offer.version, percent: 0 });
    const engine = await this.ensureEngine();
    await engine.download();
  }

  private onProgress(percent: number): void {
    if (this.status.kind !== 'downloading') {
      return;
    }
    const rounded = Math.min(100, Math.max(0, Math.floor(percent)));
    if (rounded !== this.status.percent) {
      this.setStatus({ ...this.status, percent: rounded });
    }
  }

  private onError(error: unknown): void {
    const code = updateErrorCode(error, this.options.isOnline());
    this.options.log(`update: ${code} ${logTextOf(error)}`);
    if (code === 'install') {
      this.failInstall(this.verified);
      return;
    }
    if (this.verified !== null) {
      this.setStatus({ kind: 'ready', version: this.verified, notes: this.notes });
      return;
    }
    const version =
      this.status.kind === 'downloading' || this.status.kind === 'verifying'
        ? this.status.version
        : null;
    if (code === 'signature' && version !== null && this.offer?.version === version) {
      this.rejected.add(this.offer.sha512);
    }
    this.setStatus({ kind: 'error', code, version });
  }

  private async verify(info: unknown, file: string): Promise<void> {
    const release = this.releaseOf(info);
    if (release === null) {
      await this.reject(file, null, null, 'update info has no installer under the update URL');
      return;
    }
    this.setStatus({ kind: 'verifying', version: release.version });
    try {
      const [signature, sha512] = await Promise.all([
        this.options
          .fetchSignature(release.signatureUrl)
          .catch((): SignatureFetch => ({ ok: false, reason: 'offline' })),
        this.options.hashFile(file),
      ]);
      if (sha512 !== release.sha512) {
        await this.reject(file, release.version, release.sha512, 'sha512 differs from latest.yml');
        return;
      }
      if (!signature.ok && signature.reason === 'offline') {
        this.options.log(`update: ${release.version} signature is unreachable, retry later`);
        this.setStatus({ kind: 'error', code: 'offline', version: release.version });
        this.schedule(SIGNATURE_RETRY_MS);
        return;
      }
      if (!signature.ok) {
        await this.reject(file, release.version, sha512, 'signature file is missing');
        return;
      }
      const valid = verifyRelease(
        { version: release.version, sha512 },
        signature.text,
        this.options.publicKey,
      );
      if (!valid) {
        await this.reject(file, release.version, sha512, 'ed25519 signature does not verify');
        return;
      }
      if (this.failedInstall === release.version) {
        this.options.log(`update: ${release.version} could not be put in place before`);
        this.failInstall(release.version);
        return;
      }
      if (this.loaded?.prepare !== undefined) {
        try {
          await this.loaded.prepare(file, release.version);
        } catch (error) {
          this.options.log(`update: ${release.version} cannot be prepared ${logTextOf(error)}`);
          this.failInstall(release.version);
          return;
        }
      }
      this.verified = release.version;
      this.setStatus({ kind: 'ready', version: release.version, notes: this.notes });
    } catch (error) {
      await this.reject(file, release.version, release.sha512, logTextOf(error));
    }
  }

  private async reject(
    file: string,
    version: string | null,
    sha512: string | null,
    reason: string,
  ): Promise<void> {
    this.options.log(`update: ${version ?? 'unknown'} rejected, ${reason}`);
    this.verified = null;
    if (sha512 !== null) {
      this.rejected.add(sha512);
    }
    this.setStatus({ kind: 'error', code: 'signature', version });
    await this.options.removeFile(file).catch((error: unknown) => {
      this.options.log(`update: cannot remove ${file} ${logTextOf(error)}`);
    });
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    this.seq += 1;
    const state = this.state();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
