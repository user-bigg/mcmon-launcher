import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type { ServerRow } from '@shared/catalog';
import {
  instanceIdOf,
  type LaunchAccount,
  type GameEvent,
  type GameSession,
  type LaunchError,
  type LaunchEvent,
  type LaunchFailureRecord,
  type LaunchPhase,
  type LaunchProgress,
  type LaunchRequest,
  type LaunchState,
  type LaunchTarget,
  type ModsAnswer,
} from '@shared/launch';
import type { ModLabel } from '@shared/mods';
import { formatServerAddress } from '@shared/server-address';
import type { ClientModRun, SkinsStatus } from '@shared/skin-mod';
import type { LauncherContext } from './context';
import { useStores } from './context';

export interface LaunchJob {
  instanceId: string;
  name: string;
  serverId: number;
}

export interface LaunchOptions {
  account: LaunchAccount;
  memoryMb?: number | undefined;
  joinServer: boolean;
  serverSkins?: boolean | undefined;
  serverModpack?: boolean | undefined;
}

export interface LaunchStore {
  phase: Ref<LaunchPhase>;
  progress: ShallowRef<LaunchProgress | null>;
  session: ShallowRef<GameSession | null>;
  skins: Ref<SkinsStatus | null>;
  blockedClientMods: ShallowRef<readonly ClientModRun[]>;
  modsWaiting: ShallowRef<ModLabel[] | null>;
  windowReady: Ref<boolean>;
  windowSlow: Ref<boolean>;
  windowDialog: Ref<boolean>;
  error: ComputedRef<LaunchError | null>;
  job: ShallowRef<LaunchJob | null>;
  crashed: Ref<string | null>;
  markCrashSeen: () => void;
  busy: ComputedRef<boolean>;
  installing: ComputedRef<boolean>;
  start: (job: LaunchJob, request: LaunchRequest) => Promise<boolean>;
  reject: (job: LaunchJob, reason: LaunchError) => void;
  cancel: () => Promise<void>;
  kill: () => Promise<void>;
  keepWaiting: () => Promise<void>;
  answerMods: (answer: ModsAnswer) => Promise<void>;
  setJoinServer: (join: boolean) => Promise<boolean>;
  logTail: (lines: number) => Promise<string[]>;
  dismiss: () => void;
  dispose: () => void;
}

export function serverTarget(server: ServerRow): LaunchTarget | null {
  if (server.launch.kind !== 'direct') {
    return null;
  }
  return {
    kind: 'server',
    serverId: server.id,
    minecraft: server.launch.minecraft,
    address: formatServerAddress(server.address),
  };
}

export function launchRequest(target: LaunchTarget, options: LaunchOptions): LaunchRequest {
  const request: LaunchRequest = {
    target,
    account: options.account,
    joinServer: options.joinServer,
  };
  if (options.serverSkins !== undefined) {
    request.serverSkins = options.serverSkins;
  }
  if (options.serverModpack === true) {
    request.serverModpack = true;
  }
  return options.memoryMb === undefined ? request : { ...request, memoryMb: options.memoryMb };
}

export function jobFor(target: LaunchTarget, name: string): LaunchJob {
  return {
    instanceId: instanceIdOf(target),
    name,
    serverId: target.serverId,
  };
}

const SEEN_CRASH_KEY = 'mcmonitor.seen-crash';

function readSeenCrash(): string | null {
  try {
    return sessionStorage.getItem(SEEN_CRASH_KEY);
  } catch {
    return null;
  }
}

function writeSeenCrash(at: string): void {
  try {
    sessionStorage.setItem(SEEN_CRASH_KEY, at);
  } catch {
    return;
  }
}

export type JobResolver = (instanceId: string) => LaunchJob | null;

function sameFailure(a: LaunchFailureRecord | null, b: LaunchFailureRecord | null): boolean {
  return a !== null && b !== null && a.operationId === b.operationId && a.at === b.at;
}

function currentFailure(state: LaunchState): LaunchFailureRecord | null {
  return state.lastError?.operationId === state.operationId ? state.lastError : null;
}

export function createLaunch(context: LauncherContext, resolveJob: JobResolver): LaunchStore {
  const { api } = context;
  const phase = ref<LaunchPhase>('idle');
  const progress = shallowRef<LaunchProgress | null>(null);
  const session = shallowRef<GameSession | null>(null);
  const skins = ref<SkinsStatus | null>(null);
  const blockedClientMods = shallowRef<readonly ClientModRun[]>([]);
  const modsWaiting = shallowRef<ModLabel[] | null>(null);
  const windowReady = ref(false);
  const windowSlow = ref(false);
  const windowDialog = ref(false);
  const failure = shallowRef<LaunchFailureRecord | null>(null);
  const local = shallowRef<LaunchError | null>(null);
  const job = shallowRef<LaunchJob | null>(null);
  const crashed = ref<string | null>(null);

  let seen = -1;
  let dismissed: LaunchFailureRecord | null = null;
  let lastCrashAt: string | null = null;

  function restoreJob(state: LaunchState): void {
    const instanceId = state.target === null ? null : instanceIdOf(state.target);
    if (instanceId !== null && job.value?.instanceId !== instanceId) {
      job.value = resolveJob(instanceId) ?? job.value;
    }
  }

  function apply(state: LaunchState): boolean {
    if (state.seq < seen) {
      return false;
    }
    seen = state.seq;
    phase.value = state.phase;
    progress.value = state.progress;
    session.value = state.session;
    skins.value = state.skins;
    blockedClientMods.value = state.blockedClientMods ?? [];
    modsWaiting.value = state.modsWaiting ?? null;
    windowReady.value = state.windowReady;
    windowSlow.value = state.windowSlow;
    windowDialog.value = state.windowDialog;
    lastCrashAt = state.lastCrash?.at ?? null;
    const latest = currentFailure(state);
    failure.value = sameFailure(latest, dismissed) ? null : latest;
    restoreJob(state);
    return true;
  }

  function restoreCrash(state: LaunchState): void {
    if (
      state.phase === 'idle' &&
      state.lastCrash !== null &&
      state.target !== null &&
      state.lastCrash.at !== readSeenCrash()
    ) {
      crashed.value ??= instanceIdOf(state.target);
    }
  }

  function onGame(event: GameEvent, state: LaunchState): void {
    if (event.type === 'crash' && state.target !== null) {
      crashed.value = instanceIdOf(state.target);
    }
  }

  function onEvent(event: LaunchEvent): void {
    if (apply(event.state) && event.kind === 'game') {
      onGame(event.event, event.state);
    }
  }

  async function refresh(): Promise<void> {
    const result = await api.launch.state();
    if (result.ok && apply(result.value)) {
      restoreCrash(result.value);
    }
  }

  const unsubscribe = api.launch.onEvent(onEvent);
  void refresh();

  async function start(next: LaunchJob, request: LaunchRequest): Promise<boolean> {
    if (phase.value !== 'idle') {
      return false;
    }
    job.value = next;
    dismissed = failure.value;
    failure.value = null;
    local.value = null;
    crashed.value = null;
    progress.value = null;
    skins.value = null;
    phase.value = 'preparing';
    const result = await api.launch.launch(request);
    if (result.ok) {
      session.value = result.value;
      return true;
    }
    local.value = result.error;
    await refresh();
    return false;
  }

  async function cancel(): Promise<void> {
    const result = await api.launch.cancel();
    if (!result.ok && result.error.code !== 'not-running') {
      local.value = result.error;
    }
  }

  async function kill(): Promise<void> {
    await api.launch.kill();
  }

  async function keepWaiting(): Promise<void> {
    windowSlow.value = false;
    windowDialog.value = false;
    await api.launch.keepWaiting();
  }

  // False when the launch has already read the choice: the caller puts the switch back.
  async function setJoinServer(join: boolean): Promise<boolean> {
    const result = await api.launch.setJoinServer(join);
    return result.ok;
  }

  async function logTail(lines: number): Promise<string[]> {
    const result = await api.launch.logTail(lines);
    return result.ok ? result.value : [];
  }

  return {
    phase,
    progress,
    session,
    skins,
    blockedClientMods,
    modsWaiting,
    windowReady,
    windowSlow,
    windowDialog,
    error: computed(() => local.value ?? failure.value?.error ?? null),
    job,
    crashed,
    markCrashSeen: (): void => {
      if (lastCrashAt !== null) {
        writeSeenCrash(lastCrashAt);
      }
    },
    busy: computed(() => phase.value !== 'idle'),
    installing: computed(() => phase.value === 'preparing'),
    start,
    reject: (next, reason): void => {
      job.value = next;
      local.value = reason;
    },
    cancel,
    kill,
    keepWaiting,
    answerMods: async (answer): Promise<void> => {
      modsWaiting.value = null;
      await api.launch.answerMods(answer);
    },
    setJoinServer,
    logTail,
    dismiss: (): void => {
      local.value = null;
      dismissed = failure.value;
      failure.value = null;
    },
    dispose: unsubscribe,
  };
}

export function useLaunch(): LaunchStore {
  return useStores().launch;
}
