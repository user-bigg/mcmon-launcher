import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import type { LookPresets } from '@shared/look';
import type { SiteError } from '@shared/site';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { LoadStatus } from './resource';

export interface WardrobeStore {
  status: Ref<LoadStatus>;
  error: ShallowRef<SiteError | null>;
  presets: ShallowRef<LookPresets | null>;
  standardSkin: Ref<string | null>;
  load: () => Promise<void>;
}

const FAILED: SiteError = { code: 'server-error' };

export function createWardrobe(context: LauncherContext): WardrobeStore {
  const status = ref<LoadStatus>('loading');
  const error = shallowRef<SiteError | null>(null);
  const presets = shallowRef<LookPresets | null>(null);
  const standardSkin = ref<string | null>(null);
  let asked = 0;

  async function loadStandard(): Promise<void> {
    standardSkin.value ??= await context.api.site.standardSkin().catch(() => null);
  }

  async function load(): Promise<void> {
    asked += 1;
    const ticket = asked;
    void loadStandard();
    if (presets.value === null) {
      status.value = 'loading';
    }
    const result = await context.api.site
      .lookPresets()
      .catch(() => ({ ok: false as const, error: FAILED }));
    if (ticket !== asked) {
      return;
    }
    if (result.ok) {
      presets.value = result.value;
      error.value = null;
      status.value = 'ready';
      return;
    }
    if (presets.value === null) {
      error.value = result.error;
      status.value = 'error';
    }
  }

  return { status, error, presets, standardSkin, load };
}

export function useWardrobe(): WardrobeStore {
  return useStores().wardrobe;
}
