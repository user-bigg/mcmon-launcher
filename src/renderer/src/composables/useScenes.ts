import { computed, ref, shallowRef, type Ref } from 'vue';
import type { Scene, SceneTime } from '@shared/scenes';
import {
  pickScene,
  type LayerRef,
  type LayerSource,
  type ScenePick,
  type ScenePlace,
} from '../lib/landscape';
import {
  BUILTIN_SCENE,
  BUILTIN_SCENE_KEY,
  builtinLayerUrl,
  STAND_IN_AFTER_MS,
} from '../lib/builtin-scene';
import { demoScenes } from '../mock/scenes-demo';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { LoadStatus } from './resource';

export interface ScenesStore {
  status: Ref<LoadStatus>;
  base: LayerSource;
  scene: (key: string) => Scene | undefined;
  sceneFor: (place: ScenePlace, at?: Date) => ScenePick | undefined;
  prefetch: (pick: ScenePick | undefined) => void;
  ready: (pick: ScenePick) => boolean;
  load: () => Promise<void>;
  dispose: () => void;
}

type FolderFiles = Record<string, string>;

const RETRY_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

function retryDelay(failures: number): number {
  return Math.min(RETRY_MS * 2 ** Math.max(failures - 1, 0), RETRY_MAX_MS);
}

function whenOnlineOrAfter(ms: number, run: () => void): () => void {
  const events = typeof window === 'undefined' ? undefined : window;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const cancel = (): void => {
    clearTimeout(timer);
    events?.removeEventListener('online', fire);
  };
  const fire = (): void => {
    cancel();
    run();
  };
  timer = setTimeout(fire, ms);
  events?.addEventListener('online', fire);
  return cancel;
}

function folderOf(scene: string, time: SceneTime): string {
  return `${scene}-${time}`;
}

export function createScenes(context: LauncherContext): ScenesStore {
  const scenes = shallowRef<Scene[]>(context.demo ? demoScenes : []);
  const status = ref<LoadStatus>(context.demo ? 'ready' : 'loading');
  const files = ref<Record<string, FolderFiles>>({});
  const requested = new Set<string>();
  const failed = new Map<string, { scene: string; time: SceneTime }>();
  let folderFailures = 0;
  let folderRetryPending = false;
  let disposed = false;
  const pendingRetries = new Set<() => void>();
  // A manifest that is not there in time, or failed, is stood in for by the built-in scene,
  // until the real one comes.
  const late = ref(false);
  const lateTimer = context.demo
    ? undefined
    : setTimeout(() => {
        late.value = true;
      }, STAND_IN_AFTER_MS);
  const standIn = computed(() => late.value && scenes.value.length === 0);

  function retry(ms: number, run: () => void): void {
    if (disposed) {
      return;
    }
    const cancel = whenOnlineOrAfter(ms, () => {
      pendingRetries.delete(cancel);
      run();
    });
    pendingRetries.add(cancel);
  }

  function retryFolders(): void {
    if (folderRetryPending) {
      return;
    }
    folderRetryPending = true;
    folderFailures += 1;
    retry(retryDelay(folderFailures), () => {
      folderRetryPending = false;
      const pending = [...failed.values()];
      failed.clear();
      for (const item of pending) {
        void ensure(item.scene, item.time);
      }
    });
  }

  async function ensure(scene: string, time: SceneTime): Promise<void> {
    const folder = folderOf(scene, time);
    const result = await context.api.site.ensureScene(scene, time);
    if (result.ok) {
      files.value = { ...files.value, [folder]: result.value.layers };
      if (failed.size === 0 && !folderRetryPending) {
        folderFailures = 0;
      }
      return;
    }
    failed.set(folder, { scene, time });
    retryFolders();
  }

  function base(layer: LayerRef): string {
    if (layer.scene === BUILTIN_SCENE_KEY) {
      return builtinLayerUrl(layer);
    }
    const folder = folderOf(layer.scene, layer.time);
    const ready = files.value[folder];
    if (ready === undefined && !requested.has(folder)) {
      requested.add(folder);
      queueMicrotask(() => {
        void ensure(layer.scene, layer.time);
      });
    }
    return ready?.[layer.layer] ?? '';
  }

  let listRetryPending = false;

  function retryLater(): void {
    if (listRetryPending) {
      return;
    }
    listRetryPending = true;
    retry(RETRY_MS, () => {
      listRetryPending = false;
      void load();
    });
  }

  async function load(): Promise<void> {
    if (context.demo) {
      return;
    }
    const result = await context.api.site.scenes();
    clearTimeout(lateTimer);
    if (result.ok) {
      scenes.value = result.value;
    } else if (scenes.value.length === 0) {
      retryLater();
    }
    late.value = scenes.value.length === 0;
    status.value = result.ok ? 'ready' : 'error';
  }

  return {
    status,
    base,
    scene: (key) =>
      scenes.value.find((scene) => scene.key === key) ??
      (standIn.value ? BUILTIN_SCENE : undefined),
    sceneFor: (place, at = context.now()) =>
      pickScene(scenes.value, place, at) ??
      (standIn.value ? { scene: BUILTIN_SCENE, time: 'day', holiday: false } : undefined),
    prefetch: (pick): void => {
      if (pick === undefined || pick.scene.key === BUILTIN_SCENE_KEY) {
        return;
      }
      const folder = folderOf(pick.scene.key, pick.time);
      if (!requested.has(folder)) {
        requested.add(folder);
        void ensure(pick.scene.key, pick.time);
      }
    },
    ready: (pick): boolean =>
      pick.scene.key === BUILTIN_SCENE_KEY ||
      files.value[folderOf(pick.scene.key, pick.time)] !== undefined,
    load,
    dispose: (): void => {
      disposed = true;
      clearTimeout(lateTimer);
      for (const cancel of pendingRetries) {
        cancel();
      }
      pendingRetries.clear();
    },
  };
}

export function useScenes(): ScenesStore {
  return useStores().scenes;
}
