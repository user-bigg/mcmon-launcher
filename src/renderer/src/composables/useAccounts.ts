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
  MC_MONITOR_PLAYER_ID,
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
  playsWithAccount: ComputedRef<boolean>;
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
  select: (account: GameAccount) => void;
  removeNick: (id: string) => void;
  saveNick: (nick: string) => boolean;
  pinNick: (nick: string) => Promise<NickError | null>;
  checkNick: (nick: string, guest?: boolean) => Promise<PlayCheck>;
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

function mcMonitorAccount(nick: string): GameAccount {
  return {
    id: MC_MONITOR_PLAYER_ID,
    name: nick,
    provider: 'mc-monitor',
    head: NICK_HEAD,
    skin: null,
  };
}

function activeFor(account: GameAccount): ActivePlayer {
  if (account.provider === 'mc-monitor') {
    return { kind: 'mc-monitor', id: MC_MONITOR_PLAYER_ID };
  }
  return { kind: account.provider, id: account.id };
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
  const mcRow = computed(() => {
    const name = pinned.value?.name ?? null;
    return name === null ? null : mcMonitorAccount(name);
  });
  // A saved nickname equal to the pinned one would be refused as a guest: the row stands for it.
  const rows = computed(() => {
    const own = mcRow.value;
    const guests = nicks.value.filter(
      (item) => own === null || !sameNickLetters(item.name, own.name),
    );
    return [...(own === null ? [] : [own]), ...licenses.value.map(licenseAccount), ...guests];
  });
  const chosen = computed(() => {
    const current = activeRef.value;
    if (current === null) {
      return null;
    }
    if (current.kind === 'mc-monitor') {
      return mcRow.value;
    }
    const list = current.kind === 'nick' ? nicks.value : licenses.value.map(licenseAccount);
    const found = list.find((item) => item.id === current.id) ?? null;
    const own = mcRow.value;
    // A guest nickname pinned later to this account is the account's row now.
    return found?.provider === 'nick' && own !== null && sameNickLetters(found.name, own.name)
      ? own
      : found;
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
  // Until the player picks a row, a signed-in player keeps the pinned nickname: one that has
  // not chosen it yet is asked to, as before the account list.
  const legacy = computed(() => !picked.value && pinned.value !== null);
  const active = computed(() => {
    if (legacy.value) {
      return mcRow.value ?? (license.value === null ? null : licenseAccount(license.value));
    }
    return (
      chosen.value ??
      mcRow.value ??
      nicks.value[0] ??
      (license.value === null ? null : licenseAccount(license.value))
    );
  });
  // Servers that let players in by nickname get a nickname even when a licence is chosen:
  // the MC Monitor row first, then the saved nickname.
  const playIdentity = computed(() => {
    if (legacy.value) {
      return mcRow.value;
    }
    const current = active.value;
    if (current !== null && current.provider !== 'microsoft') {
      return current;
    }
    return mcRow.value ?? nick.value;
  });
  const playNick = computed(() => playIdentity.value?.name ?? null);
  const playsWithAccount = computed(() => playIdentity.value?.provider === 'mc-monitor');
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
      activeRef.value = { kind: 'mc-monitor', id: MC_MONITOR_PLAYER_ID };
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
    const restored = result.value.nicks.filter((item) => !known.has(item.id)).map(nickAccount);
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

  function select(account: GameAccount): void {
    activeRef.value = activeFor(account);
    picked.value = true;
    persist();
  }

  // The site refuses a guest the nickname pinned to an account, so that name means the row.
  function addNick(name: string): GameAccount | null {
    if (!isValidNick(name)) {
      return null;
    }
    const own = mcRow.value;
    const account = own !== null && sameNickLetters(own.name, name) ? own : insertNick(name);
    select(account);
    return account;
  }

  function removeNick(id: string): void {
    nicks.value = nicks.value.filter((item) => item.id !== id);
    if (activeRef.value?.kind === 'nick' && activeRef.value.id === id) {
      activeRef.value = null;
    }
    persist();
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

  function checkNick(name: string, guest = false): Promise<PlayCheck> {
    const query = { serverId: null, nick: name, auth: 'nick' as const };
    return context.demo
      ? Promise.resolve(UNCHECKED)
      : context.api.account.playCheck(guest ? { ...query, guest } : query).catch(() => UNCHECKED);
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
    playsWithAccount,
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
    select,
    removeNick,
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
