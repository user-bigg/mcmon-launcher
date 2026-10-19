import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type {
  AccountError,
  AccountEvent,
  AccountResult,
  AccountState,
  AccountUser,
  NickError,
  PinnedNick,
  PlayCheck,
} from '@shared/account';
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
import type { ActivePlayer, NickRecord, PlayersResult, StoredPlayers } from '@shared/players';
import {
  activePlayer,
  licenses as mockLicenses,
  mcAccount,
  nicks as mockNicks,
} from '../mock/player';
import { gameNick } from '../lib/play-account';
import type { LauncherContext } from './context';
import { useStores } from './context';

const NICK_HEAD = 'fox';
const LICENSE_HEAD = 'frost';
const PINNED_ID = 'mc-monitor';
const NICK_FAILED: NickError = { code: 'failed' };
const UNCHECKED: PlayCheck = { kind: 'unchecked' };
const LOOK_FAILED: LookResult = { ok: false, error: { code: 'failed' } };

export interface AccountsStore {
  accounts: ComputedRef<GameAccount[]>;
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
  saveNick: (nick: string) => boolean;
  pinNick: (nick: string) => Promise<NickError | null>;
  checkNick: (nick: string) => Promise<PlayCheck>;
  wear: (change: LookChange) => Promise<LookError | null>;
  resetLook: () => Promise<LookError | null>;
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
  const nick = computed(() => {
    const chosen = activeRef.value;
    const picked = nicks.value.find((item) => chosen?.kind === 'nick' && item.id === chosen.id);
    return picked ?? nicks.value[0] ?? null;
  });
  const license = computed(
    () => licenses.value.find((item) => item.status === 'ready') ?? licenses.value[0] ?? null,
  );
  const active = computed(
    () => nick.value ?? (license.value === null ? null : licenseAccount(license.value)),
  );
  const pinned = computed(() => mc.value?.nick ?? null);
  const playNick = computed(() => gameNick(nick.value?.name ?? null, pinned.value));
  const player = computed(() => {
    if (pinned.value === null) {
      return active.value;
    }
    const name = pinned.value.name;
    if (name !== null) {
      return nickAccount({ id: PINNED_ID, nick: name });
    }
    return license.value === null ? null : licenseAccount(license.value);
  });

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

  function storedPlayers(): StoredPlayers {
    const current = nick.value;
    return {
      nicks: nicks.value.map((item) => ({ id: item.id, nick: item.name })),
      active: current === null ? null : { kind: 'nick', id: current.id },
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
    const restored = result.value.nicks.filter((item) => !known.has(item.id)).map(nickAccount);
    const addedBefore = nicks.value.length > 0;
    nicks.value = [...restored, ...nicks.value];
    activeRef.value ??= result.value.active;
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
    if (!acceptMs(event.state)) {
      return;
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
  const settled = ref(context.demo);
  void ready.then(() => {
    settled.value = true;
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
    const existing = nicks.value.find((item) => item.name === name);
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

  function addNick(name: string): GameAccount | null {
    if (!isValidNick(name)) {
      return null;
    }
    const account = insertNick(name);
    activeRef.value = { kind: 'nick', id: account.id };
    persist();
    return account;
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

  async function pinNick(name: string): Promise<NickError | null> {
    if (context.demo) {
      const user = mc.value;
      if (user !== null) {
        demoSet({ ...user, nick: { name, changeAt: null } }, 'changed');
      }
      return user === null ? NICK_FAILED : null;
    }
    const result = await context.api.account.setNick(name).catch(() => null);
    if (result?.ok !== true) {
      return result?.error ?? NICK_FAILED;
    }
    accept(result.value);
    return null;
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
    saveNick,
    pinNick,
    checkNick,
    wear: (change) => dress(() => context.api.account.wear(change)),
    resetLook: () => dress(() => context.api.account.resetLook()),
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
