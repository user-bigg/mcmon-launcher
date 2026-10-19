<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { countOf, fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import ContinueHero from '../components/ContinueHero.vue';
import BiIcon from '../components/BiIcon.vue';
import FillText from '../components/FillText.vue';
import OwnerTable from '../components/OwnerTable.vue';
import ServerCard from '../components/ServerCard.vue';
import TopSlotRow from '../components/TopSlotRow.vue';
import SiteErrorState from '../components/SiteErrorState.vue';
import SkelBar from '../components/SkelBar.vue';
import StaleNote from '../components/StaleNote.vue';
import TopServerHero from '../components/TopServerHero.vue';
import { useLauncher } from '../composables/context';
import { useAccounts } from '../composables/useAccounts';
import { useCatalog } from '../composables/useCatalog';
import { useVisibleInterval } from '../composables/useVisibleInterval';
import { useFavorites } from '../composables/useFavorites';
import { useFeed } from '../composables/useFeed';
import { useLibrary } from '../composables/useLibrary';
import { useScenes } from '../composables/useScenes';
import { HOME_CARDS, pickHome } from '../lib/home-pick';
import { serverFact } from '../lib/server-fact';
import { greeting } from '../lib/time';

const REFRESH_INTERVAL_MS = 5 * 60_000;

const { now, random } = useLauncher();
const topSlotRoll = random();
const catalog = useCatalog();
const favorites = useFavorites();
const feed = useFeed();
const library = useLibrary();
const accounts = useAccounts();
const scenes = useScenes();

const recentId = feed.recent?.serverId;
const recentPending = ref(recentId !== undefined && catalog.server(recentId) === undefined);

// The catalog store is shared with the servers screen, which may leave a search or another sort.
useVisibleInterval(() => {
  void catalog.load();
  void catalog.loadPopular();
}, REFRESH_INTERVAL_MS);
onMounted(() => {
  void catalog.setQuery({ q: '', sort: 'online' });
  void catalog.loadPopular();
  if (recentPending.value && recentId !== undefined) {
    void catalog.need([recentId]).finally(() => {
      recentPending.value = false;
    });
  }
});

const ownList = computed(() => {
  const loaded = catalog.listQuery.value;
  return loaded !== null && loaded.q === '' && loaded.sort === 'online';
});
const listStatus = computed(() => {
  const status = catalog.status.value;
  return status === 'ready' && !ownList.value ? 'loading' : status;
});

const title = computed(() => greeting(accounts.player.value?.name ?? '', now()));
const hasFavorites = computed(() => favorites.servers.value.length > 0);
const favoritesOnline = computed(() =>
  favorites.servers.value.reduce((sum, server) => sum + server.online, 0),
);
const catalogSummary = computed(() => {
  if (!ownList.value) {
    return null;
  }
  const total = catalog.total.value;
  const online = catalog.online.value;
  if (total === 0) {
    return null;
  }
  const servers = countOf(total, ru.plural.servers);
  return online === null
    ? servers
    : fill(ru.home.catalogOnline, { servers, players: countOf(online, ru.plural.players) });
});

const staleAt = computed(() =>
  ownList.value && (catalog.stale.value || catalog.status.value === 'error')
    ? catalog.fetchedAt.value
    : null,
);

const heroSettled = computed(() => listStatus.value !== 'loading' && !recentPending.value);

const picked = computed(() =>
  pickHome({
    servers: ownList.value ? catalog.servers.value : [],
    popular: heroSettled.value ? catalog.popular.value : [],
    topSlots: ownList.value ? catalog.topSlots.value : [],
    recent: feed.recent === null ? undefined : catalog.server(feed.recent.serverId),
    waitRecent: recentPending.value,
    favorites: favorites.servers.value,
    topSlotRoll,
  }),
);
const recent = computed(() => picked.value.recent);
const top = computed(() => picked.value.top);
const topSlot = computed(() => picked.value.topSlot);
const favoriteCards = computed(() => picked.value.favorites);
const popularCards = computed(() => picked.value.popular);
const hero = computed(() => recent.value ?? top.value);
const heroInstalled = computed(() => hero.value !== undefined && library.hasServer(hero.value.id));
const showFavorites = computed(() => favoriteCards.value.length > 0);
const heroScene = computed(() =>
  hero.value === undefined ? undefined : scenes.scene(hero.value.cover.scene),
);
const loading = computed(() => listStatus.value === 'loading' && hero.value === undefined);
const failed = computed(
  () => listStatus.value === 'error' && staleAt.value === null && hero.value === undefined,
);

function retry(): void {
  void catalog.load();
  void catalog.loadPopular();
}
</script>

<template>
  <div class="lx-content">
    <header class="greeting">
      <div class="plate lx-head-row">
        <div>
          <h1 class="lx-h1">{{ title }}</h1>
          <p v-if="hasFavorites" class="lx-sub">
            <FillText :text="ru.home.favoritesOnline">
              <template #count>
                <strong class="lx-num">{{ countOf(favoritesOnline, ru.plural.players) }}</strong>
              </template>
            </FillText>
          </p>
          <p v-else-if="catalogSummary !== null" class="lx-sub lx-num summary">
            {{ catalogSummary }}
          </p>
          <p v-else-if="loading" class="lx-sub" aria-hidden="true">
            <SkelBar class="sub-skel" :w="260" :h="16" />
          </p>
        </div>
        <div v-if="staleAt !== null" class="plate-aside">
          <StaleNote :at="staleAt" @retry="retry" />
        </div>
      </div>
    </header>

    <div v-if="loading" class="skeleton" data-loading role="status" :aria-label="ru.state.loading">
      <div class="lx-skel-frame skel-hero" :class="{ 'is-continue': feed.recent }">
        <span class="lx-skel skel-cover" />
        <div class="skel-plate">
          <SkelBar :w="180" :h="18" />
          <div class="skel-title">
            <SkelBar :w="48" :h="48" />
            <div class="skel-lines">
              <SkelBar :w="160" :h="22" />
              <SkelBar :w="220" :h="14" />
            </div>
            <span class="lx-skel skel-play" />
          </div>
        </div>
      </div>
      <div class="lx-section-head">
        <SkelBar :w="160" :h="18" />
      </div>
      <div class="lx-grid-3">
        <div v-for="index in HOME_CARDS" :key="index" class="lx-skel-frame skel-card">
          <div class="skel-title">
            <SkelBar :w="40" :h="40" />
            <div class="skel-lines">
              <SkelBar w="70%" :h="16" />
              <SkelBar w="90%" :h="13" />
              <SkelBar w="60%" :h="13" />
            </div>
          </div>
          <SkelBar :w="96" :h="22" />
          <div class="skel-foot">
            <SkelBar :w="80" :h="14" />
            <SkelBar :w="92" :h="30" />
          </div>
        </div>
      </div>
    </div>
    <SiteErrorState v-else-if="failed" class="hero" :error="catalog.error.value" @retry="retry" />

    <ContinueHero
      v-if="recent && feed.recent"
      class="hero"
      :server="recent"
      :scene="scenes.scene(recent.cover.scene)"
      :scene-base="scenes.base"
      :ping="catalog.ping(recent.id).ms"
      :played-at="feed.recent.playedAt"
      :duration-seconds="feed.recent.durationSeconds"
      :installed="heroInstalled"
    />
    <TopServerHero
      v-else-if="top"
      class="hero"
      :server="top"
      :scene="heroScene"
      :scene-base="scenes.base"
      :ping="catalog.ping(top.id).ms"
      :installed="heroInstalled"
    />

    <OwnerTable />

    <template v-if="showFavorites">
      <div class="lx-section-head">
        <h2>{{ ru.home.favorites }}</h2>
        <RouterLink to="/servers">
          {{ ru.home.allServers }} <BiIcon name="arrow-right" />
        </RouterLink>
      </div>
      <div class="lx-grid-3">
        <ServerCard
          v-for="server in favoriteCards"
          :key="server.id"
          :server="server"
          :fact="serverFact(server, now(), library.installed(server.id))"
          :vote-available="feed.voteAvailable(server.id)"
          source="favorites"
        />
      </div>
    </template>

    <TopSlotRow
      v-if="topSlot"
      class="top-slot"
      :server="topSlot"
      :scene="scenes.scene(topSlot.cover.scene)"
      :scene-base="scenes.base"
      :quiet="heroScene !== undefined"
    />

    <section v-if="!showFavorites && popularCards.length > 0" aria-labelledby="home-popular">
      <div class="lx-section-head">
        <h2 id="home-popular">{{ ru.home.popular }}</h2>
        <RouterLink to="/servers">
          {{ ru.home.allServers }} <BiIcon name="arrow-right" />
        </RouterLink>
      </div>
      <div class="lx-grid-3">
        <ServerCard
          v-for="server in popularCards"
          :key="server.id"
          :server="server"
          :vote-available="feed.voteAvailable(server.id)"
          source="home_popular"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.plate-aside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
}

.sub-skel {
  margin: 3px 0;
}

.hero,
.skeleton {
  margin-top: 24px;
}

.skel-hero {
  container-type: inline-size;
  overflow: hidden;
  border-radius: var(--mc-radius-lg);
}

.skel-cover {
  height: calc(max(2px, round(up, 100cqw / 384, 1px)) * 52);
  border-radius: 0;
}

.skel-hero.is-continue {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(220px, 40%, 820px);
  grid-template-areas: 'plate cover';
  min-height: 218px;
  padding: 8px;
}

.is-continue .skel-cover {
  grid-area: cover;
  height: auto;
  border-radius: calc(var(--mc-radius-lg) - 8px);
}

.is-continue .skel-plate {
  grid-area: plate;
  border-top: 0;
}

.skel-plate {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--mc-border);
}

.skel-title {
  display: flex;
  align-items: center;
  gap: 14px;
}

.skel-lines {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.skel-play {
  width: 220px;
  height: 48px;
  margin-left: auto;
}

.skel-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 182px;
  padding: 14px;
}

.skel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
}

.top-slot {
  margin-top: 24px;
}
</style>
