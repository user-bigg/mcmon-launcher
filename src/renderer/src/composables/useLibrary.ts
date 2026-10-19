import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type { ServerRow } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { InstalledRuntime, ServerInstanceInfo } from '@shared/instance';
import type { LaunchError, LaunchResult } from '@shared/launch';
import type { LibraryEntry, StorageSummary } from '@shared/player';
import { serverEntries, storage as demoStorage } from '../mock/player';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { LoadStatus } from './resource';
import type { CatalogStore } from './useCatalog';

export type CatalogPresence = 'listed' | 'loading' | 'gone' | 'offline';

export interface LibraryStore {
  status: Ref<LoadStatus>;
  entries: ComputedRef<LibraryEntry[]>;
  storage: ComputedRef<StorageSummary | null>;
  sharedBytes: Ref<number>;
  error: ShallowRef<LaunchError | null>;
  load: () => Promise<void>;
  find: (id: string) => LibraryEntry | undefined;
  hasServer: (serverId: number) => boolean;
  installed: (serverId: number) => InstalledRuntime | null;
  presence: (serverId: number) => CatalogPresence;
  remove: (entry: LibraryEntry) => Promise<boolean>;
  dispose: () => void;
}

export function serverEntry(info: ServerInstanceInfo, server: ServerRow | undefined): LibraryEntry {
  const catalogMinecraft = server?.launch.kind === 'direct' ? server.launch.minecraft : '';
  return {
    id: info.folderId,
    name: server?.name ?? fill(ru.library.serverFallback, { id: info.serverId }),
    serverId: info.serverId,
    minecraft: info.installed?.minecraft ?? catalogMinecraft,
    lastPlayedAt: info.lastPlayedAt,
    sizeBytes: info.sizeBytes,
    iconUrl: server?.icon_url ?? null,
    cover: server?.cover ?? null,
  };
}

export function createLibrary(context: LauncherContext, catalog: CatalogStore): LibraryStore {
  const status = ref<LoadStatus>('loading');
  const infos = shallowRef<ServerInstanceInfo[]>([]);
  const demo = shallowRef<LibraryEntry[]>(context.demo ? serverEntries : []);
  const error = shallowRef<LaunchError | null>(null);
  const entries = computed(() => {
    const folders = infos.value.map((info) => serverEntry(info, catalog.server(info.serverId)));
    const known = new Set(folders.map((entry) => entry.id));
    return [...folders, ...demo.value.filter((entry) => !known.has(entry.id))];
  });

  function settle<T>(result: LaunchResult<T>): boolean {
    error.value = result.ok ? null : result.error;
    return result.ok;
  }

  const sharedBytes = ref(context.demo ? demoStorage.sharedBytes : 0);
  const lookups = ref(new Map<number, Exclude<CatalogPresence, 'listed'>>());

  // The cards of servers the launcher has not seen in this session are asked for one by one:
  // a server gone from the catalog cannot be played, a catalog that did not answer can later.
  async function lookUp(serverId: number): Promise<void> {
    lookups.value.set(serverId, 'loading');
    const loaded = await catalog.loadCard(serverId).catch(() => null);
    if (loaded?.status === 'ready') {
      lookups.value.delete(serverId);
    } else {
      lookups.value.set(serverId, loaded?.status === 'missing' ? 'gone' : 'offline');
    }
  }

  function presence(serverId: number): CatalogPresence {
    return catalog.server(serverId) === undefined
      ? (lookups.value.get(serverId) ?? 'loading')
      : 'listed';
  }

  const storage = computed<StorageSummary | null>(() => {
    if (!context.demo) {
      return null;
    }
    const serversBytes = entries.value.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    return {
      ...demoStorage,
      serversBytes,
      sharedBytes: sharedBytes.value,
      usedBytes: serversBytes + sharedBytes.value,
    };
  });

  async function loadShared(): Promise<void> {
    const result = await context.api.instances.sharedFiles().catch(() => null);
    if (result?.ok === true) {
      sharedBytes.value = result.value.bytes;
    }
  }

  async function load(): Promise<void> {
    if (status.value !== 'ready') {
      status.value = 'loading';
    }
    try {
      const result = await context.api.instances.list();
      settle(result);
      if (result.ok) {
        infos.value = result.value;
        if (!context.demo) {
          void loadShared();
        }
        for (const info of result.value) {
          if (catalog.server(info.serverId) === undefined && !lookups.value.has(info.serverId)) {
            void lookUp(info.serverId);
          }
        }
      }
      status.value = result.ok ? 'ready' : 'error';
    } catch {
      status.value = 'error';
    }
  }

  function installed(serverId: number): InstalledRuntime | null {
    return infos.value.find((item) => item.serverId === serverId)?.installed ?? null;
  }

  async function remove(entry: LibraryEntry): Promise<boolean> {
    if (demo.value.some((item) => item.id === entry.id)) {
      demo.value = demo.value.filter((item) => item.id !== entry.id);
      error.value = null;
      return true;
    }
    const ok = settle(await context.api.instances.remove(entry.id));
    if (ok) {
      await load();
    }
    return ok;
  }

  const unsubscribe = context.api.launch.onEvent((event) => {
    if (event.kind === 'phase' && event.phase === 'idle') {
      void load();
    }
  });

  return {
    status,
    entries,
    storage,
    sharedBytes,
    error,
    load,
    find: (id) => entries.value.find((entry) => entry.id === id),
    hasServer: (serverId) => entries.value.some((entry) => entry.serverId === serverId),
    installed,
    presence,
    remove,
    dispose: unsubscribe,
  };
}

export function useLibrary(): LibraryStore {
  return useStores().library;
}
