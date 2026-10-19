import { computed, reactive, ref, shallowRef, type ComputedRef, type Ref } from 'vue';
import type { ServerCard, ServerList, ServerRow } from '@shared/catalog';
import type { InstallEstimate, PingSample } from '@shared/player';
import { formatServerAddress } from '@shared/server-address';
import {
  MAX_LIVE_IDS,
  MAX_PER_PAGE,
  type ServerAccessFilter,
  type ServerSort,
  type SiteChange,
  type SiteError,
} from '@shared/site';
import { POPULAR_COUNT } from '../lib/home-pick';
import {
  catalog,
  catalogLive,
  installEstimates,
  pingOf,
  serverCard,
  votesTop,
} from '../mock/servers';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { LoadStatus } from './resource';

export interface CatalogQuery {
  q: string;
  sort: ServerSort;
  access?: ServerAccessFilter | undefined;
}

export type CardLoad =
  | { status: 'ready'; card: ServerCard; stale: boolean; fetchedAt: string }
  | { status: 'missing' }
  | { status: 'error'; error: SiteError };

export interface CatalogStore {
  status: Ref<LoadStatus>;
  stale: Ref<boolean>;
  fetchedAt: Ref<string | null>;
  error: Ref<SiteError | null>;
  query: Readonly<Ref<CatalogQuery>>;
  listQuery: Readonly<Ref<CatalogQuery | null>>;
  servers: ComputedRef<ServerRow[]>;
  topSlots: ComputedRef<ServerRow[]>;
  popular: ComputedRef<ServerRow[]>;
  total: ComputedRef<number>;
  online: ComputedRef<number | null>;
  updatedAt: ComputedRef<string | null>;
  hasMore: ComputedRef<boolean>;
  server: (id: number) => ServerRow | undefined;
  ping: (id: number) => PingSample;
  estimate: (id: number) => InstallEstimate | undefined;
  card: (id: number) => Promise<ServerCard | null>;
  loadCard: (id: number) => Promise<CardLoad>;
  need: (ids: readonly number[]) => Promise<void>;
  refreshLive: (ids: readonly number[]) => Promise<void>;
  setQuery: (patch: Partial<CatalogQuery>) => Promise<void>;
  more: () => Promise<void>;
  load: () => Promise<void>;
  loadPopular: () => Promise<void>;
  siteChanged: (change: SiteChange) => void;
}

const EMPTY: ServerList = {
  data: [],
  topSlots: { diamond: [], gold: [] },
  topSlotsFree: { diamond: 0, gold: 0 },
  meta: { page: 1, per_page: MAX_PER_PAGE, total: 0 },
};
const PING_INTERVAL_MS = 20_000;
const NO_PING: PingSample = { ms: null };

export function createCatalog(
  context: LauncherContext,
  watchCard: () => (card: ServerCard) => void = () => () => undefined,
): CatalogStore {
  const status = ref<LoadStatus>('loading');
  const stale = ref(false);
  const fetchedAt = ref<string | null>(null);
  const error = ref<SiteError | null>(null);
  const query = ref<CatalogQuery>({ q: '', sort: 'rating' });
  const listQuery = ref<CatalogQuery | null>(null);
  const list = shallowRef<ServerList>(EMPTY);
  const popularRows = shallowRef<ServerRow[]>([]);
  const known = reactive(new Map<number, ServerRow>());
  const pings = reactive(new Map<number, PingSample>());
  const pingedAt = new Map<number, number>();
  let generation = 0;
  let popularGeneration = 0;

  function remember(rows: readonly ServerRow[]): void {
    for (const row of rows) {
      known.set(row.id, row);
    }
  }

  const servers = computed(() => list.value.data);
  const listMatchesQuery = (): boolean =>
    listQuery.value !== null &&
    listQuery.value.q === query.value.q &&
    listQuery.value.sort === query.value.sort &&
    listQuery.value.access === query.value.access;
  const topSlots = computed(() => [...list.value.topSlots.diamond, ...list.value.topSlots.gold]);

  async function fetchPage(page: number): Promise<void> {
    const current = (generation += 1);
    const asked = { ...query.value };
    const { q, sort, access } = asked;
    const result = await context.api.site.servers({
      sort,
      page,
      per_page: MAX_PER_PAGE,
      ...(q === '' ? {} : { q }),
      ...(access === undefined ? {} : { access }),
    });
    if (current !== generation) {
      return;
    }
    if (!result.ok) {
      error.value = result.error;
      status.value = list.value.data.length > 0 && page > 1 ? 'ready' : 'error';
      return;
    }
    const value = result.value;
    remember([...value.data, ...value.topSlots.diamond, ...value.topSlots.gold]);
    list.value =
      page === 1
        ? value
        : { ...value, data: [...list.value.data, ...value.data], topSlots: list.value.topSlots };
    listQuery.value = asked;
    stale.value = result.stale && result.refreshing !== true;
    fetchedAt.value = result.fetchedAt;
    error.value = null;
    status.value = 'ready';
  }

  async function load(): Promise<void> {
    if (context.demo) {
      list.value = catalog;
      listQuery.value = { ...query.value };
      remember([...catalog.data, ...catalog.topSlots.diamond, ...catalog.topSlots.gold]);
      status.value = 'ready';
      return;
    }
    if (list.value.data.length === 0) {
      status.value = 'loading';
    }
    await fetchPage(1);
  }

  async function loadPopular(): Promise<void> {
    if (context.demo) {
      remember(votesTop);
      popularRows.value = votesTop;
      return;
    }
    const current = (popularGeneration += 1);
    const result = await context.api.site.servers({
      sort: 'votes',
      page: 1,
      per_page: POPULAR_COUNT,
    });
    if (current !== popularGeneration) {
      return;
    }
    if (!result.ok) {
      return;
    }
    remember(result.value.data);
    popularRows.value = result.value.data;
  }

  async function loadCard(id: number): Promise<CardLoad> {
    if (context.demo) {
      const card = serverCard(id);
      return card === undefined
        ? { status: 'missing' }
        : { status: 'ready', card, stale: false, fetchedAt: new Date(0).toISOString() };
    }
    const onCard = watchCard();
    const result = await context.api.site.server(id);
    if (!result.ok) {
      return result.error.code === 'not-found'
        ? { status: 'missing' }
        : { status: 'error', error: result.error };
    }
    known.set(id, result.value);
    onCard(result.value);
    return {
      status: 'ready',
      card: result.value,
      stale: result.stale && result.refreshing !== true,
      fetchedAt: result.fetchedAt,
    };
  }

  async function need(ids: readonly number[]): Promise<void> {
    const missing = ids.filter((id) => !known.has(id));
    await Promise.all(missing.map((id) => loadCard(id)));
  }

  async function refreshLive(ids: readonly number[]): Promise<void> {
    const wanted = ids.filter((id) => known.has(id)).slice(0, MAX_LIVE_IDS);
    if (context.demo || wanted.length === 0) {
      return;
    }
    const result = await context.api.site.live(wanted);
    if (!result.ok) {
      return;
    }
    for (const live of result.value) {
      const row = known.get(live.id);
      if (row !== undefined) {
        known.set(live.id, {
          ...row,
          online: live.online,
          max_players: live.max ?? row.max_players,
          status: live.up ? 'online' : 'offline',
        });
      }
    }
  }

  function showsFirstPage(asked: SiteChange & { topic: 'servers' }): boolean {
    const shown = listQuery.value;
    const { q, sort, access, page, per_page: perPage } = asked.query;
    return (
      shown !== null &&
      (page ?? 1) === 1 &&
      list.value.meta.page === 1 &&
      perPage === MAX_PER_PAGE &&
      sort === shown.sort &&
      (q ?? '') === shown.q &&
      access === shown.access &&
      listMatchesQuery()
    );
  }

  // The main process answered with what it had and has now heard from the site.
  function siteChanged(change: SiteChange): void {
    if (context.demo) {
      return;
    }
    if (change.topic === 'live') {
      void refreshLive(change.ids);
    } else if (change.topic === 'server' && known.has(change.id)) {
      void loadCard(change.id);
    } else if (change.topic === 'servers') {
      if (change.query.sort === 'votes' && change.query.per_page === POPULAR_COUNT) {
        void loadPopular();
      } else if (showsFirstPage(change)) {
        void fetchPage(1);
      }
    }
  }

  function ping(id: number): PingSample {
    if (context.demo) {
      return pingOf(id);
    }
    const row = known.get(id);
    const last = pingedAt.get(id) ?? 0;
    if (row?.edition === 'java' && Date.now() - last >= PING_INTERVAL_MS) {
      pingedAt.set(id, Date.now());
      void context.api.site.ping(formatServerAddress(row.address)).then((result) => {
        pings.set(id, result.ok ? { ms: result.value.ms } : NO_PING);
      });
    }
    return pings.get(id) ?? NO_PING;
  }

  return {
    status,
    stale,
    fetchedAt,
    error,
    query,
    listQuery,
    servers: computed(() => servers.value.map((row) => known.get(row.id) ?? row)),
    topSlots,
    popular: computed(() => popularRows.value.map((row) => known.get(row.id) ?? row)),
    total: computed(() => list.value.meta.total),
    online: computed(() =>
      context.demo ? catalogLive.online : (list.value.meta.online_total ?? null),
    ),
    updatedAt: computed(() =>
      context.demo ? catalogLive.updatedAt : (list.value.meta.updated_at ?? null),
    ),
    hasMore: computed(() => list.value.data.length < list.value.meta.total),
    server: (id) => known.get(id),
    ping,
    estimate: (id) => (context.demo ? installEstimates[id] : undefined),
    card: async (id): Promise<ServerCard | null> => {
      const loaded = await loadCard(id);
      return loaded.status === 'ready' ? loaded.card : null;
    },
    loadCard,
    need,
    refreshLive,
    setQuery: async (patch): Promise<void> => {
      const next = { ...query.value, ...patch };
      if (
        next.q === query.value.q &&
        next.sort === query.value.sort &&
        next.access === query.value.access
      ) {
        return;
      }
      query.value = next;
      if (context.demo) {
        listQuery.value = { ...next };
        return;
      }
      status.value = 'loading';
      await fetchPage(1);
    },
    more: async (): Promise<void> => {
      if (
        !context.demo &&
        status.value === 'ready' &&
        listMatchesQuery() &&
        list.value.data.length < list.value.meta.total
      ) {
        await fetchPage(list.value.meta.page + 1);
      }
    },
    load,
    loadPopular,
    siteChanged,
  };
}

export function useCatalog(): CatalogStore {
  return useStores().catalog;
}
