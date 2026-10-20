<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import type { AccountError, VoteResult } from '@shared/account';
import { isLauncherOnly, type ServerCard } from '@shared/catalog';
import type { SiteError } from '@shared/site';
import type { LinkKind } from '@shared/telemetry';
import { fill, formatDecimal, formatNumber, scoreCount } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { isValidNick } from '@shared/launch';
import { isHttpsUrl, urlHost } from '@shared/links';
import BiIcon from '../components/BiIcon.vue';
import CopyButton from '../components/CopyButton.vue';
import FillText from '../components/FillText.vue';
import LaunchAction from '../components/LaunchAction.vue';
import OnlineChart from '../components/OnlineChart.vue';
import PixelLandscape from '../components/PixelLandscape.vue';
import ServerIcon from '../components/ServerIcon.vue';
import ServerInstallPanel from '../components/ServerInstallPanel.vue';
import ServerModsSummary from '../components/ServerModsSummary.vue';
import ServerReport from '../components/ServerReport.vue';
import SiteErrorState from '../components/SiteErrorState.vue';
import SkelBar from '../components/SkelBar.vue';
import StaleNote from '../components/StaleNote.vue';
import TagChip from '../components/TagChip.vue';
import UiButton from '../components/UiButton.vue';
import UiSegmented from '../components/UiSegmented.vue';
import { useLauncher } from '../composables/context';
import { useAccounts } from '../composables/useAccounts';
import { useCatalog } from '../composables/useCatalog';
import { useVisibleInterval } from '../composables/useVisibleInterval';
import { useExternal } from '../composables/useExternal';
import { useFavorites } from '../composables/useFavorites';
import { useFeed } from '../composables/useFeed';
import { useLibrary } from '../composables/useLibrary';
import { useScenes } from '../composables/useScenes';
import { useSite } from '../composables/useSite';
import { useSiteChange } from '../composables/useSiteChange';
import { useTrack } from '../composables/useTrack';
import { useVotes } from '../composables/useVotes';
import { accountErrorText, remainingSeconds } from '../lib/account';
import { blocks, headingTag, withoutTitle } from '../lib/markdown';
import { addressCopyText, shownAddress, versionLabel } from '../lib/minecraft';
import { pingLevel } from '../lib/ping';
import { accessChips, languageChip, serverTags, tagView } from '../lib/tags';
import { durationCoarse, moscowTime } from '../lib/time';
import { formatPing } from '../lib/units';

type Period = '24h' | '7d' | '30d';
type Status = 'loading' | 'ready' | 'missing' | 'error';

const LIVE_INTERVAL_MS = 20_000;
const TICK_MS = 1000;

const COVER_ROWS = 55;

const { serverId } = defineProps<{ serverId: number }>();
const route = useRoute();
const launcher = useLauncher();
const catalog = useCatalog();
const favorites = useFavorites();
const feed = useFeed();
const library = useLibrary();
const accounts = useAccounts();
const external = useExternal();
const scenes = useScenes();
const site = useSite();
const votes = useVotes();
const track = useTrack();
const joinPanel = useTemplateRef<HTMLElement>('join');

const card = shallowRef<ServerCard | null>(null);
const status = ref<Status>('loading');
const staleAt = ref<string | null>(null);
const loadError = ref<SiteError | null>(null);
const period = ref<Period>('24h');
const periods = [
  { value: '24h' as const, label: ru.serverPage.chart24h },
  { value: '7d' as const, label: ru.serverPage.chart7d },
  { value: '30d' as const, label: ru.serverPage.chart30d },
];

const voting = ref(false);
const voteError = ref<AccountError | null>(null);
const voted = ref<VoteResult | null>(null);
const pausedUntil = ref<string | null>(null);
const nowMs = ref(launcher.now().getTime());
const watchBusy = ref(false);
const watchError = ref<AccountError | null>(null);
const watchGuestOpen = ref(false);
const watchMuted = ref(false);
let cardRun = 0;

watch(
  () => serverId,
  (id) => {
    voted.value = null;
    voteError.value = null;
    watchError.value = null;
    watchGuestOpen.value = false;
    watchMuted.value = false;
    void loadCard(id);
  },
  { immediate: true },
);

watch(
  () => accounts.mc.value?.id ?? null,
  (id, previous) => {
    if (id !== previous && status.value === 'ready') {
      void loadCard(serverId);
    }
  },
);

watch(card, (value) => {
  pausedUntil.value = value?.my_vote?.can_vote_at ?? null;
});

useSiteChange((change) => {
  if (change.topic === 'server' && change.id === serverId && status.value === 'ready') {
    void loadCard(serverId, true);
  }
});

async function loadCard(id: number, quiet = false): Promise<void> {
  cardRun += 1;
  const run = cardRun;
  if (!quiet) {
    status.value = 'loading';
  }
  const loaded = await catalog.loadCard(id);
  if (run !== cardRun) {
    return;
  }
  card.value = loaded.status === 'ready' ? loaded.card : null;
  loadError.value = loaded.status === 'error' ? loaded.error : null;
  staleAt.value = loaded.status === 'ready' && loaded.stale ? loaded.fetchedAt : null;
  status.value = loaded.status;
}

async function refreshLive(): Promise<void> {
  await catalog.refreshLive([serverId]);
  const live = catalog.server(serverId);
  const current = card.value;
  if (live !== undefined && current !== null && current.id === live.id) {
    card.value = {
      ...current,
      online: live.online,
      max_players: live.max_players,
      status: live.status,
    };
  }
}

useVisibleInterval(() => {
  void refreshLive();
}, LIVE_INTERVAL_MS);
let tickTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  tickTimer = setInterval(() => {
    nowMs.value = launcher.now().getTime();
  }, TICK_MS);
});
onBeforeUnmount(() => {
  clearInterval(tickTimer);
  clearTimeout(linkCopiedTimer);
});

watch(
  () => scenes.sceneFor('waiting'),
  (pick) => {
    scenes.prefetch(pick);
  },
  { immediate: true },
);

const scene = computed(() =>
  card.value === null ? undefined : scenes.scene(card.value.cover.scene),
);
const favorite = computed(() => favorites.has(serverId));
const installed = computed(() => library.hasServer(serverId));
const ping = computed(() => catalog.ping(serverId));
const tags = computed(() => {
  if (card.value === null) {
    return [];
  }
  const language = languageChip(card.value.language);
  return [
    ...accessChips(card.value.access),
    ...serverTags(card.value).map(tagView),
    ...(language === null ? [] : [language]),
  ];
});
const about = computed(() =>
  withoutTitle(blocks(card.value?.description_md ?? ''), card.value?.name ?? ''),
);
const address = computed(() => (card.value === null ? null : shownAddress(card.value)));
const addressCopy = computed(() =>
  card.value === null || isLauncherOnly(card.value.launch)
    ? null
    : addressCopyText(card.value.address),
);

const chart = computed(() => {
  const points = card.value?.chart_24h ?? [];
  const peak = card.value?.peak_24h;
  const min = points.reduce<(typeof points)[number] | undefined>(
    (low, point) => (low === undefined || point.online < low.online ? point : low),
    undefined,
  );
  return { points, peak, min };
});

const chartLabel = computed(() =>
  fill(ru.serverPage.chartLabel, {
    peak: formatNumber(chart.value.peak?.online ?? 0),
    min: formatNumber(chart.value.min?.online ?? 0),
  }),
);

const headMeta = computed(() => {
  if (card.value === null) {
    return '';
  }
  const { rank, added_at: addedAt } = card.value;
  const year = addedAt === null ? null : new Date(addedAt).getUTCFullYear();
  if (rank === null) {
    return ru.serverPage.headMetaOutOfRating;
  }
  if (rank <= 0) {
    return year === null ? '' : fill(ru.serverPage.headMetaYear, { year });
  }
  return year === null
    ? fill(ru.serverPage.headMetaRank, { rank })
    : fill(ru.serverPage.headMeta, { rank, year });
});

const ownHost = computed(() => {
  const launch = card.value?.launch;
  return launch?.kind === 'own_launcher' ? urlHost(launch.url) : null;
});

const signedIn = computed(() => accounts.mc.value !== null);
const voteNick = computed(() => accounts.player.value?.name ?? null);
const nickFits = computed(
  () => voteNick.value !== null && (card.value?.edition !== 'java' || isValidNick(voteNick.value)),
);
const pauseLeft = computed(() => remainingSeconds(pausedUntil.value, new Date(nowMs.value)));
const demoPaused = computed(() => launcher.demo && !feed.voteAvailable(serverId));
const serverDown = computed(() => card.value?.status === 'offline');
const canVote = computed(
  () =>
    !serverDown.value &&
    (!signedIn.value ||
      (nickFits.value && pauseLeft.value === 0 && !demoPaused.value && !voting.value)),
);
const score = computed(() => {
  const energy = Math.max(0, card.value?.points ?? 0);
  const votes = Math.max(0, card.value?.votes.month ?? 0);
  return { energy, votes, total: energy + votes };
});
const voteTitle = computed(() => {
  if (serverDown.value) {
    return ru.serverPage.voteOffline;
  }
  if (voted.value !== null || pauseLeft.value > 0 || demoPaused.value) {
    return ru.serverPage.voteAccepted;
  }
  return signedIn.value ? ru.server.voteAvailable : ru.serverPage.voteGuestTitle;
});
const voteLabel = computed(() => {
  if (!signedIn.value) {
    return ru.serverPage.voteOnSite;
  }
  if (pauseLeft.value > 0) {
    return fill(ru.serverPage.voteAgainIn, { time: durationCoarse(pauseLeft.value) });
  }
  return demoPaused.value ? ru.serverPage.voteTomorrow : ru.serverPage.vote;
});
const voteWeightText = computed(() => {
  const mc = accounts.mc.value;
  const trusted = mc?.trusted ?? null;
  if (trusted === null) {
    return null;
  }
  return trusted ? ru.serverPage.voteWeight : (mc?.trustedReason ?? null);
});
const voteNickText = computed(() => {
  if (voteNick.value === null) {
    return ru.serverPage.voteNoNick;
  }
  return nickFits.value
    ? fill(ru.serverPage.voteNick, { nick: voteNick.value })
    : ru.serverPage.voteBadNick;
});
const links = computed(() => {
  const all = card.value?.links ?? {};
  return [
    {
      key: 'discord' as const,
      url: all.discord,
      icon: 'discord' as const,
      label: ru.serverPage.discord,
    },
    {
      key: 'telegram' as const,
      url: all.telegram,
      icon: 'telegram' as const,
      label: ru.serverPage.telegram,
    },
    { key: 'vk' as const, url: all.vk, icon: 'vk' as const, label: ru.serverPage.vk },
    {
      key: 'youtube' as const,
      url: all.youtube,
      icon: 'youtube' as const,
      label: ru.serverPage.youtube,
    },
    {
      key: 'tiktok' as const,
      url: all.tiktok,
      icon: 'tiktok' as const,
      label: ru.serverPage.tiktok,
    },
  ].flatMap((link) =>
    link.url !== undefined && isHttpsUrl(link.url) ? [{ ...link, url: link.url }] : [],
  );
});

const ownSite = computed(() => {
  const url = card.value?.links.site;
  const host = url !== undefined && isHttpsUrl(url) ? urlHost(url) : null;
  return url !== undefined && host !== null ? { url, host } : null;
});
function openOwnSite(url: string): void {
  openLink('site');
  void external.open(url);
}

const LINK_COPIED_MS = 1600;
const linkCopied = ref(false);
let linkCopiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    return;
  }
  linkCopied.value = true;
  clearTimeout(linkCopiedTimer);
  linkCopiedTimer = setTimeout(() => {
    linkCopied.value = false;
  }, LINK_COPIED_MS);
}
function trackCopy(): void {
  track({ type: 'action', name: 'copy_address', server_id: serverId });
}
function openLink(kind: LinkKind): void {
  track({ type: 'action', name: 'link_open', server_id: serverId, kind });
}
function openDescriptionLink(url: string): void {
  openLink('description');
  void external.open(url);
}
function openVoteSite(): void {
  track({ type: 'action', name: 'vote_open_site', server_id: serverId });
}

async function vote(): Promise<void> {
  const current = card.value;
  if (current === null) {
    return;
  }
  if (!signedIn.value) {
    openVoteSite();
    void external.open(`${current.site_url}/votes#vote`);
    return;
  }
  const nick = voteNick.value;
  if (nick === null || !canVote.value) {
    return;
  }
  voting.value = true;
  voteError.value = null;
  const result = await launcher.api.site.vote(current.id, nick);
  voting.value = false;
  if (result.ok) {
    voted.value = result.value;
    pausedUntil.value = result.value.nextVoteAt;
    votes.remember(current.id, result.value.nextVoteAt);
    card.value = {
      ...current,
      votes: { month: current.votes.month + 1, today: current.votes.today + 1 },
      my_vote: { can_vote_at: result.value.nextVoteAt },
    };
    void accounts.refreshMc();
    return;
  }
  voteError.value = result.error;
  if (result.error.nextVoteAt !== undefined) {
    pausedUntil.value = result.error.nextVoteAt;
    votes.remember(current.id, result.error.nextVoteAt);
  }
}

const watching = computed(() => card.value?.my_watch === true);
const watchShown = computed(() => watchOffered.value || watchError.value?.code === 'server_online');
const watchOffered = computed(
  () =>
    serverDown.value &&
    watchError.value?.code !== 'server_online' &&
    (!signedIn.value || launcher.demo || card.value?.my_watch !== undefined),
);

function setCardWatch(id: number, flag: boolean): void {
  const current = card.value;
  if (current?.id === id) {
    card.value = { ...current, my_watch: flag };
  }
}

async function watchedUpMuted(): Promise<boolean> {
  const settings = await launcher.api.site.alertSettings();
  return settings.ok && !settings.value.watched_up;
}

async function toggleWatch(): Promise<void> {
  const current = card.value;
  if (current === null || watchBusy.value) {
    return;
  }
  if (!signedIn.value) {
    watchGuestOpen.value = !watchGuestOpen.value;
    return;
  }
  const flag = !watching.value;
  watchError.value = null;
  setCardWatch(current.id, flag);
  if (launcher.demo) {
    return;
  }
  watchBusy.value = true;
  const result = await launcher.api.site.setWatch(current.id, flag);
  watchBusy.value = false;
  if (result.ok) {
    watchMuted.value = flag && (await watchedUpMuted());
    return;
  }
  setCardWatch(current.id, !flag);
  watchError.value = result.error;
  if (result.error.code === 'server_online') {
    void refreshLive();
  }
}

watch(
  () => [route.query.join, status.value] as const,
  async ([join, current]) => {
    if (join === undefined || current !== 'ready') {
      return;
    }
    await nextTick();
    joinPanel.value?.scrollIntoView({ block: 'center' });
    joinPanel.value?.focus({ preventScroll: true });
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="status === 'missing' || (status === 'ready' && card === null)" class="lx-content">
    <h1 class="lx-h1">{{ ru.serverPage.notFound }}</h1>
    <p class="lx-sub">{{ ru.serverPage.notFoundText }}</p>
    <UiButton class="spaced" size="sm" icon="arrow-left" to="/servers">
      {{ ru.serverPage.toServers }}
    </UiButton>
  </div>
  <div v-else class="server">
    <div class="toolbar">
      <RouterLink class="lx-glass" to="/servers">
        <BiIcon name="arrow-left" />{{ ru.serverPage.back }}
      </RouterLink>
      <StaleNote v-if="staleAt !== null" :at="staleAt" @retry="loadCard(serverId)" />
      <div v-if="card !== null" class="toolbar-right">
        <button
          type="button"
          class="lx-glass"
          :aria-label="ru.serverPage.shareLabel"
          :title="ru.serverPage.shareLabel"
          :class="{ 'is-copied': linkCopied }"
          @click="copyLink(card.site_url)"
        >
          <BiIcon :name="linkCopied ? 'check-lg' : 'link-45deg'" />
          <span class="share-text">
            <span :class="{ 'is-hidden': linkCopied }">{{ ru.serverPage.share }}</span>
            <span v-if="linkCopied" class="share-done" role="status">{{ ru.common.copied }}</span>
          </span>
        </button>
        <UiButton class="lx-glass" size="sm" icon="box-arrow-up-right" :href="card.site_url">
          {{ ru.serverPage.onSite }}
        </UiButton>
      </div>
    </div>

    <div
      v-if="status === 'loading'"
      class="skeleton"
      data-loading
      role="status"
      :aria-label="ru.state.loading"
    >
      <span class="lx-skel skel-cover" />
      <div class="head has-cover">
        <SkelBar class="skel-icon" :w="76" :h="76" />
        <div class="head-text skel-lines">
          <SkelBar :w="220" :h="26" />
          <SkelBar :w="300" :h="14" />
        </div>
        <div class="head-actions">
          <SkelBar :w="48" :h="48" />
          <SkelBar :w="200" :h="48" />
        </div>
      </div>
      <div class="lx-content body">
        <div class="tags">
          <SkelBar :w="96" :h="24" round />
          <SkelBar :w="80" :h="24" round />
          <SkelBar :w="110" :h="24" round />
        </div>
        <div class="stats skel-stats">
          <div v-for="index in 4" :key="index" class="stat">
            <SkelBar :w="70" :h="14" />
            <SkelBar :w="56" :h="25" />
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="status === 'error' || card === null" class="lx-content">
      <SiteErrorState :error="loadError" @retry="loadCard(serverId)" />
    </div>
    <template v-else>
      <div v-if="scene !== undefined" class="cover">
        <PixelLandscape
          :scene="scene"
          :base="scenes.base"
          :time="card.cover.time"
          :height="COVER_ROWS"
        />
      </div>

      <div class="head" :class="{ 'has-cover': scene !== undefined }">
        <ServerIcon :src="card.icon_url" size="lg" />
        <div class="head-text">
          <div class="head-title">
            <h1 class="selectable" :title="card.name">{{ card.name }}</h1>
            <TagChip v-if="card.status === 'online'" tone="accent">
              <span class="dot" aria-hidden="true" />{{ ru.server.online }}
            </TagChip>
            <TagChip v-else>{{ ru.server.offline }}</TagChip>
          </div>
          <div class="head-meta">
            <span v-if="address !== null && addressCopy !== null" class="address selectable">
              {{ address }}
              <CopyButton
                :text="addressCopy"
                :label="ru.serverPage.copyAddress"
                @copied="trackCopy"
              />
            </span>
            <span v-else class="launcher-only" data-launcher-only>
              <BiIcon name="box-arrow-in-right" />{{ ru.server.launcherOnly }}
            </span>
            <span class="lx-muted lx-num">{{ headMeta }}</span>
          </div>
        </div>
        <div class="head-actions">
          <UiButton
            size="lg"
            icon-only
            :icon="favorite ? 'heart-fill' : 'heart'"
            :class="{ 'is-favorite': favorite }"
            :label="favorite ? ru.serverPage.removeFavorite : ru.serverPage.addFavorite"
            :aria-pressed="favorite"
            @click="favorites.toggle(serverId)"
          />
          <LaunchAction
            :server="card"
            size="lg"
            solid
            source="server_page"
            :needs-install="!installed"
          />
        </div>
      </div>

      <div class="lx-content body">
        <div class="tags-row">
          <div class="tags">
            <TagChip v-for="tag in tags" :key="tag.slug" :icon="tag.icon">
              {{ tag.label }}
            </TagChip>
          </div>
          <ServerModsSummary v-if="card.launch.kind === 'direct'" :card="card" />
        </div>

        <dl class="stats">
          <div class="stat">
            <dt>
              <span class="dot" :class="{ 'is-down': serverDown }" aria-hidden="true" />{{
                ru.serverPage.statOnline
              }}
            </dt>
            <dd>{{ formatNumber(card.online) }}</dd>
          </div>
          <div class="stat">
            <dt><BiIcon :name="pingLevel(ping.ms).bars" />{{ ru.serverPage.statPing }}</dt>
            <dd>{{ ping.ms === null ? ru.server.pingUnknown : formatPing(ping.ms) }}</dd>
          </div>
          <div class="stat">
            <dt><BiIcon name="activity" />{{ ru.serverPage.statUptime }}</dt>
            <dd>
              {{
                typeof card.uptime_30d === 'number'
                  ? fill(ru.owner.percent, { value: formatDecimal(card.uptime_30d * 100) })
                  : ru.server.pingUnknown
              }}
            </dd>
          </div>
          <div class="stat is-score" data-stat="score">
            <dt>{{ ru.catalog.columnScore }}</dt>
            <dd>
              <span :class="{ 'is-none': score.total === 0 }" data-score-total>{{
                scoreCount(score.total)
              }}</span>
              <span v-if="score.total > 0" class="score-parts">
                <span :class="score.energy > 0 ? 'is-energy' : 'is-none'" data-score-energy>
                  <BiIcon name="lightning-charge-fill" />
                  <span class="lx-visually-hidden">{{ ru.server.legendEnergy }}</span>
                  {{ scoreCount(score.energy, score.total) }}
                </span>
                <span :class="score.votes > 0 ? 'is-votes' : 'is-none'" data-score-votes>
                  <BiIcon name="hand-thumbs-up-fill" />
                  <span class="lx-visually-hidden">{{ ru.server.legendVotes }}</span>
                  {{ scoreCount(score.votes, score.total) }}
                </span>
              </span>
              <span class="score-edge" aria-hidden="true">
                <span
                  v-if="score.energy > 0"
                  class="is-energy"
                  :style="{ flexGrow: score.energy }"
                />
                <span v-if="score.votes > 0" class="is-votes" :style="{ flexGrow: score.votes }" />
              </span>
            </dd>
          </div>
        </dl>

        <div class="lx-cols columns">
          <div class="lx-stack">
            <section class="lx-panel">
              <div class="lx-panel-head">
                <h3>{{ ru.serverPage.chartTitle }}</h3>
                <UiSegmented
                  v-model="period"
                  :options="periods"
                  :label="ru.serverPage.chartPeriod"
                />
              </div>
              <div class="lx-panel-body">
                <div class="chart-meta">
                  <span v-if="chart.peak">
                    <FillText :text="ru.serverPage.peakAt">
                      <template #value>
                        <strong>{{ formatNumber(chart.peak.online) }}</strong>
                      </template>
                      <template #time>{{ moscowTime(chart.peak.at) }}</template>
                    </FillText>
                  </span>
                  <span v-if="chart.min">
                    <FillText :text="ru.serverPage.minAt">
                      <template #value>
                        <strong>{{ formatNumber(chart.min.online) }}</strong>
                      </template>
                      <template #time>{{ moscowTime(chart.min.at) }}</template>
                    </FillText>
                  </span>
                </div>
                <OnlineChart :points="chart.points" :label="chartLabel" />
              </div>
            </section>

            <section v-if="about.length > 0" class="lx-panel" data-server="about">
              <div class="lx-panel-head">
                <h3>{{ ru.serverPage.about }}</h3>
                <span class="lx-faint small">{{ ru.serverPage.fromOwner }}</span>
              </div>
              <div class="lx-panel-body prose selectable">
                <template v-for="(block, index) in about" :key="index">
                  <component
                    :is="headingTag(block.level)"
                    v-if="block.kind === 'heading'"
                    class="prose-heading"
                    :class="`is-h${block.level}`"
                  >
                    <template v-for="(part, partIndex) in block.parts" :key="partIndex">
                      <code v-if="part.code">{{ part.text }}</code>
                      <a
                        v-else-if="part.url !== undefined"
                        :href="part.url"
                        @click.prevent="openDescriptionLink(part.url)"
                        >{{ part.text }}</a
                      >
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </component>
                  <p v-else-if="block.kind === 'paragraph'">
                    <template v-for="(part, partIndex) in block.parts" :key="partIndex">
                      <code v-if="part.code">{{ part.text }}</code>
                      <a
                        v-else-if="part.url !== undefined"
                        :href="part.url"
                        @click.prevent="openDescriptionLink(part.url)"
                        >{{ part.text }}</a
                      >
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </p>
                  <ul v-else>
                    <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
                      <template v-for="(part, partIndex) in item" :key="partIndex">
                        <code v-if="part.code">{{ part.text }}</code>
                        <a
                          v-else-if="part.url !== undefined"
                          :href="part.url"
                          @click.prevent="openDescriptionLink(part.url)"
                          >{{ part.text }}</a
                        >
                        <template v-else>{{ part.text }}</template>
                      </template>
                    </li>
                  </ul>
                </template>
              </div>
            </section>
            <ServerReport :server-id="card.id" :report="card.report" />
          </div>

          <div class="lx-stack">
            <ServerInstallPanel v-if="card.launch.kind === 'direct'" :card="card" />

            <section v-else-if="card.launch.kind === 'own_launcher'" class="lx-panel">
              <div class="lx-panel-head">
                <h3><BiIcon name="box-arrow-up-right" />{{ ru.serverPage.ownTitle }}</h3>
                <span v-if="ownHost !== null" class="lx-mono lx-faint small selectable">{{
                  ownHost
                }}</span>
              </div>
              <div class="lx-panel-body">
                <p class="panel-text">{{ ru.serverPage.ownText }}</p>
                <p class="panel-note lx-faint">
                  {{ ownHost === null ? ru.serverPage.ownInvalid : ru.serverPage.ownFrom }}
                </p>
                <LaunchAction class="panel-action" :server="card" size="md" source="server_page" />
              </div>
            </section>

            <section v-else ref="join" class="lx-panel" tabindex="-1">
              <div class="lx-panel-head">
                <h3><BiIcon name="info-circle" />{{ ru.serverPage.joinTitle }}</h3>
              </div>
              <div class="lx-panel-body">
                <ol class="join">
                  <li>
                    {{
                      fill(ru.serverPage.joinStepVersion, { versions: versionLabel(card.versions) })
                    }}
                  </li>
                  <li>{{ ru.serverPage.joinStepMenu }}</li>
                  <li>
                    <FillText :text="ru.serverPage.joinStepAddress">
                      <template #address>
                        <span
                          v-if="address !== null && addressCopy !== null"
                          class="address selectable"
                        >
                          {{ address }}
                          <CopyButton
                            :text="addressCopy"
                            :label="ru.serverPage.copyAddress"
                            @copied="trackCopy"
                          />
                        </span>
                      </template>
                    </FillText>
                  </li>
                </ol>
              </div>
            </section>

            <section class="lx-panel vote-panel">
              <div class="lx-panel-body">
                <div class="vote" data-vote>
                  <div class="vote-title lx-num" role="status">{{ voteTitle }}</div>
                  <template v-if="signedIn">
                    <div v-if="voteWeightText !== null" class="lx-faint small">
                      {{ voteWeightText }}
                    </div>
                    <div class="lx-faint small">{{ voteNickText }}</div>
                  </template>
                  <div v-else class="lx-faint small">{{ ru.serverPage.voteGuest }}</div>
                  <div class="vote-row">
                    <UiButton
                      class="vote-action"
                      variant="vote"
                      size="sm"
                      :icon="signedIn ? undefined : 'box-arrow-up-right'"
                      :disabled="!canVote"
                      @click="vote"
                    >
                      {{ voteLabel }}
                    </UiButton>
                  </div>
                </div>
                <p v-if="voteError !== null" class="vote-error small selectable" role="alert">
                  {{ accountErrorText(voteError) }}
                </p>
                <UiButton
                  v-if="voteError?.code === 'captcha_required'"
                  class="vote-site"
                  size="sm"
                  icon="box-arrow-up-right"
                  :href="`${card.site_url}/votes#vote`"
                  @click="openVoteSite"
                >
                  {{ ru.serverPage.voteOnSite }}
                </UiButton>
                <div v-if="watchShown" class="watch" data-watch>
                  <UiButton
                    v-if="watchOffered"
                    size="sm"
                    :icon="watching ? 'check2' : 'bell'"
                    @click="toggleWatch"
                  >
                    {{ watching ? ru.alerts.watching : ru.alerts.watch }}
                  </UiButton>
                  <p
                    v-if="watchGuestOpen && !signedIn"
                    class="watch-note lx-faint small"
                    role="status"
                    data-watch-guest
                  >
                    <FillText :text="ru.alerts.watchGuest">
                      <template #signIn>
                        <RouterLink class="sign-in" to="/accounts">{{
                          ru.alerts.watchGuestSignIn
                        }}</RouterLink>
                      </template>
                    </FillText>
                  </p>
                  <p
                    v-if="watchMuted && watching"
                    class="watch-note lx-faint small"
                    role="status"
                    data-watch-muted
                  >
                    <FillText :text="ru.alerts.watchMuted">
                      <template #settings>
                        <RouterLink
                          class="sign-in"
                          :to="{ path: '/settings', query: { section: 'launcher' } }"
                          >{{ ru.alerts.watchMutedSettings }}</RouterLink
                        >
                      </template>
                    </FillText>
                  </p>
                  <div v-if="watchError !== null" class="watch-error" role="alert">
                    <p class="vote-error small selectable">{{ accountErrorText(watchError) }}</p>
                    <UiButton
                      v-if="watchError.code === 'email_unverified'"
                      size="sm"
                      icon="box-arrow-up-right"
                      :href="site.links.value.logins"
                    >
                      {{ ru.report.openSite }}
                    </UiButton>
                  </div>
                </div>
              </div>
            </section>

            <section
              v-if="ownSite !== null || links.length > 0"
              class="lx-panel"
              :aria-label="ru.serverPage.links"
            >
              <div class="lx-panel-body">
                <div v-if="ownSite !== null" class="own-site">
                  <span class="lx-faint">{{ ru.serverPage.site }}</span>
                  <a
                    :href="ownSite.url"
                    :title="ownSite.url"
                    rel="noopener noreferrer"
                    @click.prevent="openOwnSite(ownSite.url)"
                  >
                    <span>{{ ownSite.host }}</span
                    ><BiIcon name="box-arrow-up-right" />
                  </a>
                </div>
                <div v-if="links.length > 0" class="links">
                  <UiButton
                    v-for="link in links"
                    :key="link.key"
                    :icon="link.icon"
                    :href="link.url"
                    block
                    @click="openLink(link.key)"
                  >
                    {{ link.label }}
                  </UiButton>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.spaced {
  margin-top: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 28px;
}

.toolbar > .stale-note {
  margin-right: auto;
}

.skeleton {
  container-type: inline-size;
}

.skel-cover {
  height: calc(max(2px, round(up, 100cqw / 384, 1px)) * 55);
  border-radius: 0;
  border-block: 1px solid var(--mc-border);
}

.skel-icon {
  border-radius: var(--mc-radius-lg);
  box-shadow: 0 0 0 4px var(--mc-bg);
}

.skel-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skel-stats .stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.cover {
  position: relative;
  border-block: 1px solid var(--mc-border);
}

.cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    0deg,
    color-mix(in srgb, var(--mc-bg) 72%, transparent) 0,
    color-mix(in srgb, var(--mc-bg) 24%, transparent) 38%,
    transparent 64%
  );
}

.head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  gap: 18px;
  margin-top: 4px;
  padding: 0 28px;
}

.head.has-cover {
  margin-top: 18px;
}

.head-text {
  flex: 1;
  min-width: 0;
  padding-bottom: 2px;
}

.head-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

h1 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-family: var(--mc-font-display);
  font-size: 24px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.head-title > :deep(.tag) {
  flex-shrink: 0;
}

.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mc-accent);
}

.dot.is-down {
  background: var(--mc-text-muted);
}

.head-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 14px;
  margin-top: 4px;
  font-size: 13px;
  white-space: nowrap;
}

.address {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  font-family: var(--mc-font-mono);
  font-size: 13px;
  color: var(--mc-text-muted);
}

.launcher-only {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  color: var(--mc-text-muted);
}

.share-text {
  position: relative;
  display: inline-grid;
}

.share-text .is-hidden {
  visibility: hidden;
}

.share-done {
  position: absolute;
  inset: 0;
  text-align: center;
}

.is-copied,
.is-copied :deep(.bi) {
  color: var(--mc-accent);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 2px;
}

.is-favorite :deep(.bi) {
  color: var(--mc-text);
}

.body {
  padding-top: 16px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tags-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.tags-row .tags {
  flex: 1;
  min-width: 0;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.5fr);
  margin: 16px 0 0;
  overflow: hidden;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-surface);
}

.stat {
  padding: 12px 16px;
}

.stat + .stat {
  border-left: 1px solid var(--mc-border);
}

.stat dt {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.stat dd {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 3px 0 0;
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.is-score {
  position: relative;
}

.is-score dd {
  gap: 12px;
  white-space: nowrap;
}

.is-score .score-edge {
  gap: 2px;
}

.is-score .is-none {
  font-weight: 400;
  color: var(--mc-text-dim);
}

.score-parts {
  display: inline-flex;
  gap: 10px;
  font-size: 12px;
}

.score-parts > span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.score-parts .is-energy {
  color: var(--mc-gold);
}

.score-parts .is-votes {
  color: var(--mc-votes);
}

.score-edge {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  gap: 2px;
  height: 3px;
  background: var(--mc-border);
}

.score-edge > span {
  flex-basis: 0;
  min-width: 4px;
}

.score-edge > .is-energy {
  background: var(--mc-gold);
}

.score-edge > .is-votes {
  background: var(--mc-votes);
}

.columns {
  margin-top: 16px;
}

.small {
  font-size: 12px;
}

.chart-meta {
  display: flex;
  gap: 24px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
}

.chart-meta strong {
  font-weight: 400;
  color: var(--mc-text);
}

.prose p,
.prose ul {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--mc-text-muted);
}

.prose ul {
  padding-left: 18px;
  line-height: 1.7;
}

.prose-heading {
  margin: 18px 0 8px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--mc-text);
}

.prose-heading:first-child {
  margin-top: 0;
}

.prose-heading.is-h1 {
  font-size: 17px;
}

.prose-heading.is-h2 {
  font-size: 16px;
}

.prose-heading.is-h3 {
  font-size: 15px;
}

.prose-heading.is-h4 {
  font-size: 14px;
}

.prose > :last-child {
  margin-bottom: 0;
}

.prose code {
  font-family: var(--mc-font-mono);
  font-size: 13px;
  color: var(--mc-text);
}

.panel-action {
  width: 100%;
  margin-top: 14px;
}

.panel-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--mc-text-muted);
}

.panel-note {
  margin: 8px 0 0;
  font-size: 12px;
}

.join {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.join .address {
  color: var(--mc-text);
}

.vote-panel {
  container-type: inline-size;
}

.vote-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  margin-top: 16px;
}

.vote-action {
  flex-shrink: 0;
  min-width: 132px;
}

.vote-action:disabled {
  opacity: 1;
  background: var(--mc-surface-2);
  border-color: var(--mc-border);
  color: var(--mc-text-muted);
  cursor: not-allowed;
}

.vote-count {
  white-space: nowrap;
}

.vote-title {
  margin-bottom: 6px;
  font-weight: 600;
  font-size: 14px;
}

.vote-title ~ .small + .small {
  margin-top: 4px;
}

.vote-site {
  margin-top: 8px;
}

.vote-error {
  margin: 10px 0 0;
  color: var(--mc-danger);
}

.watch {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--mc-border);
}

.watch-note {
  margin: 10px 0 0;
}

.watch-error .vote-error {
  margin: 0;
}

.watch-error {
  display: grid;
  justify-items: start;
  gap: 8px;
  margin-top: 10px;
}

.sign-in {
  color: var(--mc-accent);
  text-decoration: none;
  text-underline-offset: 4px;
}

.sign-in:hover {
  text-decoration: underline;
}

.own-site {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--mc-border);
}

.own-site:last-child {
  padding-bottom: 0;
  margin-bottom: 0;
  border-bottom: 0;
}

.own-site > span {
  flex-shrink: 0;
}

.own-site a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--mc-accent);
  text-decoration: none;
  white-space: nowrap;
}

.own-site a span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.own-site a:hover {
  text-decoration: underline;
}

.own-site .bi {
  flex-shrink: 0;
  font-size: 13px;
}

.links {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.links .bi {
  flex-shrink: 0;
}
</style>
