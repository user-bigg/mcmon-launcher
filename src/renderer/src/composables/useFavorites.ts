import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { AccountError } from '@shared/account';
import type { ServerRow } from '@shared/catalog';
import { isValidServerId } from '@shared/launch';
import { MAX_LIVE_IDS } from '@shared/site';
import { whenVisible } from '../lib/when-visible';
import { favoriteIds } from '../mock/player';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { AccountsStore } from './useAccounts';
import type { CatalogStore } from './useCatalog';
import type { LoadStatus } from './resource';
import { createTrack } from './useTrack';

export interface FavoritesStore {
  ids: ComputedRef<number[]>;
  servers: ComputedRef<ServerRow[]>;
  synced: ComputedRef<boolean>;
  status: ComputedRef<LoadStatus>;
  error: Ref<AccountError | null>;
  has: (id: number) => boolean;
  toggle: (id: number) => Promise<void>;
  refresh: () => void;
  dispose: () => void;
}

const STORAGE_KEY = 'mcmonitor.favorites';
const LIVE_INTERVAL_MS = 20_000;
// The site keeps at most this many favorites per account.
const MAX_FAVORITES = 300;

function readStored(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => isValidServerId(id)).slice(0, MAX_FAVORITES)
      : [];
  } catch {
    return [];
  }
}

function writeStored(ids: readonly number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    return;
  }
}

function toggled(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id].slice(-MAX_FAVORITES);
}

export function createFavorites(
  context: LauncherContext,
  catalog: CatalogStore,
  accounts: AccountsStore,
): FavoritesStore {
  const local = ref<number[]>(context.demo ? [...favoriteIds] : readStored());
  const remote = ref<number[] | null>(null);
  const error = ref<AccountError | null>(null);
  const ids = computed(() => remote.value ?? local.value);
  const servers = computed(() =>
    ids.value.flatMap((id) => {
      const server = catalog.server(id);
      return server === undefined ? [] : [server];
    }),
  );
  let syncing: Promise<void> | null = null;
  const track = createTrack(context);
  const { settled } = accounts;
  const resolving = ref(0);
  // A place that has never heard from the site is loading, not empty.
  const status = computed<LoadStatus>(() => {
    if (context.demo) {
      return 'ready';
    }
    // A session the main process does not have is a guest with the local list, not a failure.
    const refused = error.value !== null && error.value.code !== 'not_signed_in';
    const signedIn = accounts.mc.value !== null && error.value?.code !== 'not_signed_in';
    if (signedIn && remote.value === null && refused) {
      return 'error';
    }
    const listed = settled.value && (!signedIn || remote.value !== null);
    const rowsPending = resolving.value > 0 && servers.value.length < ids.value.length;
    return listed && !rowsPending ? 'ready' : 'loading';
  });

  async function resolveRows(wanted: readonly number[]): Promise<void> {
    resolving.value += 1;
    try {
      await catalog.need(wanted);
    } finally {
      resolving.value -= 1;
    }
  }

  async function pull(merge: boolean): Promise<void> {
    const result = await context.api.site.favorites();
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    error.value = null;
    let list = result.value;
    if (merge) {
      for (const id of local.value.filter((item) => !list.includes(item))) {
        const put = await context.api.site.setFavorite(id, true);
        if (put.ok) {
          list = [...list, id];
        } else {
          error.value = put.error;
        }
      }
    }
    if (accounts.mc.value !== null) {
      remote.value = list;
    }
  }

  function sync(merge: boolean): void {
    if (context.demo || syncing !== null) {
      return;
    }
    syncing = pull(merge).finally(() => {
      syncing = null;
    });
  }

  function revert(id: number): void {
    if (remote.value !== null) {
      remote.value = toggled(remote.value, id);
    }
  }

  function confirm(id: number, favorite: boolean): void {
    const listed = remote.value;
    if (listed !== null && listed.includes(id) !== favorite) {
      remote.value = toggled(listed, id);
    }
  }

  async function toggle(id: number): Promise<void> {
    track({
      type: 'action',
      name: ids.value.includes(id) ? 'favorite_remove' : 'favorite_add',
      server_id: id,
    });
    const current = remote.value;
    if (current === null) {
      local.value = toggled(local.value, id);
      return;
    }
    const favorite = !current.includes(id);
    remote.value = toggled(current, id);
    const result = await context.api.site.setFavorite(id, favorite);
    if (!result.ok) {
      error.value = result.error;
      revert(id);
      return;
    }
    // A list that arrived while the change was on its way must not undo it.
    confirm(id, result.value);
  }

  const stopEvents = accounts.onMcEvent((event) => {
    if (event.change === 'signed-in') {
      sync(true);
    } else if (event.change === 'signed-out' || event.change === 'expired') {
      remote.value = null;
    }
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  const live = whenVisible(() => {
    void catalog.refreshLive(ids.value.slice(0, MAX_LIVE_IDS));
  });
  if (!context.demo) {
    watch(
      () => accounts.mc.value?.id ?? null,
      (id) => {
        if (id === null) {
          remote.value = null;
        } else if (remote.value === null) {
          sync(false);
        }
      },
      { immediate: true },
    );
    watch(local, (value) => {
      writeStored(value);
    });
    watch(
      ids,
      (value) => {
        void resolveRows(value);
      },
      { immediate: true },
    );
    timer = setInterval(live.tick, LIVE_INTERVAL_MS);
  }

  return {
    ids,
    servers,
    synced: computed(() => remote.value !== null),
    status,
    error,
    has: (id) => ids.value.includes(id),
    toggle,
    refresh: (): void => {
      if (accounts.mc.value !== null) {
        error.value = null;
        sync(false);
      }
    },
    dispose: (): void => {
      clearInterval(timer);
      live.dispose();
      stopEvents();
    },
  };
}

export function useFavorites(): FavoritesStore {
  return useStores().favorites;
}
