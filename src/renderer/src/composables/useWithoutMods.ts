import { ref, watch, type Ref } from 'vue';
import { takeLegacyNoMods } from '../lib/skins';
import { useLauncher } from './context';

export interface WithoutMods {
  off: Ref<boolean>;
  set: (off: boolean) => Promise<void>;
}

// The choice lives with the game data in the main process. An early build kept it in the
// window storage: such a record is moved over the first time its server is opened.
export function useWithoutMods(folderId: () => string | null): WithoutMods {
  const { api } = useLauncher();
  const off = ref(false);

  async function set(next: boolean): Promise<void> {
    const id = folderId();
    if (id === null) {
      return;
    }
    const before = off.value;
    off.value = next;
    const saved = await api.instances.setWithoutMods(id, next).catch(() => null);
    if (saved?.ok !== true && folderId() === id) {
      off.value = before;
    }
  }

  async function load(id: string): Promise<void> {
    const stored = await api.instances.launchOptions(id).catch(() => null);
    if (folderId() !== id) {
      return;
    }
    off.value = stored?.ok === true && stored.value.withoutMods;
    if (takeLegacyNoMods(id) && !off.value) {
      await set(true);
    }
  }

  watch(
    folderId,
    (id) => {
      off.value = false;
      if (id !== null) {
        void load(id);
      }
    },
    { immediate: true },
  );

  return { off, set };
}
