import {
  CONNECT_TIMEOUT_MS,
  PLAY_CHECK_TIMEOUT_MS,
  normalizeLoginCode,
  sameNickLetters,
  type AccountChange,
  type AccountError,
  type AccountEvent,
  type AccountResult,
  type AccountState,
  type AccountUser,
  type ConnectPhase,
  type NickResult,
  type PinnedNick,
  type PlayCheck,
  type PlayCheckQuery,
  type VotePause,
  type VoteResult,
} from '@shared/account';
import type { AlertFeed, AlertSettings } from '@shared/alerts';
import type { LookChange, LookResult, WornLook } from '@shared/look';
import type { OwnedServer, OwnedServerDetails } from '@shared/owner';
import type { ReportDraft, ReportResult } from '@shared/report';
import type { SiteError } from '@shared/site';
import type { TelemetryDevice } from '@shared/telemetry';
import { revokedCode, type RevokedCode, type Sent } from '../site/http';
import { lookError } from '../site/look';
import type { TelemetrySession } from '../site/telemetry';
import type { AccountApi } from './api';
import { accountError, accountFailure, accountResult, reportResult } from './errors';
import type { Loopback, LoopbackOptions } from './loopback';
import { withDeadline } from '../deadline';
import { nickError, playCheckOf, type CheckedPlay } from './nick';
import type { PlayAllowed, Profile, SessionUser } from './parse';
import { createPkce, type Pkce } from './pkce';
import type { LoadedSession, StoredSession } from './token-store';

export interface SessionStore {
  available: () => boolean;
  load: () => Promise<LoadedSession>;
  save: (session: StoredSession) => Promise<boolean>;
  clear: () => Promise<void>;
}

export interface FavoritesCountStore {
  get: () => number | null;
  set: (count: number | null) => void;
}

export interface AccountDeps {
  store: SessionStore;
  favoritesCount?: FavoritesCountStore;
  api: AccountApi;
  connectPage: () => Promise<string | null>;
  openBrowser: (url: string) => Promise<boolean>;
  listen: (options: LoopbackOptions) => Promise<Loopback>;
  installId: () => Promise<string>;
  device: () => Promise<TelemetryDevice>;
  deviceLabel: string;
  now: () => number;
  log: (message: string) => void;
  traceUrl?: (url: string) => void;
  pkce?: () => Pkce;
  connectTimeoutMs?: number;
  profileTtlMs?: number;
}

interface Pending {
  pkce: Pkce;
  loopback: Loopback;
  url: string | null;
  expiresAt: number;
  phase: ConnectPhase;
  timer: ReturnType<typeof setTimeout>;
}

export interface ConnectParams {
  challenge: string;
  state: string;
  port: number;
  device: string;
}

const PROFILE_TTL_MS = 60_000;
const BARE_LOOK: WornLook = { skin: null, cape: null };

type LookAnswer = Promise<Sent<Partial<WornLook>>>;
type LookStep = () => LookAnswer;

export function connectUrl(page: string, params: ConnectParams): string {
  const url = new URL(page);
  url.searchParams.set('challenge', params.challenge);
  url.searchParams.set('state', params.state);
  url.searchParams.set('port', String(params.port));
  url.searchParams.set('device', params.device);
  return url.href;
}

function sameNick(a: PinnedNick | null, b: PinnedNick | null): boolean {
  return a === null || b === null ? a === b : a.name === b.name && a.changeAt === b.changeAt;
}

function userOf(
  session: SessionUser,
  nick: PinnedNick | null,
  profile: Profile | null,
  look: WornLook,
  rememberedFavorites: number | null,
): AccountUser {
  const fresh = profile?.id === session.id ? profile : null;
  return {
    id: session.id,
    name: fresh?.name ?? session.name,
    nick,
    nicks: fresh?.nicks ?? [],
    avatarUrl: fresh?.avatarUrl ?? session.avatarUrl,
    skin: look.skin,
    cape: look.cape,
    createdAt: fresh?.createdAt ?? null,
    votesMonth: fresh?.votesMonth ?? null,
    favoritesCount: fresh?.favoritesCount ?? rememberedFavorites,
    hoursPlayed: fresh?.hoursPlayed ?? null,
    trusted: fresh?.trusted ?? null,
    trustedReason: fresh?.trustedReason ?? null,
    unreadAlerts: fresh?.unreadAlerts ?? null,
    ownedServers: fresh?.ownedServers ?? [],
  };
}

type NickWrite = Promise<Sent<true>>;

export class AccountManager {
  private session: StoredSession | null = null;
  private profile: Profile | null = null;
  private profileAt = 0;
  private look: WornLook = BARE_LOOK;
  private favoriteIds: Set<number> | null = null;
  private lookRevision = 0;
  private pending: Pending | null = null;
  private pulling: { session: StoredSession; answer: Promise<AccountResult<AccountState>> } | null =
    null;
  private error: AccountError | null = null;
  private seq = 0;
  private readonly listeners = new Set<(event: AccountEvent) => void>();
  private readonly ready: Promise<void>;

  constructor(private readonly deps: AccountDeps) {
    this.ready = this.restore();
  }

  token(): string | null {
    return this.session?.token ?? null;
  }

  telemetrySession(): TelemetrySession | null {
    const session = this.session;
    return session === null ? null : { user: session.user.id, token: session.token };
  }

  reject(token: string, code: RevokedCode): void {
    if (this.session?.token !== token) {
      return;
    }
    this.deps.log(`account: token rejected (${code})`);
    void this.forget('expired', { code });
  }

  onEvent(listener: (event: AccountEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  async state(): Promise<AccountState> {
    await this.ready;
    return this.snapshot();
  }

  async connect(): Promise<AccountResult<AccountState>> {
    await this.ready;
    this.stopPending();
    if (!this.deps.store.available()) {
      return this.fail({ code: 'encryption_unavailable' });
    }
    const page = await this.deps.connectPage();
    if (page === null) {
      return this.fail({ code: 'connect_unavailable' });
    }
    const pkce = (this.deps.pkce ?? createPkce)();
    const timeoutMs = this.deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    let loopback: Loopback;
    try {
      loopback = await this.deps.listen({ state: pkce.state, timeoutMs });
    } catch (error) {
      this.deps.log(`account: loopback failed ${error instanceof Error ? error.message : ''}`);
      return this.fail({ code: 'loopback_failed' });
    }
    const pending = this.startPending(pkce, loopback, timeoutMs);
    const url = connectUrl(page, {
      challenge: pkce.challenge,
      state: pkce.state,
      port: loopback.port,
      device: this.deps.deviceLabel,
    });
    pending.url = url;
    this.deps.traceUrl?.(url);
    const opened = await this.deps.openBrowser(url).catch(() => false);
    if (!opened || this.pending !== pending) {
      this.stopPending();
      return this.fail({ code: 'browser_failed' });
    }
    this.error = null;
    this.emit('changed');
    return { ok: true, value: this.snapshot() };
  }

  // The same page of the same attempt: a new connect would close the port the first tab
  // is about to answer on.
  async reopen(): Promise<AccountResult<AccountState>> {
    await this.ready;
    const pending = this.pending;
    if (pending?.phase !== 'waiting' || pending.url === null) {
      return accountFailure('connect_expired');
    }
    const opened = await this.deps.openBrowser(pending.url).catch(() => false);
    return opened ? { ok: true, value: this.snapshot() } : accountFailure('browser_failed');
  }

  async submitCode(input: string): Promise<AccountResult<AccountState>> {
    await this.ready;
    const code = normalizeLoginCode(input);
    if (code === null) {
      return accountFailure('invalid_code_format');
    }
    const pending = this.pending;
    if (pending === null) {
      return this.fail({ code: 'connect_expired' });
    }
    return this.exchange(pending, code);
  }

  async cancel(): Promise<AccountState> {
    await this.ready;
    this.stopPending();
    this.error = null;
    this.emit('changed');
    return this.snapshot();
  }

  async logout(): Promise<AccountResult<AccountState>> {
    await this.ready;
    const session = this.session;
    if (session === null) {
      return { ok: true, value: this.snapshot() };
    }
    const revoked = await this.deps.api.revoke(session.token);
    if (!revoked.ok) {
      this.deps.log(`account: revoke failed ${revoked.error.code}`);
    }
    await this.forget('signed-out', null);
    return { ok: true, value: this.snapshot() };
  }

  // A profile already known is answered at once and refreshed behind it: the 'changed' event
  // brings the fresh one. Only a forced refresh, or the very first one, waits for the site.
  async refresh(force = false): Promise<AccountResult<AccountState>> {
    await this.ready;
    const session = this.session;
    if (session === null) {
      return { ok: true, value: this.snapshot() };
    }
    const ttl = this.deps.profileTtlMs ?? PROFILE_TTL_MS;
    const known = this.profile !== null;
    if (!force && known && this.deps.now() - this.profileAt < ttl) {
      return { ok: true, value: this.snapshot() };
    }
    const pulled = this.pull(session);
    if (force || !known) {
      return pulled;
    }
    void pulled.catch(() => undefined);
    return { ok: true, value: this.snapshot() };
  }

  private pull(session: StoredSession): Promise<AccountResult<AccountState>> {
    const flying = this.pulling;
    if (flying?.session === session) {
      return flying.answer;
    }
    const answer = this.askProfile(session).finally(() => {
      if (this.pulling?.answer === answer) {
        this.pulling = null;
      }
    });
    this.pulling = { session, answer };
    return answer;
  }

  private async askProfile(session: StoredSession): Promise<AccountResult<AccountState>> {
    const revision = this.lookRevision;
    const me = await this.deps.api.me(session.token);
    if (!me.ok) {
      return { ok: false, error: accountError(me.error) };
    }
    if (this.session === session) {
      this.profile = me.value;
      this.profileAt = this.deps.now();
      // An answer that left before a confirmed change must not bring the old look back.
      if (revision === this.lookRevision) {
        this.look = { skin: me.value.skin, cape: me.value.cape };
      }
      this.pin(session, me.value.nick);
      this.emit('changed');
    }
    return { ok: true, value: this.snapshot() };
  }

  async setNick(nick: string): Promise<NickResult> {
    await this.ready;
    const session = this.session;
    if (session === null) {
      return { ok: false, error: { code: 'not_signed_in' } };
    }
    const sent = await this.deps.api.setNick(session.token, nick);
    if (!sent.ok) {
      const error = nickError(sent.error);
      if (error.changeAt !== undefined && this.session === session) {
        this.pin(session, { name: session.nick?.name ?? null, changeAt: error.changeAt });
        this.emit('changed');
      }
      return { ok: false, error };
    }
    if (this.session === session) {
      this.pin(session, sent.value);
      this.emit('changed');
    }
    return { ok: true, value: this.snapshot() };
  }

  addSiteNick(nick: string): Promise<NickResult> {
    return this.changeNicks((token) => this.deps.api.addNick(token, nick));
  }

  removeSiteNick(nick: string): Promise<NickResult> {
    return this.changeNicks((token) => this.deps.api.removeNick(token, nick));
  }

  setAvatarNick(nick: string): Promise<NickResult> {
    return this.changeNicks((token) => this.deps.api.setAvatarNick(token, nick));
  }

  // The site answers each change with its own shape; the list is read again from /me, so the
  // window always sees what the site holds.
  private async changeNicks(send: (token: string) => Promise<Sent<unknown>>): Promise<NickResult> {
    await this.ready;
    const session = this.session;
    if (session === null) {
      return { ok: false, error: { code: 'not_signed_in' } };
    }
    const sent = await send(session.token);
    if (!sent.ok) {
      return { ok: false, error: nickError(sent.error) };
    }
    await this.pull(session).catch(() => undefined);
    return { ok: true, value: this.snapshot() };
  }

  private isAvatarNick(nick: string): boolean {
    const avatar =
      this.profile?.nicks.find((item) => item.avatar)?.name ?? this.session?.nick?.name;
    return avatar !== undefined && avatar !== null && sameNickLetters(avatar, nick);
  }

  wear(change: LookChange): Promise<LookResult> {
    const { skin, cape, nick } = change;
    if (nick !== undefined && !this.isAvatarNick(nick)) {
      return this.dressNick((token) => [
        ...(skin === undefined
          ? []
          : [(): NickWrite => this.deps.api.setNickSkin(token, nick, skin)]),
        ...(cape === undefined
          ? []
          : [(): NickWrite => this.deps.api.setNickCape(token, nick, cape)]),
      ]);
    }
    return this.dress((token) => [
      ...(skin === undefined ? [] : [(): LookAnswer => this.deps.api.setSkin(token, skin)]),
      ...(cape === undefined ? [] : [this.capeStep(token, cape)]),
    ]);
  }

  resetLook(nick?: string): Promise<LookResult> {
    if (nick !== undefined && !this.isAvatarNick(nick)) {
      return this.dressNick((token) => [
        (): NickWrite => this.deps.api.removeNickSkin(token, nick),
        (): NickWrite => this.deps.api.setNickCape(token, nick, null),
      ]);
    }
    return this.dress((token) => [
      (): LookAnswer => this.deps.api.removeSkin(token),
      this.capeStep(token, null),
    ]);
  }

  // A nickname other than the avatar keeps its look in /me/nicks: every write is followed by
  // reading the list again.
  private async dressNick(plan: (token: string) => (() => NickWrite)[]): Promise<LookResult> {
    await this.ready;
    const session = this.session;
    if (session === null) {
      return { ok: false, error: { code: 'not_signed_in' } };
    }
    let failure: SiteError | null = null;
    for (const step of plan(session.token)) {
      const sent = await step();
      if (this.session !== session) {
        return { ok: false, error: { code: 'not_signed_in' } };
      }
      if (!sent.ok) {
        failure ??= sent.error;
      }
    }
    await this.pull(session).catch(() => undefined);
    return failure === null
      ? { ok: true, value: this.snapshot() }
      : { ok: false, error: lookError(failure) };
  }

  private capeStep(token: string, preset: string | null): LookStep {
    return () =>
      preset === null ? this.deps.api.removeCape(token) : this.deps.api.setCape(token, preset);
  }

  // The skin and the cape are counted and refused apart: one refusal does not stop the other
  // write, and the look is only what the site confirmed.
  private async dress(plan: (token: string) => LookStep[]): Promise<LookResult> {
    await this.ready;
    const session = this.session;
    if (session === null) {
      return { ok: false, error: { code: 'not_signed_in' } };
    }
    let failure: SiteError | null = null;
    for (const step of plan(session.token)) {
      const sent = await step();
      if (this.session !== session) {
        return { ok: false, error: { code: 'not_signed_in' } };
      }
      if (sent.ok) {
        this.lookRevision += 1;
        this.look = { ...this.look, ...sent.value };
        this.emit('changed');
      } else {
        failure ??= sent.error;
      }
    }
    if (failure === null) {
      return { ok: true, value: this.snapshot() };
    }
    if (failure.code === 'invalid-response') {
      void this.refresh(true).catch(() => undefined);
    }
    return { ok: false, error: lookError(failure) };
  }

  // The window only learns the verdict; the play code stays in main.
  async playCheck(query: PlayCheckQuery): Promise<PlayCheck> {
    return (await this.admitPlay(query)).check;
  }

  // One deadline for everything: loading the session, the requests and their guest retry.
  admitPlay(query: PlayCheckQuery): Promise<CheckedPlay> {
    return withDeadline(this.checkPlay(query), PLAY_CHECK_TIMEOUT_MS, {
      check: { kind: 'unchecked' },
      code: null,
    });
  }

  // Any nickname of the player may differ from the one pinned on the site: the game starts
  // under the chosen one, and a mismatch only means the site gives no code for it.
  private async checkPlay(query: PlayCheckQuery): Promise<CheckedPlay> {
    await this.ready;
    return playCheckOf(await this.askPlay(this.session?.token ?? null, query));
  }

  // A token the site no longer accepts is forgotten by the transport; the nickname still has
  // to be checked, now as a guest.
  private async askPlay(token: string | null, query: PlayCheckQuery): Promise<Sent<PlayAllowed>> {
    const sent = await this.deps.api.playCheck(token, query);
    return token !== null && !sent.ok && revokedCode(sent.error) !== null
      ? this.deps.api.playCheck(null, query)
      : sent;
  }

  private pin(session: StoredSession, nick: PinnedNick | null): void {
    if (this.session !== session || sameNick(session.nick, nick)) {
      return;
    }
    session.nick = nick;
    void this.deps.store.save(session).catch(() => false);
  }

  async favorites(): Promise<AccountResult<number[]>> {
    const result = await this.withToken((token) => this.deps.api.favorites(token));
    if (result.ok && this.session !== null) {
      this.favoriteIds = new Set(result.value);
      this.deps.favoritesCount?.set(this.favoriteIds.size);
    }
    return result;
  }

  async setFavorite(id: number, favorite: boolean): Promise<AccountResult<boolean>> {
    const result = await this.withToken((token) => this.deps.api.setFavorite(token, id, favorite));
    this.profileAt = 0;
    const known = this.favoriteIds;
    if (result.ok && known !== null && this.session !== null) {
      if (result.value) {
        known.add(id);
      } else {
        known.delete(id);
      }
      this.deps.favoritesCount?.set(known.size);
    }
    return result;
  }

  async vote(id: number, nick: string): Promise<AccountResult<VoteResult>> {
    const result = await this.withToken((token) => this.deps.api.vote(token, id, nick));
    if (result.ok) {
      this.profileAt = 0;
    }
    return result;
  }

  alerts(after: string | null): Promise<AccountResult<AlertFeed>> {
    return this.rollingOut((token) => this.deps.api.alerts(token, after));
  }

  readAlerts(ids: number[] | null): Promise<AccountResult<true>> {
    return this.changingAlerts((token) => this.deps.api.readAlerts(token, ids));
  }

  clearAlerts(): Promise<AccountResult<true>> {
    return this.changingAlerts((token) => this.deps.api.clearAlerts(token));
  }

  setWatch(id: number, watch: boolean): Promise<AccountResult<boolean>> {
    return this.rollingOut((token) => this.deps.api.setWatch(token, id, watch));
  }

  alertSettings(): Promise<AccountResult<AlertSettings>> {
    return this.rollingOut((token) => this.deps.api.alertSettings(token));
  }

  setAlertSettings(settings: AlertSettings): Promise<AccountResult<AlertSettings>> {
    return this.rollingOut((token) => this.deps.api.setAlertSettings(token, settings));
  }

  ownedServers(): Promise<AccountResult<OwnedServer[]>> {
    return this.rollingOut((token) => this.deps.api.ownedServers(token));
  }

  ownedServer(id: number): Promise<AccountResult<OwnedServerDetails>> {
    return this.withToken((token) => this.deps.api.ownedServer(token, id));
  }

  votePauses(): Promise<AccountResult<VotePause[]>> {
    return this.rollingOut((token) => this.deps.api.votePauses(token));
  }

  private async changingAlerts(
    run: (token: string) => Promise<Sent<true>>,
  ): Promise<AccountResult<true>> {
    const result = await this.rollingOut(run);
    if (result.ok) {
      this.profileAt = 0;
    }
    return result;
  }

  // A 404 without the site's own server_not_found code is a route the site has not shipped yet.
  private async rollingOut<T>(run: (token: string) => Promise<Sent<T>>): Promise<AccountResult<T>> {
    await this.ready;
    const token = this.token();
    if (token === null) {
      return accountFailure('not_signed_in');
    }
    const sent = await run(token);
    return !sent.ok && sent.error.code === 'not-found' && sent.error.siteCode !== 'server_not_found'
      ? accountFailure('unavailable')
      : accountResult(sent);
  }

  async report(id: number, draft: ReportDraft): Promise<ReportResult> {
    await this.ready;
    const token = this.token();
    return token === null
      ? accountFailure('not_signed_in')
      : reportResult(await this.deps.api.report(token, id, draft));
  }

  private async withToken<T>(run: (token: string) => Promise<Sent<T>>): Promise<AccountResult<T>> {
    await this.ready;
    const token = this.token();
    return token === null ? accountFailure('not_signed_in') : accountResult(await run(token));
  }

  private async restore(): Promise<void> {
    const loaded = await this.deps.store.load().catch((): LoadedSession => ({ kind: 'none' }));
    if (loaded.kind === 'session') {
      this.session = loaded.session;
      queueMicrotask(() => {
        void this.refresh();
      });
    }
  }

  private startPending(pkce: Pkce, loopback: Loopback, timeoutMs: number): Pending {
    const timer = setTimeout(() => {
      this.expire(pending);
    }, timeoutMs);
    timer.unref();
    const pending: Pending = {
      pkce,
      loopback,
      url: null,
      expiresAt: this.deps.now() + timeoutMs,
      phase: 'waiting',
      timer,
    };
    this.pending = pending;
    void loopback.result.then((outcome) => {
      if (outcome.kind === 'code') {
        void this.exchange(pending, outcome.code);
      } else if (outcome.kind === 'timeout') {
        this.expire(pending);
      }
    });
    return pending;
  }

  private expire(pending: Pending): void {
    if (this.pending !== pending) {
      return;
    }
    this.stopPending();
    this.error = { code: 'connect_timeout' };
    this.emit('changed');
  }

  private stopPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.loopback.close();
    }
  }

  private async exchange(pending: Pending, code: string): Promise<AccountResult<AccountState>> {
    if (pending.phase === 'exchanging') {
      return accountFailure('invalid_request');
    }
    pending.phase = 'exchanging';
    this.error = null;
    this.emit('changed');
    const sent = await this.deps.api.exchange({
      code,
      verifier: pending.pkce.verifier,
      install: await this.deps.installId(),
      device: await this.deps.device(),
    });
    if (this.pending !== pending) {
      if (sent.ok) {
        void this.deps.api.revoke(sent.value.token);
      }
      return accountFailure('connect_expired');
    }
    if (!sent.ok) {
      pending.phase = 'waiting';
      return this.fail(accountError(sent.error));
    }
    const session: StoredSession = { token: sent.value.token, user: sent.value.user, nick: null };
    const saved = await this.deps.store.save(session).catch(() => false);
    this.stopPending();
    if (!saved) {
      void this.deps.api.revoke(session.token);
      return this.fail({ code: 'encryption_unavailable' });
    }
    this.session = session;
    this.profile = null;
    this.profileAt = 0;
    this.look = BARE_LOOK;
    this.error = null;
    this.emit('signed-in');
    void this.refresh();
    return { ok: true, value: this.snapshot() };
  }

  private async forget(change: AccountChange, error: AccountError | null): Promise<void> {
    this.session = null;
    this.profile = null;
    this.profileAt = 0;
    this.look = BARE_LOOK;
    this.favoriteIds = null;
    this.deps.favoritesCount?.set(null);
    this.error = error;
    await this.deps.store.clear().catch(() => undefined);
    this.emit(change);
  }

  private fail(error: AccountError): { ok: false; error: AccountError } {
    this.error = error;
    this.emit('changed');
    return { ok: false, error };
  }

  private snapshot(): AccountState {
    const pending = this.pending;
    return {
      seq: this.seq,
      encryptionAvailable: this.deps.store.available(),
      user:
        this.session === null
          ? null
          : userOf(
              this.session.user,
              this.session.nick,
              this.profile,
              this.look,
              this.deps.favoritesCount?.get() ?? null,
            ),
      connect:
        pending === null
          ? null
          : { phase: pending.phase, expiresAt: new Date(pending.expiresAt).toISOString() },
      error: this.error,
    };
  }

  private emit(change: AccountChange): void {
    this.seq += 1;
    const event: AccountEvent = { change, state: this.snapshot() };
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
