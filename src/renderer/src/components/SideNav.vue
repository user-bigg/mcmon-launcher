<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch, watchEffect } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import type { ServerRow } from '@shared/catalog';
import { fill, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { useAccounts } from '../composables/useAccounts';
import { useCatalog } from '../composables/useCatalog';
import { useFavorites } from '../composables/useFavorites';
import { useLibrary } from '../composables/useLibrary';
import { useMods } from '../composables/useMods';
import { useOwner } from '../composables/useOwner';
import { ghostRows, MAX_GHOST_ROWS, rowsFitting } from '../lib/ghost-rows';
import type { Section } from '../router';
import BiIcon from './BiIcon.vue';
import type { IconName } from './icons';
import OnlineCount from './OnlineCount.vue';
import PlayerHead from './PlayerHead.vue';
import SkinFace from './SkinFace.vue';
import ProviderMark from './ProviderMark.vue';
import ServerIcon from './ServerIcon.vue';
import SkelBar from './SkelBar.vue';

interface NavItem {
  section: Section;
  to: string;
  icon: IconName;
  label: string;
  count?: string;
  mark?: string;
}

const route = useRoute();
const catalog = useCatalog();
const library = useLibrary();
const favorites = useFavorites();
const accounts = useAccounts();
const owner = useOwner();
const mods = useMods();
const account = computed(() => accounts.player.value);
const nickMissing = computed(() => accounts.pinned.value?.name === null);
const wornSkin = computed(() =>
  account.value?.provider === 'nick' ? (accounts.mc.value?.skin?.url ?? null) : null,
);

const catalogSize = ref<number | null>(null);
watchEffect(() => {
  const query = catalog.listQuery.value;
  if (query !== null && query.q === '' && catalog.status.value === 'ready') {
    catalogSize.value = catalog.total.value;
  }
});

function counted(count: number | null): Pick<NavItem, 'count'> {
  return count === null ? {} : { count: formatNumber(count) };
}

const ownerItems = computed<NavItem[]>(() =>
  owner.isOwner.value
    ? [
        {
          section: 'owner',
          to: '/my-servers',
          icon: 'hdd-rack',
          label: ru.owner.nav,
          ...counted(owner.refs.value.length),
          ...(owner.attention.value ? { mark: ru.owner.navAttention } : {}),
        },
      ]
    : [],
);

const mainItems = computed<NavItem[]>(() => [
  { section: 'home', to: '/', icon: 'house-door', label: ru.nav.home },
  {
    section: 'servers',
    to: '/servers',
    icon: 'compass',
    label: ru.nav.servers,
    ...counted(catalogSize.value),
  },
  {
    section: 'library',
    to: '/library',
    icon: 'collection',
    label: ru.nav.library,
    ...counted(library.entries.value.length > 0 ? library.entries.value.length : null),
  },
  ...ownerItems.value,
  { section: 'skins', to: '/skins', icon: 'person-bounding-box', label: ru.nav.skins },
  {
    section: 'mods',
    to: '/mods',
    icon: 'puzzle',
    label: ru.nav.mods,
    ...counted(mods.enabledCount.value === 0 ? null : mods.enabledCount.value),
  },
]);

const currentServerId = computed(() =>
  route.name === 'server' ? Number(route.params.id) : undefined,
);

const onFavorite = computed(() =>
  favorites.servers.value.some((server) => server.id === currentServerId.value),
);

const GHOST_PATIENCE_MS = 4000;
const GHOST_SHAPES = [
  { name: 88, online: 58 },
  { name: 64, online: 56 },
  { name: 80, online: 60 },
  { name: 60, online: 56 },
  { name: 76, online: 58 },
  { name: 84, online: 60 },
] as const;

const list = useTemplateRef<HTMLElement>('list');
const fitting = ref<number | null>(null);
let resizes: ResizeObserver | null = null;

function measure(): void {
  const box = list.value;
  const row = box?.querySelector('li')?.getBoundingClientRect().height ?? 0;
  const gap = box === null ? 0 : Number.parseFloat(getComputedStyle(box).rowGap) || 0;
  fitting.value = rowsFitting(box?.clientHeight ?? 0, row, gap) ?? fitting.value;
}

onMounted(() => {
  measure();
  if (list.value !== null && typeof ResizeObserver === 'function') {
    resizes = new ResizeObserver(measure);
    resizes.observe(list.value);
  }
});
onBeforeUnmount(() => {
  resizes?.disconnect();
  if (patience !== null) {
    clearTimeout(patience);
  }
});

const favoritesLoading = computed(() => favorites.status.value === 'loading');
const favoritesFailed = computed(
  () => favorites.status.value === 'error' && favorites.servers.value.length === 0,
);
const favoritesEmpty = computed(
  () => favorites.status.value === 'ready' && favorites.servers.value.length === 0,
);
type FavoriteSlot =
  | { key: string; server: ServerRow; ghost: null }
  | { key: string; server: null; ghost: (typeof GHOST_SHAPES)[number] };

function ghostSlot(index: number): FavoriteSlot {
  const ghost = GHOST_SHAPES[index % GHOST_SHAPES.length] ?? GHOST_SHAPES[0];
  return { key: `ghost-${String(index)}`, server: null, ghost };
}

// The list is either all placeholders or all servers: a half-loaded mix reads as a broken list.
// Servers that take too long (one of them may be gone from the catalog) do not hold the rest.
const overdue = ref(false);
let patience: ReturnType<typeof setTimeout> | null = null;
watch(
  favoritesLoading,
  (loading) => {
    if (patience !== null) {
      clearTimeout(patience);
      patience = null;
    }
    overdue.value = false;
    if (loading) {
      patience = setTimeout(() => {
        overdue.value = true;
      }, GHOST_PATIENCE_MS);
    }
  },
  { immediate: true },
);
const slots = computed<FavoriteSlot[]>(() => {
  const ready = favorites.servers.value.map((server): FavoriteSlot => ({
    key: String(server.id),
    server,
    ghost: null,
  }));
  if (!favoritesLoading.value || overdue.value) {
    return ready;
  }
  // A list the launcher already holds gives a row for every server; a signed-in player whose
  // list has not come yet gets as many rows as the last load had, as far as the panel fits
  // them; with nothing known it is three rows.
  const listed = favorites.synced.value || accounts.mc.value === null ? favorites.ids.value : [];
  if (listed.length === 0) {
    const remembered = accounts.mc.value?.favoritesCount ?? null;
    const rows = accounts.settled.value ? ghostRows(remembered, fitting.value) : 0;
    return Array.from({ length: rows }, (_, index) => ghostSlot(index));
  }
  return listed.slice(0, MAX_GHOST_ROWS).map((_, index) => ghostSlot(index));
});
const ghostCount = computed(() => slots.value.filter((slot) => slot.server === null).length);
watch(() => slots.value.length, measure, { flush: 'post' });

function isActive(section: Section): boolean {
  return route.meta.section === section && !(section === 'servers' && onFavorite.value);
}

const emptyLabel = computed(() => (nickMissing.value ? ru.nav.pickNick : ru.nav.noAccount));
const accountLabel = computed(() => {
  if (!accounts.settled.value) {
    return ru.state.loading;
  }
  return account.value === null
    ? emptyLabel.value
    : fill(ru.nav.account, { name: account.value.name });
});
</script>

<template>
  <aside class="sidebar">
    <nav class="nav" :aria-label="ru.nav.label">
      <RouterLink
        v-for="item in mainItems"
        :key="item.section"
        :to="item.to"
        class="nav-link"
        :class="{ 'is-active': isActive(item.section) }"
        :aria-current="isActive(item.section) ? 'page' : undefined"
      >
        <BiIcon :name="item.icon" />
        {{ item.label }}
        <span v-if="item.mark" class="mark" data-mark>
          <span class="lx-visually-hidden">{{ item.mark }}</span>
        </span>
        <span v-if="item.count" class="count">{{ item.count }}</span>
      </RouterLink>
    </nav>

    <div class="label">
      <h2 id="nav-favorites">{{ ru.nav.favorites }}</h2>
      <RouterLink
        to="/servers"
        class="add"
        :aria-label="ru.nav.addFavorite"
        :title="ru.nav.addFavorite"
      >
        <BiIcon name="plus-lg" />
      </RouterLink>
    </div>
    <div v-if="favoritesFailed" class="empty" role="status" data-favorites="error">
      <p>{{ ru.nav.favoritesFailed }}</p>
      <button type="button" class="retry" @click="favorites.refresh()">
        <BiIcon name="arrow-clockwise" />{{ ru.state.retry }}
      </button>
    </div>
    <p v-else-if="favoritesEmpty" class="empty" data-favorites="empty">
      {{ ru.nav.favoritesEmpty }}
    </p>
    <ul
      ref="list"
      class="favorites"
      aria-labelledby="nav-favorites"
      :aria-busy="ghostCount > 0"
      :data-favorites="ghostCount > 0 ? 'loading' : 'ready'"
    >
      <template v-for="slot in slots" :key="slot.key">
        <li v-if="slot.server !== null">
          <RouterLink
            :to="`/server/${String(slot.server.id)}`"
            class="favorite"
            :class="{ 'is-active': currentServerId === slot.server.id }"
            :aria-current="currentServerId === slot.server.id ? 'page' : undefined"
          >
            <ServerIcon :src="slot.server.icon_url" size="xs" />
            <span class="name">{{ slot.server.name }}</span>
            <OnlineCount :online="slot.server.online" :status="slot.server.status" size="sm" />
          </RouterLink>
        </li>
        <li v-else class="ghost" aria-hidden="true">
          <SkelBar class="is-late is-raised" :w="24" :h="24" />
          <SkelBar class="is-late is-raised" :w="slot.ghost.name" :h="12" round />
          <SkelBar class="is-late is-raised ghost-online" :w="slot.ghost.online" :h="10" round />
        </li>
      </template>
      <li v-if="ghostCount > 0" class="lx-visually-hidden" role="status">
        {{ ru.state.loading }}
      </li>
    </ul>

    <div class="bottom">
      <nav class="nav" :aria-label="ru.nav.settings">
        <RouterLink
          to="/settings"
          class="nav-link"
          :class="{ 'is-active': isActive('settings') }"
          :aria-current="isActive('settings') ? 'page' : undefined"
        >
          <BiIcon name="gear" />
          {{ ru.nav.settings }}
        </RouterLink>
      </nav>
      <RouterLink
        to="/accounts"
        class="account"
        :class="{ 'is-active': isActive('accounts') }"
        :aria-label="accountLabel"
        :aria-current="isActive('accounts') ? 'page' : undefined"
      >
        <template v-if="!accounts.settled.value">
          <SkelBar class="is-late is-raised" :w="30" :h="30" />
          <span class="account-text" data-account="loading">
            <SkelBar class="is-late is-raised" :w="96" :h="12" round />
            <SkelBar class="is-late is-raised" :w="56" :h="10" round />
          </span>
        </template>
        <template v-else-if="account !== null">
          <SkinFace v-if="wornSkin !== null" :skin="wornSkin" />
          <PlayerHead v-else :head="account.head" />
          <span class="account-text">
            <span class="account-name">{{ account.name }}</span>
            <ProviderMark :provider="account.provider" size="sm" />
          </span>
        </template>
        <template v-else>
          <span class="account-add"><BiIcon name="person-plus" /></span>
          <span class="account-text">{{ emptyLabel }}</span>
        </template>
        <BiIcon name="chevron-expand" />
      </RouterLink>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px 10px 10px;
  background: var(--mc-surface);
  border-right: 1px solid var(--mc-border);
}

.sidebar a {
  cursor: default;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--mc-radius-sm);
  color: var(--mc-text-muted);
  font-weight: 400;
  text-decoration: none;
}

.nav-link .bi {
  font-size: 16px;
  width: 18px;
}

.nav-link:hover {
  background: var(--mc-surface-2);
  color: var(--mc-text);
}

.nav-link.is-active {
  background: var(--mc-surface-3);
  color: var(--mc-text);
  font-weight: 600;
}

.nav-link.is-active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 calc(var(--mc-radius-sm) / 2) calc(var(--mc-radius-sm) / 2) 0;
  background: var(--mc-accent);
}

.nav-link.is-active .bi {
  color: var(--mc-accent);
}

.mark {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--mc-danger);
}

.mark + .count {
  margin-left: 0;
}

.count {
  margin-left: auto;
  font-size: 11px;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
}

.label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 10px 6px;
}

.label h2 {
  margin: 0;
  font-family: var(--mc-font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lx-text-faint);
}

.add {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-right: -4px;
  border-radius: var(--mc-radius-sm);
  color: var(--lx-text-faint);
  font-size: 13px;
}

.add:hover {
  color: var(--mc-text);
  background: var(--mc-surface-2);
}

.favorites {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  min-height: 0;
  list-style: none;
  overflow-x: hidden;
  overflow-y: auto;
}

.favorite {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  padding: 0 10px 0 6px;
  border-radius: var(--mc-radius-sm);
  color: var(--mc-text);
  font-size: 13px;
  text-decoration: none;
}

.favorite:hover,
.favorite.is-active {
  background: var(--mc-surface-2);
}

.favorite:focus-visible {
  outline-offset: -2px;
}

.name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty {
  margin: 2px 10px 0;
  line-height: 1.4;
  text-wrap: balance;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.empty p {
  margin: 0;
}

.retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--mc-text);
  font-size: 12px;
  font-weight: 600;
}

.retry:hover {
  color: var(--mc-accent);
}

.ghost {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  padding: 0 10px 0 6px;
}

.ghost-online {
  margin-left: auto;
}

.bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-right: -10px;
  margin-left: -10px;
  padding: 10px 10px 0;
  border-top: 1px solid var(--mc-border);
}

.account {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: var(--mc-radius-sm);
  color: var(--mc-text);
  text-decoration: none;
}

.account {
  min-height: 46px;
}

.account-add {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface-2);
  color: var(--mc-text-muted);
  font-size: 16px;
}

.account:hover,
.account.is-active {
  background: var(--mc-surface-2);
}

.account-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.account-name {
  font-weight: 600;
  font-size: 13px;
  line-height: 1.15;
}

.account > [data-icon='chevron-expand'] {
  margin-left: auto;
  color: var(--lx-text-faint);
}
</style>
