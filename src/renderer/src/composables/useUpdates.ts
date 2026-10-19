import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import {
  isSkipped,
  type RestartError,
  type UpdateErrorCode,
  type UpdateState,
  type UpdateStatus,
} from '@shared/update';
import type { LauncherContext } from './context';
import { useStores } from './context';

export interface UpdatesStore {
  state: ShallowRef<UpdateState>;
  skipped: ComputedRef<boolean>;
  canCheck: ComputedRef<boolean>;
  banner: ComputedRef<UpdateStatus | null>;
  restartError: Ref<RestartError | null>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  skip: (version: string) => Promise<void>;
  unskip: (version: string) => Promise<void>;
  restart: () => Promise<void>;
  dispose: () => void;
}

export const INITIAL_UPDATE_STATE: UpdateState = {
  seq: -1,
  status: { kind: 'idle' },
  current: { version: '', builtAt: null, os: '', arch: '' },
  skipped: [],
  checkedAt: null,
  blocked: null,
};

function isUpdateState(value: unknown): value is UpdateState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'seq' in value &&
    typeof (value as { seq: unknown }).seq === 'number'
  );
}

const BUSY_KINDS: readonly UpdateStatus['kind'][] = [
  'disabled',
  'checking',
  'downloading',
  'verifying',
];

const MANUAL_OR_REJECTED: readonly UpdateErrorCode[] = ['signature', 'move', 'readonly', 'install'];

function bannerOf(state: UpdateState): UpdateStatus | null {
  const { status } = state;
  if (isSkipped(state)) {
    return null;
  }
  if (status.kind === 'ready') {
    return status;
  }
  if (status.kind === 'error' && MANUAL_OR_REJECTED.includes(status.code)) {
    return status;
  }
  return null;
}

export function createUpdates(context: LauncherContext): UpdatesStore {
  const state = shallowRef<UpdateState>(INITIAL_UPDATE_STATE);
  const restartError = ref<RestartError | null>(null);

  function accept(value: unknown): void {
    if (isUpdateState(value) && value.seq >= state.value.seq) {
      state.value = value;
      if (value.blocked === null) {
        restartError.value = null;
      }
    }
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      accept(await action());
    } catch {
      return;
    }
  }

  const stop = context.api.update.onEvent(accept);
  void run(() => context.api.update.state());

  return {
    state,
    skipped: computed(() => isSkipped(state.value)),
    canCheck: computed(() => !BUSY_KINDS.includes(state.value.status.kind)),
    banner: computed(() => bannerOf(state.value)),
    restartError,
    check: () => run(() => context.api.update.check()),
    download: () => run(() => context.api.update.download()),
    skip: (version) => run(() => context.api.update.skip(version)),
    unskip: (version) => run(() => context.api.update.unskip(version)),
    restart: async (): Promise<void> => {
      try {
        const result = await context.api.update.restart();
        restartError.value = result.ok ? null : result.error;
      } catch {
        restartError.value = { code: 'not-ready' };
      }
    },
    dispose: stop,
  };
}

export function useUpdates(): UpdatesStore {
  return useStores().updates;
}
