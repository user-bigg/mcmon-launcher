<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { isLauncherOnly, type ServerRow } from '@shared/catalog';
import type { ServerAccessFilter, ServerSort } from '@shared/site';
import type { CatalogTab, PlaySource } from '@shared/telemetry';
import { countOf, fill, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import BiIcon from '../components/BiIcon.vue';
import ServerCard from '../components/ServerCard.vue';
import ServerRowItem from '../components/ServerRowItem.vue';
import SiteErrorState from '../components/SiteErrorState.vue';
import SkelBar from '../components/SkelBar.vue';
import StaleNote from '../components/StaleNote.vue';
import StateNotice from '../components/StateNotice.vue';
import UiButton from '../components/UiButton.vue';
import UiSegmented from '../components/UiSegmented.vue';
import UiTabs from '../components/UiTabs.vue';
import { useLauncher } from '../composables/context';
import { useAccounts } from '../composables/useAccounts';
import { useCatalog } from '../composables/useCatalog';
import { useVisibleInterval } from '../composables/useVisibleInterval';
import { useFavorites } from '../composables/useFavorites';
import { useFeed } from '../composables/useFeed';
import { useLibrary } from '../composables/useLibrary';
import { useSite } from '../composables/useSite';
import { useTrack } from '../composables/useTrack';
import { ROW_COLUMNS } from '../lib/catalog-columns';
import { minutesAgo } from '../lib/time';

type View = 'list' | 'cards';
type Tab = CatalogTab;

const SEARCH_DELAY_MS = 300;
const REFRESH_INTERVAL_MS = 60_000;
const SKELETON_ROWS = 7;

const { now, demo } = useLauncher();
const route = useRoute();
const catalog = useCatalog();
const favorites = useFavorites();
const feed = useFeed();
const library = useLibrary();
const siteLinks = useSite().links;

const accounts = useAccounts();
const track = useTrack();
const ACCOUNT_FITS_DEFAULT = accounts.player.value !== null;

const view = ref<View>('list');
const tab = ref<Tab>('rating');
const accountFits = ref(ACCOUNT_FITS_DEFAULT);
const query = ref('');

const accessFilter = computed<ServerAccessFilter | undefined>(() => {
  if (!accountFits.value) {
    return undefined;
  }
  const provider = accounts.player.value?.provider;
  return provider === undefined ? undefined : provider === 'microsoft' ? 'all' : 'nolicense';
});

const filtered = computed(
  () => query.value.trim() !== '' || accountFits.value !== ACCOUNT_FITS_DEFAULT,
);

function resetFilters(): void {
  query.value = '';
  accountFits.value = ACCOUNT_FITS_DEFAULT;
}

watch(
  () => route.query.q,
  (q) => {
    query.value = typeof q === 'string' ? q : '';
  },
  { immediate: true },
);

const views = [
  { value: 'list' as const, label: ru.catalog.viewList, icon: 'list-ul' as const },
  { value: 'cards' as const, label: ru.catalog.viewCards, icon: 'grid' as const },
];
const tabs = computed(() => [
  { value: 'rating' as const, label: ru.catalog.tabRating },
  { value: 'online' as const, label: ru.catalog.tabOnline },
  { value: 'new' as const, label: ru.catalog.tabNew },
  {
    value: 'favorites' as const,
    label: ru.catalog.tabFavorites,
    count: favorites.ids.value.length,
  },
]);

const tabSorts: Record<Tab, ServerSort> = {
  rating: 'rating',
  online: 'online',
  new: 'new',
  favorites: 'rating',
};

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, (text) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void search(text);
  }, SEARCH_DELAY_MS);
});
watch(tab, (value) => {
  track({ type: 'action', name: 'tab', server_id: null, tab: value });
  if (value !== 'favorites') {
    void catalog.setQuery({ sort: tabSorts[value] });
  }
});
watch(accessFilter, (access) => {
  void catalog.setQuery({ access });
});

useVisibleInterval(() => {
  void catalog.load();
}, REFRESH_INTERVAL_MS);
onMounted(() => {
  void catalog.setQuery({
    q: query.value.trim(),
    sort: tabSorts[tab.value],
    access: accessFilter.value,
  });
  void catalog.load();
});
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
});

async function search(text: string): Promise<void> {
  const needle = text.trim();
  await catalog.setQuery({ q: needle });
  if (needle === '' || query.value !== text || catalog.status.value !== 'ready') {
    return;
  }
  track({
    type: 'action',
    name: 'search',
    server_id: null,
    length: needle.length,
    results: tab.value === 'favorites' ? rows.value.length : catalog.total.value,
  });
}
const sorters: Record<Tab, (list: ServerRow[]) => ServerRow[]> = {
  rating: (list) => list.toSorted((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)),
  online: (list) => list.toSorted((a, b) => b.online - a.online),
  new: (list) => list.toSorted((a, b) => b.id - a.id),
  favorites: () => favorites.servers.value,
};

function matches(server: ServerRow, text: string): boolean {
  const needle = text.trim().toLocaleLowerCase('ru');
  return (
    needle === '' ||
    server.name.toLocaleLowerCase('ru').includes(needle) ||
    (!isLauncherOnly(server.launch) && server.address.host.includes(needle))
  );
}

const rows = computed(() => {
  const sorted = sorters[tab.value](catalog.servers.value);
  return demo || tab.value === 'favorites'
    ? sorted.filter((server) => matches(server, query.value))
    : sorted;
});
const rowSource = computed<PlaySource>(() => (tab.value === 'favorites' ? 'favorites' : 'catalog'));
const staleAt = computed(() =>
  catalog.stale.value || catalog.status.value === 'error' ? catalog.fetchedAt.value : null,
);
const hasData = computed(() => catalog.listQuery.value !== null);
const favoritesPending = computed(
  () =>
    tab.value === 'favorites' &&
    favorites.status.value === 'loading' &&
    favorites.servers.value.length === 0,
);
const loading = computed(
  () => (catalog.status.value === 'loading' && !hasData.value) || favoritesPending.value,
);
const failed = computed(
  () => catalog.status.value === 'error' && staleAt.value === null && !hasData.value,
);
const showTable = computed(() => !failed.value);
const searching = computed(() => query.value.trim() !== '');
const emptyTitle = computed(() => {
  if (searching.value) {
    return fill(ru.catalog.emptySearch, { query: query.value.trim() });
  }
  if (tab.value === 'favorites') {
    return ru.catalog.emptyFavorites;
  }
  if (tab.value === 'new') {
    return ru.catalog.emptyNew;
  }
  return ru.catalog.empty;
});
const topSlotRows = computed(() =>
  tab.value === 'rating' || tab.value === 'online' ? catalog.topSlots.value : [],
);
const remaining = computed(() =>
  Math.min(50, Math.max(catalog.total.value - catalog.servers.value.length, 0)),
);

const summary = computed(() => {
  const servers = countOf(catalog.total.value, ru.plural.servers);
  const online = catalog.online.value;
  const updatedAt = catalog.updatedAt.value;
  if (online === null || updatedAt === null) {
    return fill(ru.catalog.summaryShort, { servers });
  }
  return fill(ru.catalog.summary, {
    servers,
    players: countOf(online, ru.plural.players),
    ago: minutesAgo(updatedAt, now()),
  });
});
</script>

<template>
  <div class="lx-content catalog" :style="{ '--lx-row-columns': ROW_COLUMNS }">
    <div class="lx-head-row">
      <div>
        <h1 class="lx-h1">{{ ru.catalog.title }}</h1>
        <p v-if="loading" class="lx-sub" aria-hidden="true">
          <SkelBar class="sub-skel" :w="300" :h="16" />
        </p>
        <div v-else-if="staleAt !== null" class="lx-sub">
          <StaleNote :at="staleAt" @retry="catalog.load()" />
        </div>
        <p v-else-if="hasData" class="lx-sub lx-num">{{ summary }}</p>
      </div>
      <UiSegmented v-model="view" :options="views" :label="ru.catalog.view" />
    </div>

    <div class="toolbar" role="group" :aria-label="ru.catalog.filters">
      <label class="search">
        <BiIcon name="search" />
        <input
          v-model="query"
          type="search"
          :placeholder="ru.catalog.search"
          :aria-label="ru.catalog.search"
        />
      </label>
      <button
        type="button"
        class="chip"
        :class="{ 'is-on': accountFits }"
        :aria-pressed="accountFits"
        @click="accountFits = !accountFits"
      >
        <BiIcon v-if="accountFits" name="check2" />{{ ru.catalog.accountFits }}
      </button>
    </div>

    <UiTabs
      v-model="tab"
      class="tabs"
      :tabs="tabs"
      :label="ru.catalog.sorting"
      panel="catalog-panel"
    />

    <SiteErrorState
      v-if="failed"
      class="state"
      :error="catalog.error.value"
      @retry="catalog.load()"
    />

    <div v-if="showTable" id="catalog-panel" role="tabpanel" :aria-label="ru.catalog.rating">
      <div v-if="view === 'list'" class="table-head">
        <span class="end" aria-hidden="true">{{ ru.catalog.columnRank }}</span>
        <span />
        <span aria-hidden="true">{{ ru.catalog.columnServer }}</span>
        <span aria-hidden="true">{{ ru.catalog.columnVersion }}</span>
        <span aria-hidden="true">{{ ru.catalog.columnOnline }}</span>
        <span aria-hidden="true">{{ ru.catalog.columnScore }}</span>
        <span />
      </div>
      <section
        v-if="topSlotRows.length > 0"
        class="top-slots-block"
        :class="{ 'is-cards': view !== 'list' }"
        :aria-label="ru.topSlots.block"
      >
        <div class="top-slots-head">
          <span>{{ ru.topSlots.block }}</span>
          <UiButton class="top-slots-link" size="sm" :href="siteLinks.promote">
            {{ ru.topSlots.howTo }}<BiIcon name="arrow-right" />
          </UiButton>
        </div>
        <ul v-if="view === 'list'" class="rows top-slots">
          <ServerRowItem
            v-for="server in topSlotRows"
            :key="server.id"
            :server="server"
            source="top_slot"
          />
        </ul>
        <div v-else class="lx-grid-3">
          <ServerCard
            v-for="server in topSlotRows"
            :key="server.id"
            class="slot-card"
            :class="server.topSlot ? `is-${server.topSlot.tier}` : undefined"
            :server="server"
            source="top_slot"
          />
        </div>
      </section>

      <template v-if="view === 'list'">
        <ul v-if="loading" class="rows" data-loading role="status" :aria-label="ru.state.loading">
          <li v-for="index in SKELETON_ROWS" :key="index" class="skel-row">
            <SkelBar class="skel-rank" :w="16" :h="12" />
            <SkelBar :w="44" :h="44" />
            <span class="skel-main">
              <SkelBar w="45%" :h="15" />
              <SkelBar w="30%" :h="18" round />
            </span>
            <SkelBar :w="72" :h="22" />
            <SkelBar :w="48" :h="15" />
            <SkelBar :w="56" :h="13" />
            <SkelBar class="skel-action" :w="96" :h="32" />
          </li>
        </ul>
        <ul v-else class="rows" :aria-label="ru.catalog.rating">
          <ServerRowItem
            v-for="(server, index) in rows"
            :key="server.id"
            :server="server"
            :position="tab === 'rating' ? server.rank : index + 1"
            :favorite="favorites.has(server.id)"
            :installed="library.hasServer(server.id)"
            :source="rowSource"
          />
        </ul>
      </template>

      <div
        v-else-if="loading"
        class="lx-grid-3 cards"
        data-loading
        role="status"
        :aria-label="ru.state.loading"
      >
        <div v-for="index in 6" :key="index" class="lx-skel-frame skel-card">
          <SkelBar :w="40" :h="40" />
          <SkelBar w="70%" :h="16" />
          <SkelBar w="90%" :h="13" />
          <SkelBar :w="96" :h="22" />
        </div>
      </div>
      <div v-else class="lx-grid-3 cards">
        <ServerCard
          v-for="server in rows"
          :key="server.id"
          :server="server"
          :vote-available="feed.voteAvailable(server.id)"
          :source="rowSource"
        />
      </div>
      <StateNotice
        v-if="catalog.status.value === 'ready' && !loading && rows.length === 0"
        class="state"
        :icon="
          searching ? 'search' : tab === 'favorites' ? 'heart' : tab === 'new' ? 'stars' : 'search'
        "
        :title="emptyTitle"
        :text="searching ? ru.catalog.emptySearchHint : undefined"
      >
        <UiButton v-if="filtered" size="sm" icon="x-lg" @click="resetFilters">
          {{ ru.catalog.resetFilters }}
        </UiButton>
        <UiButton
          v-if="tab !== 'favorites' && tab !== 'new'"
          size="sm"
          icon="box-arrow-up-right"
          :href="siteLinks.add_server"
        >
          {{ ru.catalog.emptyHint }}
        </UiButton>
      </StateNotice>
      <UiButton
        v-if="
          tab !== 'favorites' &&
          remaining > 0 &&
          catalog.status.value === 'ready' &&
          rows.length > 0
        "
        class="more"
        block
        @click="catalog.more()"
      >
        {{ fill(ru.catalog.showMore, { count: formatNumber(remaining) }) }}
      </UiButton>
    </div>

    <div v-if="hasData && rows.length > 0" class="footnote">
      <BiIcon name="info-circle" />
      <span>{{ ru.catalog.footnote }}</span>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  color: var(--lx-text-faint);
}

.search:focus-within {
  border-color: color-mix(in srgb, var(--mc-accent) 50%, transparent);
  box-shadow: 0 0 0 3px var(--mc-accent-soft);
}

.search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--mc-text);
  font-size: 14px;
}

.search input::placeholder {
  color: var(--lx-text-faint);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  color: var(--mc-text-muted);
  font-size: 13px;
  font-weight: 400;
  white-space: nowrap;
}

.chip:hover {
  border-color: var(--mc-border-strong);
  color: var(--mc-text);
}

.chip.is-on {
  background: var(--mc-accent-soft);
  border-color: color-mix(in srgb, var(--mc-accent) 35%, transparent);
  color: var(--mc-accent);
}

.tabs {
  margin-top: 16px;
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.top-slots-block {
  margin: 6px -11px 12px;
  padding: 10px;
  border: 1px dashed var(--mc-border-strong);
  border-radius: calc(var(--mc-radius) + 4px);
}

.top-slots-block.is-cards {
  margin-top: 20px;
  margin-bottom: 20px;
}

.top-slots-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.is-cards > .top-slots-head {
  margin-bottom: 10px;
}

.top-slots-head .top-slots-link {
  gap: 4px;
  height: 22px;
  padding: 0 6px;
  margin-right: -6px;
  border-color: transparent;
  background: transparent;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.top-slots-head .top-slots-link:hover {
  background: var(--mc-surface-2);
  color: var(--mc-text);
}

.slot-card.is-diamond {
  border-color: color-mix(in srgb, var(--mc-diamond) 45%, transparent);
}

.slot-card.is-gold {
  border-color: color-mix(in srgb, var(--mc-gold) 45%, transparent);
}

.top-slots {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.top-slots > * + * {
  margin-top: 0;
}

.table-head {
  display: grid;
  grid-template-columns: var(--lx-row-columns);
  align-items: center;
  gap: 14px;
  height: 32px;
  margin-top: 16px;
  padding: 0 15px;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.end {
  text-align: right;
}

.cards {
  margin-top: 16px;
}

.footnote {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--lx-text-faint);
}

.more {
  margin-top: 16px;
}

.state {
  margin-top: 16px;
}

.sub-skel {
  margin: 3px 0;
}

.skel-row {
  display: grid;
  grid-template-columns: var(--lx-row-columns);
  align-items: center;
  gap: 14px;
  height: 68px;
  padding: 0 15px;
}

.skel-row + .skel-row {
  margin-top: 2px;
}

.skel-rank {
  justify-self: end;
}

.skel-main {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.skel-action {
  justify-self: end;
}

.skel-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 176px;
  padding: 14px;
}

@media (max-width: 1099px) {
  .search {
    flex-basis: 100%;
  }
}
</style>
