<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import type { AccountError, AccountErrorCode } from '@shared/account';
import type { ServerCard, TopSlotTier } from '@shared/catalog';
import { countOf, fill, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { OwnedServerDetails } from '@shared/owner';
import BiIcon from '../components/BiIcon.vue';
import ScoreSplit from '../components/ScoreSplit.vue';
import OnlineChart from '../components/OnlineChart.vue';
import ServerIcon from '../components/ServerIcon.vue';
import SiteErrorState from '../components/SiteErrorState.vue';
import SkelBar from '../components/SkelBar.vue';
import TopSlotGem from '../components/TopSlotGem.vue';
import StateNotice from '../components/StateNotice.vue';
import UiButton from '../components/UiButton.vue';
import UiSelect from '../components/UiSelect.vue';
import { useLauncher } from '../composables/context';
import { useAccounts } from '../composables/useAccounts';
import { useCatalog } from '../composables/useCatalog';
import { useVisibleInterval } from '../composables/useVisibleInterval';
import { useOwner } from '../composables/useOwner';
import { useSite } from '../composables/useSite';
import { useSiteChange } from '../composables/useSiteChange';
import { useTrack } from '../composables/useTrack';
import { shownAddress } from '../lib/minecraft';
import {
  aboveRank,
  changeText,
  dayDowntimes,
  downSince,
  downtimesText,
  downtimeText,
  eventMark,
  markTier,
  withoutRepeats,
  eventTime,
  figure,
  percentText,
  siteErrorOf,
  slotLeft,
} from '../lib/owner';
import { moscowDate, moscowDateShort, moscowTime } from '../lib/time';

type Status = 'loading' | 'ready' | 'error' | 'forbidden';

interface Stat {
  key: string;
  label: string;
  value: string;
  note: string | null;
  tier?: TopSlotTier;
}

interface Fact {
  key: string;
  label: string;
  value: string;
  note: string | null;
}

const REFRESH_INTERVAL_MS = 60_000;
const LEGEND_DOWNTIMES = 3;
const SIGNED_OUT: readonly AccountErrorCode[] = ['not_signed_in', 'unauthenticated'];
const NOT_OWNED: readonly AccountErrorCode[] = ['forbidden', 'server_not_found'];

const { serverId } = defineProps<{ serverId: number | null }>();
const router = useRouter();
const { now } = useLauncher();
const owner = useOwner();
const accounts = useAccounts();
const site = useSite();
const catalog = useCatalog();
const track = useTrack();

const details = shallowRef<OwnedServerDetails | null>(null);
const card = shallowRef<ServerCard | null>(null);
const freeTiers = shallowRef<TopSlotTier[]>([]);
const status = ref<Status>('loading');
const error = ref<AccountError | null>(null);
let run = 0;

const activeId = computed(() => serverId ?? owner.refs.value[0]?.id ?? null);
const cabinet = computed(() => site.links.value.cabinet);
const topSlotUrl = computed(() => site.links.value.promote);

function trackSlot(name: 'top_slot_take' | 'top_slot_extend'): void {
  track({ type: 'action', name, server_id: activeId.value });
}
const topSlot = computed(() => {
  const slot = details.value?.topSlot ?? null;
  const left = slot === null ? null : slotLeft(slot.endsAt, now());
  return slot === null || left === null
    ? null
    : {
        tier: slot.tier,
        name: ru.owner.topSlot.tiers[slot.tier],
        until: fill(ru.owner.topSlot.until, {
          date: moscowDate(slot.endsAt),
          time: moscowTime(slot.endsAt),
        }),
        left,
      };
});

const freeSlot = computed(() => {
  const [first, second] = freeTiers.value;
  if (topSlot.value !== null || details.value?.topSlot != null || first === undefined) {
    return null;
  }
  return second === undefined ? ru.owner.topSlot.free[first] : ru.owner.topSlot.free.both;
});

async function load(id: number, quiet = false): Promise<void> {
  run += 1;
  const current = run;
  if (!quiet) {
    status.value = 'loading';
  }
  const [result, loadedCard, free] = await Promise.all([
    owner.details(id),
    owner.card(id),
    owner.freeTopSlots(),
  ]);
  if (current !== run) {
    return;
  }
  if (result.ok) {
    details.value = result.value;
    card.value = loadedCard;
    freeTiers.value = free;
    error.value = null;
    status.value = 'ready';
    return;
  }
  if (SIGNED_OUT.includes(result.error.code)) {
    void router.replace('/');
    return;
  }
  if (NOT_OWNED.includes(result.error.code)) {
    status.value = 'forbidden';
    return;
  }
  if (quiet && status.value === 'ready') {
    return;
  }
  error.value = result.error;
  status.value = 'error';
}

useSiteChange((change) => {
  const id = activeId.value;
  const mine = (change.topic === 'owned-server' || change.topic === 'server') && change.id === id;
  const freeSlots = change.topic === 'servers' && change.query.per_page === 1;
  if (id !== null && status.value === 'ready' && (mine || freeSlots)) {
    void load(id, true);
  }
});

function retry(): void {
  if (activeId.value !== null) {
    void load(activeId.value);
  }
}

watch(
  [(): boolean => owner.settled.value, (): boolean => owner.isOwner.value],
  ([settled, isOwner]) => {
    if (settled && !isOwner) {
      void router.replace('/');
    }
  },
  { immediate: true },
);

watch(
  [activeId, (): number | null => accounts.mc.value?.id ?? null],
  ([id]) => {
    if (id !== null) {
      void load(id);
    }
  },
  { immediate: true },
);

useVisibleInterval(() => {
  if (activeId.value !== null && status.value === 'ready') {
    void load(activeId.value, true);
  }
}, REFRESH_INTERVAL_MS);

onBeforeUnmount(() => {
  run += 1;
});

const options = computed(() =>
  owner.refs.value.map((item) => ({
    value: String(item.id),
    label: fill(ru.owner.head.option, {
      name: item.name,
      state: item.status === 'down' ? ru.owner.down : ru.owner.up,
    }),
  })),
);

const selected = computed({
  get: () => String(activeId.value ?? ''),
  set: (value) => {
    void router.push(`/my-servers/${value}`);
  },
});

const isDown = computed(() => details.value?.status === 'down');
const icon = computed(() =>
  activeId.value === null ? null : (card.value?.icon_url ?? owner.icon(activeId.value)),
);
const address = computed(() => (card.value === null ? null : shownAddress(card.value)));

const headMeta = computed(() => {
  const current = details.value;
  if (current === null) {
    return '';
  }
  const updated =
    current.checkedAt === null
      ? null
      : fill(ru.owner.head.updatedAt, { time: moscowTime(current.checkedAt) });
  return [current.version, updated].filter((part) => part !== null).join(' · ');
});

const downTitle = computed(() => {
  const since = details.value === null ? null : downSince(details.value, now());
  return since === null ? ru.owner.downTag : fill(ru.owner.downSinceTitle, { since });
});

function filled(template: string, key: string, value: number | null): string | null {
  return value === null ? null : fill(template, { [key]: formatNumber(value) });
}

const catalogSize = ref<number | null>(null);
watchEffect(() => {
  const query = catalog.listQuery.value;
  if (
    query !== null &&
    query.q === '' &&
    query.access === undefined &&
    catalog.status.value === 'ready'
  ) {
    catalogSize.value = catalog.total.value;
  }
});

function uptimeNote(uptime: number | null, downtimes: string | null): string | null {
  if (uptime === null) {
    return null;
  }
  return downtimes === null
    ? ru.owner.stats.uptimeDays
    : fill(ru.owner.stats.uptimeNote, { downtimes });
}

const stats = computed<Stat[]>(() => {
  const current = details.value;
  if (current === null) {
    return [];
  }
  const down = current.status === 'down';
  const downtimes = downtimesText(current.downtimes30d);
  const slot = current.topSlot;
  return [
    {
      key: 'online',
      label: ru.owner.stats.online,
      value: down ? ru.owner.empty : figure(current.online),
      note: down ? null : filled(ru.owner.stats.ofSlots, 'slots', current.slots),
    },
    {
      key: 'average',
      label: ru.owner.stats.average,
      value: figure(current.onlineAvgDay),
      note: filled(ru.owner.stats.yesterday, 'value', current.onlineAvgPrevDay),
    },
    {
      key: 'uptime',
      label: ru.owner.stats.uptime,
      value: percentText(current.uptime30d),
      note: uptimeNote(current.uptime30d, downtimes),
    },
    slot !== null && aboveRank(current, now())
      ? {
          key: 'rank',
          label: ru.owner.topSlot.aboveRank,
          value: ru.owner.topSlot.tiers[slot.tier],
          note: fill(ru.owner.stats.slotUntil, { date: moscowDate(slot.endsAt) }),
          tier: slot.tier,
        }
      : {
          key: 'rank',
          label: ru.owner.stats.rank,
          value: figure(current.rank),
          note:
            filled(ru.owner.stats.rankWeekAgo, 'rank', current.rankWeekAgo) ??
            (current.rank === null
              ? null
              : filled(ru.owner.stats.rankOf, 'total', catalogSize.value)),
        },
  ];
});

const split = computed(() => {
  const current = details.value;
  if (current === null) {
    return null;
  }
  const change = current.votesMonthChange;
  return {
    energy: current.points,
    votes: current.votesMonth,
    until:
      current.pointsExpireAt === null
        ? null
        : fill(ru.owner.stats.energyUntil, { date: moscowDateShort(current.pointsExpireAt) }),
    change: changeText(change),
    tone: change === null || change === 0 ? 'none' : change > 0 ? 'up' : 'down',
  };
});

const chart = computed(() => {
  const points = card.value?.chart_24h ?? [];
  const values = points.map((point) => point.online);
  const downtimes = dayDowntimes(card.value?.downtimes ?? [], now());
  const peak =
    details.value?.onlinePeakDay ??
    (card.value?.peak_24h
      ? { value: card.value.peak_24h.online, at: card.value.peak_24h.at }
      : null);
  return {
    points,
    downtimes,
    legend: downtimes.slice(0, LEGEND_DOWNTIMES).map((item) => downtimeText(item)),
    more: Math.max(0, downtimes.length - LEGEND_DOWNTIMES),
    peak:
      peak === null || points.length === 0
        ? null
        : fill(ru.serverPage.peakAt, {
            value: formatNumber(peak.value),
            time: moscowTime(peak.at),
          }),
    label: fill(ru.serverPage.chartLabel, {
      peak: formatNumber(values.length === 0 ? 0 : Math.max(...values)),
      min: formatNumber(values.length === 0 ? 0 : Math.min(...values)),
    }),
  };
});

const sources = computed(() => {
  const current = details.value?.sources7d ?? null;
  if (current === null) {
    return [];
  }
  const rows = [
    { key: 'launcher', label: ru.owner.sources.launcherLaunches, value: current.launcherLaunches },
    { key: 'copies', label: ru.owner.sources.addressCopies, value: current.addressCopies },
    { key: 'clicks', label: ru.owner.sources.siteClicks, value: current.siteClicks },
    ...(current.widgetVotes === null
      ? []
      : [{ key: 'widget', label: ru.owner.sources.widgetVotes, value: current.widgetVotes }]),
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));
  return rows.map((row) => ({
    ...row,
    text: formatNumber(row.value),
    width: `${String(Math.round((row.value / max) * 100))}%`,
  }));
});

const EVENTS_SHOWN = 5;
const allEventsOpen = ref(false);
watch(activeId, () => {
  allEventsOpen.value = false;
});
const events = computed(() =>
  withoutRepeats(details.value?.events ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    mark: eventMark(item.kind),
    tier: markTier(eventMark(item.kind), item, details.value ?? { topSlot: null }),
    time: eventTime(item.at, now()),
  })),
);
const shownEvents = computed(() =>
  allEventsOpen.value ? events.value : events.value.slice(0, EVENTS_SHOWN),
);

function votifierText(votifier: OwnedServerDetails['votifier']): string {
  if (votifier === null) {
    return ru.owner.empty;
  }
  if (votifier.ok) {
    return ru.owner.rating.votifierOk;
  }
  return votifier.lastErrorAt === null
    ? ru.owner.rating.votifierFailUnknown
    : fill(ru.owner.rating.votifierFail, { date: moscowDate(votifier.lastErrorAt) });
}

const rating = computed<Fact[]>(() => {
  const current = details.value;
  if (current === null) {
    return [];
  }
  const { reviews, complaints } = current;
  return [
    {
      key: 'votifier',
      label: ru.owner.rating.votifier,
      value: votifierText(current.votifier),
      note: null,
    },
    {
      key: 'reviews',
      label: ru.owner.rating.reviews,
      value: reviews === null ? ru.owner.empty : formatNumber(reviews.total),
      note:
        reviews === null || reviews.fresh === 0
          ? null
          : countOf(reviews.fresh, ru.owner.rating.newReviews),
    },
    {
      key: 'complaints',
      label: ru.owner.rating.complaints,
      value:
        complaints === null
          ? ru.owner.empty
          : complaints.total === 0
            ? ru.owner.rating.none
            : formatNumber(complaints.total),
      note:
        complaints === null || complaints.fresh === 0
          ? null
          : countOf(complaints.fresh, ru.owner.rating.newComplaints),
    },
  ];
});
</script>

<template>
  <div class="lx-content">
    <StateNotice
      v-if="status === 'forbidden'"
      icon="shield-lock"
      :title="ru.owner.forbidden.title"
      :text="ru.owner.forbidden.text"
      data-owner="forbidden"
    >
      <UiButton size="sm" to="/">{{ ru.owner.forbidden.home }}</UiButton>
    </StateNotice>
    <SiteErrorState v-else-if="status === 'error'" :error="siteErrorOf(error)" @retry="retry" />
    <div
      v-else-if="status === 'loading' || details === null"
      data-loading
      role="status"
      :aria-label="ru.state.loading"
    >
      <div class="head">
        <SkelBar :w="48" :h="48" />
        <div class="skel-lines">
          <SkelBar :w="200" :h="24" />
          <SkelBar :w="260" :h="14" />
        </div>
      </div>
      <div class="stats lx-skel-frame">
        <div v-for="index in 5" :key="index" class="stat">
          <SkelBar w="70%" :h="12" />
          <SkelBar class="skel-value" w="55%" :h="20" />
        </div>
      </div>
      <div class="columns">
        <div class="column">
          <div class="lx-skel-frame skel-panel is-tall" />
          <div class="lx-skel-frame skel-panel" />
        </div>
        <div class="column">
          <div class="lx-skel-frame skel-panel is-tall" />
          <div class="lx-skel-frame skel-panel" />
        </div>
      </div>
    </div>
    <template v-else>
      <header class="head">
        <ServerIcon :src="icon" size="md" />
        <div class="head-text">
          <div class="head-title">
            <h1 class="lx-h1 selectable">{{ details.name }}</h1>
            <span class="status" :class="{ 'is-down': isDown }" data-status>
              <BiIcon v-if="isDown" name="x-circle" />
              <span v-else class="dot" />
              {{ isDown ? ru.owner.downTag : ru.owner.upTag }}
            </span>
          </div>
          <div class="head-meta">
            <span v-if="address !== null" class="address selectable">{{ address }}</span>
            <span v-else-if="card !== null" class="launcher-only" data-launcher-only>
              <BiIcon name="box-arrow-in-right" />{{ ru.server.launcherOnly }}
            </span>
            <span class="lx-num">{{ headMeta }}</span>
          </div>
        </div>
        <UiSelect
          v-if="options.length > 1"
          v-model="selected"
          :options="options"
          :label="ru.owner.head.switch"
          :width="200"
        />
        <UiButton size="sm" :href="cabinet">
          {{ ru.owner.cabinet }}<BiIcon class="lx-out" name="box-arrow-up-right" />
        </UiButton>
      </header>

      <StateNotice
        v-if="isDown"
        class="down"
        icon="x-circle"
        tone="danger"
        :title="downTitle"
        :text="ru.owner.downText"
        data-owner="down"
      />

      <dl class="stats">
        <div v-for="item in stats" :key="item.key" class="stat" :data-stat="item.key">
          <dt>{{ item.label }}</dt>
          <dd>
            <span class="stat-value">
              <TopSlotGem v-if="item.tier" class="stat-gem" :tier="item.tier" decorative />{{
                item.value
              }}
            </span>
            <span v-if="item.note !== null" class="stat-note">{{ item.note }}</span>
          </dd>
        </div>
        <div v-if="split !== null" class="stat is-split" data-stat="split">
          <dt>
            <span>
              {{ ru.owner.stats.energy }}
              <span v-if="split.until !== null" class="split-until">{{ split.until }}</span>
            </span>
            <span>
              {{ ru.owner.stats.votes }}
              <span
                v-if="split.change !== null"
                class="split-change"
                :class="`is-${split.tone}`"
                :title="ru.owner.stats.changeHint"
                >{{ split.change }}</span
              >
            </span>
          </dt>
          <dd>
            <ScoreSplit :energy="split.energy" :votes="split.votes" size="tile" />
          </dd>
        </div>
      </dl>

      <div class="columns">
        <div class="column">
          <section class="lx-panel" aria-labelledby="owner-chart">
            <div class="lx-panel-head">
              <h2 id="owner-chart">{{ ru.owner.chart.title }}</h2>
              <span class="period">{{ ru.owner.chart.period }}</span>
            </div>
            <div class="lx-panel-body">
              <OnlineChart
                :points="chart.points"
                :downtimes="chart.downtimes"
                :label="chart.label"
              />
              <div v-if="chart.legend.length > 0 || chart.peak !== null" class="legend">
                <ul v-if="chart.legend.length > 0" class="legend-list">
                  <li v-for="text in chart.legend" :key="text"><span class="key" />{{ text }}</li>
                  <li v-if="chart.more > 0" class="legend-more">
                    {{ fill(ru.owner.chart.moreDowntimes, { count: chart.more }) }}
                  </li>
                </ul>
                <span v-if="chart.peak !== null" class="peak">{{ chart.peak }}</span>
              </div>
            </div>
          </section>

          <section v-if="sources.length > 0" class="lx-panel" aria-labelledby="owner-sources">
            <div class="lx-panel-head">
              <h2 id="owner-sources">{{ ru.owner.sources.title }}</h2>
              <span class="period">{{ ru.owner.sources.period }}</span>
            </div>
            <dl class="lx-panel-body sources">
              <template v-for="row in sources" :key="row.key">
                <dt>{{ row.label }}</dt>
                <dd class="bar" aria-hidden="true">
                  <span
                    :class="{ 'is-violet': row.key === 'launcher' }"
                    :style="{ width: row.width }"
                  />
                </dd>
                <dd class="source-value">{{ row.text }}</dd>
              </template>
            </dl>
          </section>
        </div>

        <div class="column">
          <section class="lx-panel" aria-labelledby="owner-events">
            <div class="lx-panel-head">
              <h2 id="owner-events">{{ ru.owner.events.title }}</h2>
              <span class="period">{{ ru.owner.events.period }}</span>
            </div>
            <ul v-if="events.length > 0" class="events">
              <li v-for="item in shownEvents" :key="item.id" class="event">
                <TopSlotGem
                  v-if="item.tier !== null"
                  class="event-gem"
                  :tier="item.tier"
                  decorative
                />
                <BiIcon v-else :class="`is-${item.mark.tone}`" :name="item.mark.icon" />
                <div class="event-text">
                  <div class="event-title">{{ item.title }}</div>
                  <div class="event-meta">{{ item.time }}</div>
                </div>
              </li>
            </ul>
            <p v-else class="lx-panel-body events-empty">{{ ru.owner.events.empty }}</p>
            <button
              v-if="events.length > EVENTS_SHOWN"
              type="button"
              class="events-more"
              :aria-expanded="allEventsOpen"
              @click="allEventsOpen = !allEventsOpen"
            >
              {{
                allEventsOpen
                  ? ru.owner.events.less
                  : fill(ru.owner.events.more, { count: events.length - EVENTS_SHOWN })
              }}
            </button>
          </section>

          <section v-if="topSlot !== null" class="lx-panel" aria-labelledby="owner-top-slot">
            <div class="lx-panel-head">
              <h2 id="owner-top-slot">{{ ru.owner.topSlot.title }}</h2>
              <UiButton size="sm" :href="topSlotUrl" @click="trackSlot('top_slot_extend')">
                {{ ru.owner.topSlot.extend }}
                <BiIcon class="lx-out" name="box-arrow-up-right" />
              </UiButton>
            </div>
            <div class="lx-panel-body slot">
              <span class="slot-gem" :class="`is-${topSlot.tier}`">
                <TopSlotGem :tier="topSlot.tier" decorative />
              </span>
              <div class="slot-text">
                <div class="slot-tier">{{ topSlot.name }}</div>
                <div class="slot-until">{{ topSlot.until }}</div>
              </div>
              <div class="slot-left" :class="{ 'is-soon': topSlot.left.soon }">
                <b>{{ topSlot.left.text }}</b>
                <span>{{ ru.owner.topSlot.left }}</span>
              </div>
            </div>
          </section>

          <section v-else-if="freeSlot !== null" class="lx-panel" aria-labelledby="owner-top-slot">
            <div class="lx-panel-head">
              <h2 id="owner-top-slot">{{ ru.owner.topSlot.title }}</h2>
              <UiButton size="sm" :href="topSlotUrl" @click="trackSlot('top_slot_take')">
                {{ ru.owner.topSlot.take }}<BiIcon class="lx-out" name="box-arrow-up-right" />
              </UiButton>
            </div>
            <div class="lx-panel-body" data-slot="free">
              <div class="slot-tier">{{ freeSlot }}</div>
              <div class="slot-until">{{ ru.owner.topSlot.freeHint }}</div>
            </div>
          </section>

          <section class="lx-panel" aria-labelledby="owner-rating">
            <div class="lx-panel-head">
              <h2 id="owner-rating">{{ ru.owner.rating.title }}</h2>
            </div>
            <dl class="lx-panel-body facts">
              <template v-for="item in rating" :key="item.key">
                <dt>{{ item.label }}</dt>
                <dd :data-fact="item.key">
                  {{ item.value }}
                  <span v-if="item.note !== null" class="fact-note">{{ item.note }}</span>
                </dd>
              </template>
            </dl>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.head-text {
  flex: 1;
  min-width: 0;
}

.head-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.head-title h1 {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
  background: var(--mc-accent-soft);
  color: var(--mc-accent);
}

.status.is-down {
  background: color-mix(in srgb, var(--mc-danger) 14%, transparent);
  color: var(--mc-danger);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.head-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 4px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.address {
  font-family: var(--mc-font-mono);
  font-size: 13px;
}

.launcher-only {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.down {
  margin-top: 20px;
  border-color: color-mix(in srgb, var(--mc-danger) 45%, var(--mc-border));
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(0, 1.15fr) minmax(0, 1fr) minmax(
      0,
      1.75fr
    );
  margin: 24px 0 0;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-surface);
}

.down + .stats {
  margin-top: 16px;
}

.stat {
  min-width: 0;
  padding: 12px 12px;
}

.stat + .stat {
  border-left: 1px solid var(--mc-border);
}

.stat dt {
  font-size: 12px;
  color: var(--mc-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat dd {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 3px 0 0;
  font-variant-numeric: tabular-nums;
}

.stat-value {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
}

.stat-gem {
  width: 18px;
  height: 18px;
}

.is-split dt {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  overflow: visible;
}

.is-split dt > span {
  white-space: nowrap;
}

.split-until {
  color: var(--mc-text-dim);
}

.split-change.is-up {
  color: var(--mc-accent);
}

.split-change.is-down {
  color: var(--mc-danger);
}

.is-split dd {
  margin-top: 5px;
}

.is-split :deep(.split) {
  width: 100%;
  gap: 9px;
}

.stat-note {
  font-size: 12px;
  color: var(--mc-text-muted);
  white-space: nowrap;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  gap: 16px;
  margin-top: 16px;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.lx-panel-head h2 {
  margin: 0;
  font-family: var(--mc-font-body);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.period {
  font-size: 12px;
  color: var(--mc-text-muted);
}

.legend {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--mc-text-muted);
  font-variant-numeric: tabular-nums;
}

.legend-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.legend-more {
  padding-left: 15px;
}

.key {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 7px;
  border-radius: calc(var(--mc-radius-sm) / 4);
  background: var(--mc-danger);
}

.peak {
  margin-left: auto;
  white-space: nowrap;
}

.sources {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px 14px;
  margin: 0;
  font-size: 13px;
}

.sources dd {
  margin: 0;
}

.bar {
  height: 6px;
  border-radius: 999px;
  background: var(--mc-surface-3);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--mc-text-dim);
}

.bar span.is-violet {
  background: var(--mc-violet);
}

.source-value {
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.events {
  margin: 0;
  padding: 0;
  list-style: none;
}

.event {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  padding: 11px 16px;
}

.event + .event {
  border-top: 1px solid var(--mc-border);
}

.event > .bi {
  margin-top: 2px;
  font-size: 15px;
}

.event-gem {
  flex: none;
  width: 16px;
  margin-top: 3px;
}

.is-ok {
  color: var(--mc-accent);
}

.is-bad {
  color: var(--mc-danger);
}

.is-gold {
  color: var(--mc-gold);
}

.is-muted {
  color: var(--mc-text-muted);
}

.event-title {
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.event-meta {
  margin-top: 1px;
  font-size: 12px;
  color: var(--mc-text-muted);
  font-variant-numeric: tabular-nums;
}

.events-empty {
  margin: 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.events-more {
  display: block;
  width: 100%;
  padding: 10px 16px;
  border: 0;
  border-top: 1px solid var(--mc-border);
  border-radius: 0 0 var(--mc-radius) var(--mc-radius);
  background: transparent;
  font-size: 13px;
  text-align: left;
  color: var(--mc-text-muted);
}

.events-more:hover {
  background: var(--mc-surface-2);
  color: var(--mc-text);
}

.slot {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.slot-gem {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-gold-soft);
}

.slot-gem.is-diamond {
  background: var(--mc-diamond-soft);
}

.slot-tier {
  font-size: 15px;
  font-weight: 600;
}

.slot-until {
  margin-top: 1px;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.slot-left {
  display: flex;
  flex-direction: column;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.slot-left b {
  font-size: 17px;
  font-weight: 600;
}

.slot-left span {
  font-size: 12px;
  color: var(--mc-text-muted);
}

.slot-left.is-soon b {
  color: var(--mc-gold);
}

.facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px 14px;
  margin: 0;
  font-size: 13px;
}

.facts dt {
  color: var(--mc-text-muted);
}

.facts dd {
  margin: 0;
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.fact-note {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--mc-text-muted);
}

.skel-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skel-value {
  margin-top: 8px;
}

.skel-panel {
  height: 150px;
}

.skel-panel.is-tall {
  height: 230px;
}

@media (max-width: 1279px) {
  .stat dd {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 1099px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
