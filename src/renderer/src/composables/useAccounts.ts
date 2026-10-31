import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type {
  AccountError,
  AccountEvent,
  AccountResult,
  AccountState,
  AccountUser,
  NickError,
  NickResult,
  PinnedNick,
  PlayCheck,
  SiteNick,
} from '@shared/account';
import { sameNickLetters } from '@shared/account';
import { isValidNick } from '@shared/launch';
import type { LookChange, LookError, LookResult } from '@shared/look';
import type {
  MicrosoftAccount,
  MicrosoftError,
  MicrosoftEvent,
  MicrosoftResult,
  MicrosoftState,
} from '@shared/microsoft';
import type { GameAccount } from '@shared/player';
import {
  MAX_NICK_ACCOUNTS,
  type ActivePlayer,
  type NickRecord,
  type PlayersResult,
  type StoredPlayers,
} from '@shared/players';
import {
  activePlayer,
  licenses as mockLicenses,
  mcAccount,
  nicks as mockNicks,
} from '../mock/player';
import type { LauncherContext } from './context';
import { useStores } from './context';

const NICK_HEAD = 'fox';
const LICENSE_HEAD = 'frost';
const NICK_FAILED: NickError = { code: 'failed' };
const UNCHECKED: PlayCheck = { kind: 'unchecked' };
const LOOK_FAILED: LookResult = { ok: false, error: { code: 'failed' } };

export interface AccountsStore {
  accounts: ComputedRef<GameAccount[]>;
  rows: ComputedRef<GameAccount[]>;
  active: ComputedRef<GameAccount | null>;
  nick: ComputedRef<GameAccount | null>;
  pinned: ComputedRef<PinnedNick | null>;
  playNick: ComputedRef<string | null>;
  player: ComputedRef<GameAccount | null>;
  licenses: ComputedRef<MicrosoftAccount[]>;
  license: ComputedRef<MicrosoftAccount | null>;
  microsoft: ShallowRef<MicrosoftState>;
  msError: Ref<MicrosoftError | null>;
  msBusy: Ref<boolean>;
  removeError: Ref<MicrosoftError | null>;
  ready: Promise<void>;
  settled: Ref<boolean>;
  mc: ComputedRef<AccountUser | null>;
  mcState: ShallowRef<AccountState>;
  mcError: Ref<AccountError | null>;
  mcBusy: Ref<boolean>;
  addNick: (nick: string) => GameAccount | null;
  claimNick: (nick: string) => Promise<NickError | null>;
  setAvatar: (nick: string) => Promise<NickError | null>;
  siteNickOf: (nick: string) => SiteNick | null;
  skinOfNick: (nick: string) => string | null;
  avatarName: ComputedRef<string | null>;
  select: (account: GameAccount) => void;
  removeNick: (id: string) => Promise<NickError | null>;
  saveNick: (nick: string) => boolean;
  checkNick: (nick: string) => Promise<PlayCheck>;
  wear: (change: LookChange) => Promise<LookError | null>;
  resetLook: (nick?: string) => Promise<LookError | null>;
  loginMicrosoft: () => Promise<void>;
  reopenMicrosoft: () => Promise<void>;
  cancelMicrosoft: () => Promise<void>;
  removeMicrosoft: (id: string) => Promise<void>;
  onMsEvent: (listener: (event: MicrosoftEvent) => void) => () => void;
  connectMc: () => Promise<void>;
  reopenMc: () => Promise<void>;
  submitMcCode: (code: string) => Promise<boolean>;
  cancelMc: () => Promise<void>;
  refreshMc: () => Promise<void>;
  signOut: () => Promise<void>;
  onMcEvent: (listener: (event: AccountEvent) => void) => () => void;
  dispose: () => void;
}

function nickAccount(record: NickRecord): GameAccount {
  return { id: record.id, name: record.nick, provider: 'nick', head: NICK_HEAD, skin: null };
}

function activeFor(account: GameAccount): ActivePlayer {
  return { kind: account.provider === 'microsoft' ? 'microsoft' : 'nick', id: account.id };
}

function licenseAccount(account: MicrosoftAccount): GameAccount {
  return {
    id: account.id,
    name: account.nick,
    provider: 'microsoft',
    head: LICENSE_HEAD,
    skin: null,
  };
}

function freeNickId(nick: string, taken: (id: string) => boolean): string {
  const base = `nick-${nick.toLowerCase()}`;
  let id = base;
  for (let index = 2; taken(id); index += 1) {
    id = `${base}-${String(index)}`;
  }
  return id;
}

function initialState(demo: boolean): AccountState {
  return {
    seq: 0,
    encryptionAvailable: true,
    user: demo ? mcAccount : null,
    connect: null,
    error: null,
  };
}

function initialMicrosoft(demo: boolean): MicrosoftState {
  return {
    seq: 0,
    available: demo,
    encryptionAvailable: true,
    accounts: demo ? mockLicenses : [],
    login: null,
    error: null,
  };
}

export function createAccounts(context: LauncherContext): AccountsStore {
  const nicks = ref<GameAccount[]>(context.demo ? mockNicks.map((item) => ({ ...item })) : []);
  const activeRef = ref<ActivePlayer | null>(context.demo ? activePlayer : null);
  const picked = ref(false);
  const microsoft = shallowRef<MicrosoftState>(initialMicrosoft(context.demo));
  const msError = ref<MicrosoftError | null>(null);
  const msBusy = ref(false);
  const removeError = ref<MicrosoftError | null>(null);
  const msListeners = new Set<(event: MicrosoftEvent) => void>();
  const mcState = shallowRef<AccountState>(initialState(context.demo));
  const mcError = ref<AccountError | null>(null);
  const mcBusy = ref(false);
  const listeners = new Set<(event: AccountEvent) => void>();
  const mc = computed(() => mcState.value.user);
  const licenses = computed(() => microsoft.value.accounts);
  const accounts = computed(() => [...licenses.value.map(licenseAccount), ...nicks.value]);
  const pinned = computed(() => mc.value?.nick ?? null);
  const pinnedName = computed(() => pinned.value?.name ?? null);
  const siteNicks = computed(() => mc.value?.nicks ?? []);
  const avatarName = computed(
    () => siteNicks.value.find((item) => item.avatar)?.name ?? pinnedName.value,
  );
  function siteNickOf(name: string): SiteNick | null {
    return siteNicks.value.find((item) => sameNickLetters(item.name, name)) ?? null;
  }
  // A nickname of the account without its own skin wears the avatar's.
  function skinOfNick(name: string): string | null {
    const site = siteNickOf(name);
    const own = site?.skin?.url ?? null;
    const isAvatar = avatarName.value !== null && sameNickLetters(avatarName.value, name);
    return own ?? (site !== null || isAvatar ? (mc.value?.skin?.url ?? null) : null);
  }
  const pinnedNick = computed(() => {
    const name = pinnedName.value;
    return name === null
      ? null
      : (nicks.value.find((item) => sameNickLetters(item.name, name)) ?? null);
  });
  const rows = computed(() => [...nicks.value, ...licenses.value.map(licenseAccount)]);
  const chosen = computed(() => {
    const current = activeRef.value;
    if (current === null) {
      return null;
    }
    // 0.2.4 kept the pinned nickname as a row of its own.
    if (current.kind === 'mc-monitor') {
      return pinnedNick.value;
    }
    const list = current.kind === 'nick' ? nicks.value : licenses.value.map(licenseAccount);
    return list.find((item) => item.id === current.id) ?? null;
  });
  const nick = computed(() => {
    const current = activeRef.value;
    const found = nicks.value.find((item) => current?.kind === 'nick' && item.id === current.id);
    return found ?? nicks.value[0] ?? null;
  });
  const license = computed(() => {
    const current = chosen.value;
    if (current?.provider === 'microsoft') {
      return licenses.value.find((item) => item.id === current.id) ?? null;
    }
    return licenses.value.find((item) => item.status === 'ready') ?? licenses.value[0] ?? null;
  });
  // Until the player picks a row, a signed-in player plays under the pinned nickname, as before
  // the account list.
  const legacy = computed(() => !picked.value && pinnedNick.value !== null);
  const active = computed(() => {
    if (legacy.value) {
      return pinnedNick.value ?? (license.value === null ? null : licenseAccount(license.value));
    }
    return (
      chosen.value ??
      nicks.value[0] ??
      (license.value === null ? null : licenseAccount(license.value))
    );
  });
  // Servers that let players in by nickname get a nickname when no licence is chosen.
  const playIdentity = computed(() => {
    if (legacy.value) {
      return pinnedNick.value;
    }
    const current = active.value;
    return current !== null && current.provider === 'nick' ? current : nick.value;
  });
  const playNick = computed(() => playIdentity.value?.name ?? null);
  const player = computed(() => active.value);

  function accept(state: AccountState): boolean {
    if (state.seq < mcState.value.seq) {
      return false;
    }
    mcState.value = state;
    mcError.value = state.error;
    return true;
  }

  function receive(event: AccountEvent): void {
    if (!accept(event.state)) {
      return;
    }
    if (event.change === 'signed-in') {
      picked.value = false;
      persist();
    }
    for (const listener of listeners) {
      listener(event);
    }
  }

  function settle<T extends AccountState>(result: AccountResult<T>): boolean {
    if (result.ok) {
      accept(result.value);
      return true;
    }
    mcError.value = result.error;
    return false;
  }

  async function run(action: () => Promise<boolean>): Promise<boolean> {
    if (mcBusy.value) {
      return false;
    }
    mcBusy.value = true;
    try {
      return await action();
    } finally {
      mcBusy.value = false;
    }
  }

  function demoSet(user: AccountUser | null, change: AccountEvent['change']): void {
    receive({
      change,
      state: { ...mcState.value, seq: mcState.value.seq + 1, user, connect: null, error: null },
    });
  }

  // A licence removed in main is no longer accepted as the active one: it is not sent back.
  function storedActive(): ActivePlayer | null {
    const current = activeRef.value;
    if (current === null) {
      return null;
    }
    const gone =
      current.kind === 'microsoft' && !licenses.value.some((item) => item.id === current.id);
    return gone ? null : { ...current };
  }

  function storedPlayers(): StoredPlayers {
    return {
      nicks: nicks.value.map((item) => ({ id: item.id, nick: item.name })),
      active: storedActive(),
      ...(picked.value ? { picked: true } : {}),
    };
  }

  function persist(): void {
    if (context.demo) {
      return;
    }
    void context.api.players
      .save(storedPlayers())
      .then((result) => (result.ok ? undefined : reloadActive()))
      .catch(() => undefined);
  }

  function restore(result: PlayersResult): void {
    if (!result.ok) {
      return;
    }
    const known = new Set(nicks.value.map((item) => item.id));
    const sameName = (name: string): boolean =>
      nicks.value.some((item) => sameNickLetters(item.name, name));
    const restored = result.value.nicks
      .filter((item) => !known.has(item.id) && !sameName(item.nick))
      .map(nickAccount);
    const addedBefore = nicks.value.length > 0;
    nicks.value = [...restored, ...nicks.value];
    activeRef.value ??= result.value.active;
    picked.value ||= result.value.picked === true;
    if (addedBefore) {
      persist();
    }
  }

  function acceptMs(state: MicrosoftState): boolean {
    if (state.seq < microsoft.value.seq) {
      return false;
    }
    microsoft.value = state;
    msError.value = state.error;
    return true;
  }

  async function reloadActive(): Promise<void> {
    const result = await context.api.players.get().catch(() => null);
    if (result?.ok === true) {
      activeRef.value = result.value.active;
    }
  }

  function receiveMs(event: MicrosoftEvent): void {
    const known = new Set(microsoft.value.accounts.map((item) => item.id));
    if (!acceptMs(event.state)) {
      return;
    }
    const added = event.state.accounts.find((item) => !known.has(item.id));
    if (event.change === 'signed-in' && added !== undefined) {
      select(licenseAccount(added));
    }
    for (const listener of msListeners) {
      listener(event);
    }
  }

  function settleMs(result: MicrosoftResult<MicrosoftState>): void {
    if (result.ok) {
      acceptMs(result.value);
      return;
    }
    msError.value = result.error;
  }

  async function runMs(
    action: () => Promise<MicrosoftResult<MicrosoftState>>,
    settle: (result: MicrosoftResult<MicrosoftState>) => void = settleMs,
  ): Promise<void> {
    if (context.demo || msBusy.value) {
      return;
    }
    msBusy.value = true;
    try {
      settle(await action());
    } finally {
      msBusy.value = false;
    }
  }

  function acceptOnly(result: MicrosoftResult<MicrosoftState>): void {
    if (result.ok) {
      acceptMs(result.value);
    }
  }

  let unsubscribe: () => void = () => undefined;
  let ready: Promise<void> = Promise.resolve();
  if (!context.demo) {
    const offAccount = context.api.account.onEvent(receive);
    const offMicrosoft = context.api.microsoft.onEvent(receiveMs);
    unsubscribe = (): void => {
      offAccount();
      offMicrosoft();
    };
    ready = Promise.allSettled([
      context.api.players.get().then(restore),
      context.api.account.state().then(accept),
      context.api.microsoft.state().then(acceptMs),
    ]).then(() => undefined);
  }
  // The nickname pinned on the site is one of the player's nicknames in the list.
  // Waits for the saved list, so it is not overwritten before it is read; the row 0.2.4 kept
  // for the account becomes that nickname's row.
  function adoptPinnedNick(): void {
    const name = pinnedName.value;
    if (!settled.value) {
      return;
    }
    const before = nicks.value.length;
    for (const item of siteNicks.value) {
      insertNick(item.name);
    }
    let legacyRow = false;
    if (name !== null && isValidNick(name)) {
      const row = pinnedNick.value ?? insertNick(name);
      legacyRow = activeRef.value?.kind === 'mc-monitor';
      if (legacyRow) {
        activeRef.value = { kind: 'nick', id: row.id };
      }
    }
    if (nicks.value.length !== before || legacyRow) {
      persist();
    }
  }

  const settled = ref(context.demo);
  const siteNickNames = computed(() => siteNicks.value.map((item) => item.name).join(','));
  watch([pinnedName, siteNickNames], adoptPinnedNick);
  void ready.then(() => {
    settled.value = true;
    adoptPinnedNick();
  });

  function rename(id: string, name: string): boolean {
    const account = nicks.value.find((item) => item.id === id);
    if (account === undefined || !isValidNick(name)) {
      return false;
    }
    account.name = name;
    persist();
    return true;
  }

  function insertNick(name: string): GameAccount {
    const existing = nicks.value.find((item) => sameNickLetters(item.name, name));
    if (existing !== undefined) {
      return existing;
    }
    const account = nickAccount({
      id: freeNickId(name, (id) => accounts.value.some((item) => item.id === id)),
      nick: name,
    });
    nicks.value.push(account);
    return account;
  }

  function select(account: GameAccount): void {
    activeRef.value = activeFor(account);
    picked.value = true;
    persist();
  }

  function addNick(name: string): GameAccount | null {
    const known = nicks.value.some((item) => sameNickLetters(item.name, name));
    if (!isValidNick(name) || (!known && nicks.value.length >= MAX_NICK_ACCOUNTS)) {
      return null;
    }
    const account = insertNick(name);
    select(account);
    return account;
  }

  // A nickname pinned to the account is let go on the site too, or the next sign-in brings it back.
  async function removeNick(id: string): Promise<NickError | null> {
    const row = nicks.value.find((item) => item.id === id);
    const site = row === undefined ? null : siteNickOf(row.name);
    if (site !== null && !context.demo) {
      const result = await context.api.account.removeSiteNick(site.name).catch(() => null);
      if (result === null) {
        return NICK_FAILED;
      }
      if (result.ok) {
        accept(result.value);
      } else if (result.error.code !== 'unsupported') {
        return result.error;
      }
    }
    nicks.value = nicks.value.filter((item) => item.id !== id);
    if (activeRef.value?.kind === 'nick' && activeRef.value.id === id) {
      activeRef.value = null;
    }
    persist();
    return null;
  }

  async function siteNickCall(call: () => Promise<NickResult>): Promise<NickError | null> {
    if (context.demo) {
      return null;
    }
    const result = await call().catch(() => null);
    if (result?.ok !== true) {
      return result?.error ?? NICK_FAILED;
    }
    accept(result.value);
    return null;
  }

  // While signed in, a new nickname joins the account so that it gets a skin and a code; a site
  // without nickname lists leaves it in the launcher only.
  async function claimNick(name: string): Promise<NickError | null> {
    if (mc.value === null || siteNickOf(name) !== null) {
      return null;
    }
    const failure = await siteNickCall(() => context.api.account.addSiteNick(name));
    return failure?.code === 'unsupported' ? null : failure;
  }

  function setAvatar(name: string): Promise<NickError | null> {
    return siteNickCall(() => context.api.account.setAvatarNick(name));
  }

  function saveNick(name: string): boolean {
    const current = nick.value;
    if (current !== null) {
      return rename(current.id, name);
    }
    if (!isValidNick(name)) {
      return false;
    }
    const account = insertNick(name);
    activeRef.value = { kind: 'nick', id: account.id };
    persist();
    return true;
  }

  function loginMicrosoft(): Promise<void> {
    msError.value = null;
    removeError.value = null;
    return runMs(() => context.api.microsoft.login());
  }

  // A failed reopen leaves the sign-in running: its outcome arrives as an event.
  function reopenMicrosoft(): Promise<void> {
    return runMs(() => context.api.microsoft.reopen(), acceptOnly);
  }

  async function cancelMicrosoft(): Promise<void> {
    if (!context.demo) {
      acceptMs(await context.api.microsoft.cancel());
    }
    msError.value = null;
  }

  function removeMicrosoft(id: string): Promise<void> {
    removeError.value = null;
    return runMs(
      () => context.api.microsoft.remove(id),
      (result) => {
        acceptOnly(result);
        removeError.value = result.ok ? null : result.error;
      },
    );
  }

  async function connectMc(): Promise<void> {
    if (context.demo) {
      demoSet(mcAccount, 'signed-in');
      return;
    }
    await run(async () => settle(await context.api.account.connect()));
  }

  async function reopenMc(): Promise<void> {
    if (context.demo) {
      return;
    }
    const result = await context.api.account.reopen();
    if (result.ok) {
      accept(result.value);
    }
  }

  function submitMcCode(code: string): Promise<boolean> {
    return run(async () => settle(await context.api.account.submitCode(code)));
  }

  async function cancelMc(): Promise<void> {
    if (!context.demo) {
      accept(await context.api.account.cancel());
    }
    mcError.value = null;
  }

  async function refreshMc(): Promise<void> {
    if (!context.demo) {
      settle(await context.api.account.refresh());
    }
  }

  function checkNick(name: string): Promise<PlayCheck> {
    return context.demo
      ? Promise.resolve(UNCHECKED)
      : context.api.account
          .playCheck({ serverId: null, nick: name, auth: 'nick' })
          .catch(() => UNCHECKED);
  }

  async function dress(action: () => Promise<LookResult>): Promise<LookError | null> {
    const result = await action().catch(() => LOOK_FAILED);
    if (result.ok) {
      accept(result.value);
      return null;
    }
    return result.error;
  }

  async function signOut(): Promise<void> {
    if (context.demo) {
      demoSet(null, 'signed-out');
      return;
    }
    await run(async () => settle(await context.api.account.logout()));
  }

  return {
    accounts,
    rows,
    active,
    nick,
    pinned,
    playNick,
    player,
    licenses,
    license,
    microsoft,
    msError,
    msBusy,
    removeError,
    ready,
    settled,
    mc,
    mcState,
    mcError,
    mcBusy,
    addNick,
    claimNick,
    setAvatar,
    siteNickOf,
    skinOfNick,
    avatarName,
    select,
    removeNick,
    saveNick,
    checkNick,
    wear: (change) => dress(() => context.api.account.wear(change)),
    resetLook: (nick) => dress(() => context.api.account.resetLook(nick)),
    loginMicrosoft,
    reopenMicrosoft,
    cancelMicrosoft,
    removeMicrosoft,
    onMsEvent: (listener): (() => void) => {
      msListeners.add(listener);
      return (): void => {
        msListeners.delete(listener);
      };
    },
    connectMc,
    reopenMc,
    submitMcCode,
    cancelMc,
    refreshMc,
    signOut,
    onMcEvent: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    dispose: (): void => {
      unsubscribe();
      listeners.clear();
      msListeners.clear();
    },
  };
}

export function useAccounts(): AccountsStore {
  return useStores().accounts;
}
