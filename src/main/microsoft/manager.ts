import {
  MAX_MICROSOFT_ACCOUNTS,
  MICROSOFT_LOGIN_TIMEOUT_MS,
  type MicrosoftAccount,
  type MicrosoftChange,
  type MicrosoftError,
  type MicrosoftErrorCode,
  type MicrosoftEvent,
  type MicrosoftLoginState,
  type MicrosoftResult,
  type MicrosoftState,
} from '@shared/microsoft';
import { createPkce, type Pkce } from '../account/pkce';
import type { FetchLike } from '../launch/json-cache';
import { minecraftSession, type MinecraftSession } from './chain';
import { redirectUri } from './config';
import { microsoftCodeOf, microsoftFailure, microsoftRejected } from './errors';
import { authorizeUrl, exchangeCode, refreshTokens } from './oauth';
import type { RedirectListener, RedirectOptions, RedirectOutcome } from './redirect';
import type { LoadedMicrosoft, StoredMicrosoftAccount } from './store';

export interface MicrosoftAccountStore {
  available: () => boolean;
  load: () => Promise<LoadedMicrosoft>;
  save: (accounts: StoredMicrosoftAccount[]) => Promise<boolean>;
}

export interface MicrosoftDeps {
  clientId: string | null;
  store: MicrosoftAccountStore;
  fetch: FetchLike;
  openBrowser: (url: string) => Promise<boolean>;
  listen: (options: RedirectOptions) => Promise<RedirectListener>;
  now: () => number;
  log: (message: string) => void;
  pkce?: () => Pkce;
  loginTimeoutMs?: number;
}

export interface GameAuth {
  nick: string;
  uuid: string;
  accessToken: string;
}

interface Pending {
  pkce: Pkce;
  listener: RedirectListener;
  url: string;
  expiresAt: number;
  phase: MicrosoftLoginState['phase'];
}

// A launch may spend a long time downloading files before the game reads the token.
const FRESH_MARGIN_MS = 30 * 60_000;

const OUTCOME_ERRORS: Record<
  Exclude<RedirectOutcome['kind'], 'code' | 'closed'>,
  MicrosoftErrorCode
> = {
  denied: 'cancelled',
  rejected: 'failed',
  timeout: 'timeout',
  'state-mismatch': 'state_mismatch',
};

const STORAGE_ERRORS: Record<Exclude<LoadedMicrosoft['kind'], 'loaded'>, MicrosoftErrorCode> = {
  locked: 'encryption_unavailable',
  unreadable: 'storage_failed',
};

function accountIdOf(uuid: string): string {
  return `ms-${uuid}`;
}

function dashed(uuid: string): string {
  return uuid.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

export class MicrosoftManager {
  private accounts: StoredMicrosoftAccount[] = [];
  private storage: LoadedMicrosoft['kind'] = 'unreadable';
  private loading: Promise<void> | null = null;
  private starting: Promise<unknown> = Promise.resolve();
  private writing: Promise<unknown> = Promise.resolve();
  private unsaved = false;
  private pending: Pending | null = null;
  private error: MicrosoftError | null = null;
  private seq = 0;
  private readonly sessions = new Map<string, MinecraftSession>();
  private readonly refreshing = new Map<string, Promise<MinecraftSession>>();
  private readonly listeners = new Set<(event: MicrosoftEvent) => void>();

  constructor(private readonly deps: MicrosoftDeps) {
    void this.ready();
  }

  onEvent(listener: (event: MicrosoftEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  async state(): Promise<MicrosoftState> {
    await this.ready();
    return this.snapshot();
  }

  async has(id: string): Promise<boolean> {
    await this.ready();
    return this.accounts.some((account) => account.id === id);
  }

  // Sign-ins start one after another: a second click while the port is still opening would
  // otherwise find it taken by our own first attempt.
  login(): Promise<MicrosoftResult<MicrosoftState>> {
    const run = this.starting.then(() => this.startLogin());
    this.starting = run.catch(() => undefined);
    return run;
  }

  // The same page with the same state: a tab left from the first try stays valid, while a new
  // sign-in would turn its answer into a state mismatch.
  async reopen(): Promise<MicrosoftResult<MicrosoftState>> {
    await this.starting;
    const pending = this.pending;
    if (pending?.phase !== 'waiting') {
      return microsoftRejected('cancelled');
    }
    const opened = await this.deps.openBrowser(pending.url).catch(() => false);
    return opened ? { ok: true, value: this.snapshot() } : microsoftRejected('browser_failed');
  }

  async cancel(): Promise<MicrosoftState> {
    await this.starting;
    await this.ready();
    await this.stopPending();
    this.error = null;
    this.emit('changed');
    return this.snapshot();
  }

  async remove(id: string): Promise<MicrosoftResult<MicrosoftState>> {
    await this.ready();
    const previous = this.accounts;
    if (!previous.some((account) => account.id === id)) {
      return microsoftRejected('not_found');
    }
    this.accounts = previous.filter((account) => account.id !== id);
    const failed = await this.persist();
    if (failed !== null) {
      this.accounts = previous;
      return microsoftRejected(failed);
    }
    this.sessions.delete(id);
    this.refreshing.delete(id);
    this.emit('removed', id);
    return { ok: true, value: this.snapshot() };
  }

  async gameAuth(id: string): Promise<GameAuth> {
    await this.ready();
    if (this.deps.clientId === null) {
      throw microsoftFailure('unavailable');
    }
    if (this.storage !== 'loaded') {
      throw microsoftFailure(STORAGE_ERRORS[this.storage]);
    }
    if (this.unsaved) {
      await this.persist();
    }
    const account = this.accounts.find((entry) => entry.id === id);
    if (account === undefined) {
      throw microsoftFailure('not_found');
    }
    const cached = this.sessions.get(id);
    const session =
      cached !== undefined && cached.expiresAt - this.deps.now() > FRESH_MARGIN_MS
        ? cached
        : await this.refreshOnce(account, this.deps.clientId);
    return { nick: session.nick, uuid: session.uuid, accessToken: session.accessToken };
  }

  // A file that could not be read this time (busy, no keychain yet) is read again on the next
  // call instead of being treated as empty.
  private ready(): Promise<void> {
    if (this.storage === 'loaded') {
      return Promise.resolve();
    }
    this.loading ??= this.restore().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async restore(): Promise<void> {
    const loaded = await this.deps.store
      .load()
      .catch((): LoadedMicrosoft => ({ kind: 'unreadable' }));
    this.storage = loaded.kind;
    if (loaded.kind === 'loaded') {
      this.accounts = [...loaded.accounts];
    }
  }

  private async startLogin(): Promise<MicrosoftResult<MicrosoftState>> {
    await this.ready();
    if (this.pending !== null) {
      await this.stopPending();
      this.emit('changed');
    }
    const { clientId } = this.deps;
    if (clientId === null) {
      return this.fail('unavailable');
    }
    if (this.storage !== 'loaded') {
      return this.fail(STORAGE_ERRORS[this.storage]);
    }
    if (!this.deps.store.available()) {
      return this.fail('encryption_unavailable');
    }
    const pkce = (this.deps.pkce ?? createPkce)();
    const timeoutMs = this.deps.loginTimeoutMs ?? MICROSOFT_LOGIN_TIMEOUT_MS;
    let listener: RedirectListener;
    try {
      listener = await this.deps.listen({ state: pkce.state, timeoutMs });
    } catch (error) {
      return this.fail(microsoftCodeOf(error));
    }
    const url = authorizeUrl({
      clientId,
      challenge: pkce.challenge,
      state: pkce.state,
      redirectUri: redirectUri(listener.port),
    });
    const pending: Pending = {
      pkce,
      listener,
      url,
      expiresAt: this.deps.now() + timeoutMs,
      phase: 'waiting',
    };
    this.pending = pending;
    void this.complete(pending, clientId);
    const opened = await this.deps.openBrowser(url).catch(() => false);
    if (this.pending !== pending) {
      return microsoftRejected(this.error?.code ?? 'cancelled');
    }
    if (!opened) {
      await this.stopPending();
      return this.fail('browser_failed');
    }
    this.error = null;
    this.emit('changed');
    return { ok: true, value: this.snapshot() };
  }

  private async complete(pending: Pending, clientId: string): Promise<void> {
    const outcome = await pending.listener.result;
    if (this.pending !== pending || outcome.kind === 'closed') {
      return;
    }
    if (outcome.kind !== 'code') {
      this.pending = null;
      this.failed(OUTCOME_ERRORS[outcome.kind]);
      return;
    }
    pending.phase = 'exchanging';
    this.emit('changed');
    try {
      const tokens = await exchangeCode(
        this.deps.fetch,
        clientId,
        outcome.code,
        pending.pkce.verifier,
        redirectUri(pending.listener.port),
      );
      const session = await minecraftSession(this.deps.fetch, tokens.accessToken, this.deps.now);
      if (this.pending !== pending) {
        return;
      }
      const id = await this.adopt(session, tokens.refreshToken);
      this.pending = null;
      this.error = null;
      this.emit('signed-in', id);
    } catch (error) {
      if (this.pending === pending) {
        this.pending = null;
        this.failed(microsoftCodeOf(error));
      }
    }
  }

  private async adopt(session: MinecraftSession, refreshToken: string): Promise<string> {
    const id = accountIdOf(session.uuid);
    const previous = this.accounts;
    const known = previous.some((account) => account.id === id);
    if (!known && previous.length >= MAX_MICROSOFT_ACCOUNTS) {
      throw microsoftFailure('accounts_limit');
    }
    const record = { id, uuid: session.uuid, nick: session.nick, refreshToken };
    this.accounts = known
      ? previous.map((account) => (account.id === id ? record : account))
      : [...previous, record];
    const failed = await this.persist();
    if (failed !== null) {
      this.accounts = previous;
      throw microsoftFailure(failed);
    }
    this.sessions.set(id, session);
    return id;
  }

  private refreshOnce(
    account: StoredMicrosoftAccount,
    clientId: string,
  ): Promise<MinecraftSession> {
    const running = this.refreshing.get(account.id);
    if (running !== undefined) {
      return running;
    }
    const started = this.refresh(account, clientId).finally(() => {
      if (this.refreshing.get(account.id) === started) {
        this.refreshing.delete(account.id);
      }
    });
    this.refreshing.set(account.id, started);
    return started;
  }

  private async refresh(
    account: StoredMicrosoftAccount,
    clientId: string,
  ): Promise<MinecraftSession> {
    if (account.refreshToken === null) {
      throw microsoftFailure('relogin_required');
    }
    try {
      const tokens = await refreshTokens(this.deps.fetch, clientId, account.refreshToken);
      const session = await minecraftSession(this.deps.fetch, tokens.accessToken, this.deps.now);
      if (session.uuid !== account.uuid) {
        throw microsoftFailure('failed');
      }
      if (this.isCurrent(account)) {
        this.replace({ ...account, nick: session.nick, refreshToken: tokens.refreshToken });
        this.sessions.set(account.id, session);
        await this.persistLater();
        this.emit('changed');
      }
      return session;
    } catch (error) {
      if (microsoftCodeOf(error) === 'relogin_required') {
        await this.expire(account);
      }
      throw error;
    }
  }

  private async expire(account: StoredMicrosoftAccount): Promise<void> {
    if (!this.isCurrent(account)) {
      return;
    }
    this.deps.log('microsoft: refresh rejected, sign-in required');
    this.replace({ ...account, refreshToken: null });
    this.sessions.delete(account.id);
    await this.persistLater();
    this.emit('expired', account.id);
  }

  // A sign-in repeated while a refresh was on its way has already replaced the record: the
  // answer to the old refresh token must not touch the new one.
  private isCurrent(account: StoredMicrosoftAccount): boolean {
    return this.accounts.some(
      (entry) => entry.id === account.id && entry.refreshToken === account.refreshToken,
    );
  }

  private replace(record: StoredMicrosoftAccount): void {
    this.accounts = this.accounts.map((account) => (account.id === record.id ? record : account));
  }

  // Microsoft rotates the refresh token: when the file cannot be written now, the new token
  // stays in memory and the write is repeated before the next launch.
  private async persistLater(): Promise<void> {
    if ((await this.persist()) !== null) {
      this.unsaved = true;
      this.deps.log('microsoft: cannot save the sign-in, will retry');
    }
  }

  private persist(): Promise<MicrosoftErrorCode | null> {
    const run = this.writing.then(() => this.write());
    this.writing = run;
    return run;
  }

  private async write(): Promise<MicrosoftErrorCode | null> {
    if (this.storage !== 'loaded') {
      return STORAGE_ERRORS[this.storage];
    }
    try {
      if (!(await this.deps.store.save(this.accounts))) {
        return 'encryption_unavailable';
      }
      this.unsaved = false;
      return null;
    } catch {
      return 'storage_failed';
    }
  }

  private async stopPending(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    await pending?.listener.close();
  }

  private fail(code: MicrosoftErrorCode): MicrosoftResult<MicrosoftState> {
    this.failed(code);
    return microsoftRejected(code);
  }

  private failed(code: MicrosoftErrorCode): void {
    this.error = { code };
    this.emit('failed');
  }

  private loginState(): MicrosoftLoginState | null {
    const pending = this.pending;
    if (pending === null) {
      return null;
    }
    return pending.phase === 'waiting'
      ? { phase: 'waiting', expiresAt: new Date(pending.expiresAt).toISOString() }
      : { phase: 'exchanging' };
  }

  private snapshot(): MicrosoftState {
    return {
      seq: this.seq,
      available: this.deps.clientId !== null,
      encryptionAvailable: this.storage !== 'locked' && this.deps.store.available(),
      accounts: this.accounts.map((account): MicrosoftAccount => ({
        id: account.id,
        nick: account.nick,
        uuid: dashed(account.uuid),
        status: account.refreshToken === null ? 'needs-login' : 'ready',
      })),
      login: this.loginState(),
      error: this.error,
    };
  }

  private emit(change: MicrosoftChange, accountId: string | null = null): void {
    this.seq += 1;
    const event: MicrosoftEvent = { change, accountId, state: this.snapshot() };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        continue;
      }
    }
  }
}
