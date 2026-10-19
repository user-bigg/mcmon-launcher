import { computed, reactive, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  type LauncherSettings,
  type SettingsPatch,
  type SettingsResult,
} from '@shared/settings';
import { settings as mockSettings } from '../mock/player';
import type { LauncherContext } from './context';
import { useStores } from './context';

export { CHANNELS, SPEED_LIMITS, WHILE_GAME } from '@shared/settings';
export type { Channel, SpeedLimit, WhileGame } from '@shared/settings';

export type SettingsState = LauncherSettings;

export type MachineInfo = typeof mockSettings;

export const SAVE_DELAY_MS = 300;

export interface SettingsStore {
  state: SettingsState;
  machine: MachineInfo;
  ready: Ref<boolean>;
  memoryMb: ComputedRef<number | undefined>;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
  dispose: () => void;
}

function changes(next: LauncherSettings, saved: LauncherSettings): SettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    if (next[key] !== saved[key]) {
      patch[key] = next[key];
    }
  }
  return patch;
}

export function createSettings(context: LauncherContext): SettingsStore {
  const machine = mockSettings;
  const state = reactive<LauncherSettings>({ ...DEFAULT_SETTINGS });
  const ready = ref(false);
  let saved: LauncherSettings = { ...DEFAULT_SETTINGS };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> = Promise.resolve();

  function adopt(result: SettingsResult): void {
    if (result.ok) {
      saved = { ...result.value };
      Object.assign(state, result.value);
    }
  }

  async function send(): Promise<void> {
    timer = null;
    const patch = changes(state, saved);
    if (Object.keys(patch).length === 0) {
      return;
    }
    saved = { ...saved, ...patch };
    const result = await context.api.settings.update(patch);
    adopt(result.ok ? result : await context.api.settings.get());
  }

  function schedule(): void {
    if (!ready.value) {
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      pending = send().catch(() => undefined);
    }, SAVE_DELAY_MS);
  }

  const stop = watch(() => ({ ...state }), schedule);

  void context.api.settings
    .get()
    .then(adopt)
    .catch(() => undefined)
    .finally(() => {
      ready.value = true;
    });

  const memoryMb = computed(() => (state.autoMemory ? undefined : state.ramGb * 1024));
  return {
    state,
    machine,
    ready,
    memoryMb,
    flush: async (): Promise<void> => {
      if (timer !== null) {
        clearTimeout(timer);
        pending = send().catch(() => undefined);
      }
      await pending;
    },
    reload: async (): Promise<void> => {
      adopt(await context.api.settings.get());
    },
    dispose: (): void => {
      stop();
      if (timer !== null) {
        clearTimeout(timer);
      }
    },
  };
}

export function useSettings(): SettingsStore {
  return useStores().settings;
}
