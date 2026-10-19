<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { TopSlotTier } from '@shared/catalog';
import type { OwnedServer } from '@shared/owner';
import { useLauncher } from '../composables/context';
import { useExternal } from '../composables/useExternal';
import { useOwner } from '../composables/useOwner';
import { useSite } from '../composables/useSite';
import {
  aboveRank,
  eventMark,
  figure,
  markTier,
  percentText,
  stateText,
  type EventMark,
} from '../lib/owner';
import { moscowDate } from '../lib/time';
import BiIcon from './BiIcon.vue';
import ScoreSplit from './ScoreSplit.vue';
import ServerIcon from './ServerIcon.vue';
import TopSlotGem from './TopSlotGem.vue';
import SkelBar from './SkelBar.vue';
import UiButton from './UiButton.vue';

interface Note {
  text: string;
  mark: EventMark | null;
  tier: TopSlotTier | null;
}

const { now } = useLauncher();
const owner = useOwner();
const site = useSite();
const external = useExternal();

const cabinet = computed(() => site.links.value.cabinet);
const loading = computed(() => owner.status.value === 'loading');
const failed = computed(() => owner.status.value === 'error');
const shown = computed(
  () =>
    owner.isOwner.value &&
    owner.status.value !== 'idle' &&
    (owner.status.value !== 'ready' || owner.servers.value.length > 0),
);

function note(server: OwnedServer): Note {
  if (server.attention !== null) {
    const mark = eventMark(server.attention.kind);
    const text =
      server.attention.kind === 'points_expire' && server.pointsExpireAt !== null
        ? fill(ru.owner.table.energyUntil, { date: moscowDate(server.pointsExpireAt) })
        : server.attention.title;
    return { text, mark, tier: markTier(mark, server.attention, server) };
  }
  const text = server.status === 'down' ? ru.owner.table.noOtherEvents : ru.owner.table.noEvents;
  return { text, mark: null, tier: null };
}

const rows = computed(() =>
  owner.servers.value.map((server) => ({
    server,
    state: stateText(server, now()),
    note: note(server),
    above: aboveRank(server, now()) ? server.topSlot : null,
    rank: figure(server.rank),
    uptime: percentText(server.uptime30d),
  })),
);
</script>

<template>
  <section v-if="shown" class="owner-table" aria-labelledby="home-owner">
    <div class="head">
      <div class="head-title">
        <h2 id="home-owner">{{ ru.owner.table.title }}</h2>
        <span class="legend" aria-hidden="true">
          <span><i class="is-energy" />{{ ru.server.legendEnergy }}</span>
          <span><i class="is-votes" />{{ ru.server.legendVotes }}</span>
        </span>
      </div>
      <a
        class="cabinet"
        :href="cabinet"
        rel="noopener noreferrer"
        @click.prevent="external.open(cabinet)"
      >
        {{ ru.owner.cabinet }}<BiIcon class="lx-out" name="box-arrow-up-right" />
      </a>
    </div>
    <div class="row is-head" aria-hidden="true">
      <span />
      <span>{{ ru.owner.table.server }}</span>
      <span class="is-end">{{ ru.owner.table.rank }}</span>
      <span>{{ ru.owner.table.split }}</span>
      <span class="is-end">{{ ru.owner.table.uptime }}</span>
      <span>{{ ru.owner.table.attention }}</span>
      <span />
    </div>
    <div v-if="failed" class="fail" role="alert">
      <span>{{ ru.owner.table.error }}</span>
      <UiButton size="sm" icon="arrow-clockwise" @click="owner.load()">
        {{ ru.state.retry }}
      </UiButton>
    </div>
    <div v-else-if="loading" data-loading role="status" :aria-label="ru.state.loading">
      <div v-for="item in owner.refs.value" :key="item.id" class="row">
        <SkelBar :w="40" :h="40" />
        <span class="skel-lines">
          <SkelBar :w="120" :h="15" />
          <SkelBar :w="90" :h="12" />
        </span>
        <SkelBar :w="24" :h="15" />
        <SkelBar w="100%" :h="15" />
        <SkelBar :w="52" :h="15" />
        <SkelBar :w="140" :h="13" />
        <span />
      </div>
    </div>
    <template v-else>
      <RouterLink
        v-for="row in rows"
        :key="row.server.id"
        class="row"
        :to="`/my-servers/${String(row.server.id)}`"
        :title="fill(ru.owner.table.open, { name: row.server.name })"
      >
        <ServerIcon :src="owner.icon(row.server.id)" size="sm" />
        <span class="name">
          <span class="name-text">{{ row.server.name }}</span>
          <span class="state" :class="{ 'is-bad': row.server.status === 'down' }">
            <BiIcon v-if="row.server.status === 'down'" name="x-circle" />
            <span v-else class="dot" />
            {{ row.state }}
          </span>
        </span>
        <span class="fig is-end">
          <span class="lx-visually-hidden">{{ ru.owner.table.rank }}:</span>
          <span
            v-if="row.above !== null"
            class="above"
            :title="fill(ru.owner.topSlot.aboveRankTier, { tier: ru.topSlots[row.above.tier] })"
          >
            <TopSlotGem class="fig-gem" :tier="row.above.tier" decorative />
            <span class="lx-visually-hidden">
              {{ fill(ru.owner.topSlot.aboveRankTier, { tier: ru.topSlots[row.above.tier] }) }}
            </span>
          </span>
          <template v-else>{{ row.rank }}</template>
        </span>
        <ScoreSplit :energy="row.server.points" :votes="row.server.votesMonth" />
        <span class="fig is-end">
          <span class="lx-visually-hidden">{{ ru.owner.table.uptime }}:</span>
          {{ row.uptime }}
        </span>
        <span
          class="note"
          :class="row.note.mark === null ? 'is-none' : `is-${row.note.mark.tone}`"
          :title="row.note.text"
        >
          <span class="lx-visually-hidden">{{ ru.owner.table.attention }}:</span>
          <TopSlotGem
            v-if="row.note.tier !== null"
            class="note-gem"
            :tier="row.note.tier"
            decorative
          />
          <BiIcon v-else-if="row.note.mark !== null" :name="row.note.mark.icon" />
          <span class="note-text">{{ row.note.text }}</span>
        </span>
        <BiIcon class="go" name="chevron-right" />
      </RouterLink>
    </template>
  </section>
</template>

<style scoped>
.owner-table {
  margin-top: 28px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-surface);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
}

.head-title {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.legend {
  display: inline-flex;
  gap: 12px;
  font-size: 12px;
  color: var(--mc-text-muted);
  white-space: nowrap;
}

.legend > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend i {
  width: 8px;
  height: 4px;
  border-radius: 999px;
}

.legend .is-energy {
  background: var(--mc-gold);
}

.legend .is-votes {
  background: var(--mc-votes);
}

.head h2 {
  margin: 0;
  font-family: var(--mc-font-body);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
}

.cabinet {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  color: var(--mc-text-muted);
  text-decoration: none;
  white-space: nowrap;
}

.cabinet:hover {
  color: var(--mc-text);
}

.row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 40px 150px 60px minmax(0, 188px) 12px;
  align-items: center;
  gap: 18px;
  padding: 12px 16px;
  border-top: 1px solid var(--mc-border);
  color: var(--mc-text);
  text-decoration: none;
  cursor: default;
}

a.row:hover {
  background: var(--mc-surface-2);
}

a.row:last-child {
  border-radius: 0 0 var(--mc-radius) var(--mc-radius);
}

a.row:focus-visible {
  outline-offset: -2px;
}

.row.is-head {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--mc-text-muted);
  white-space: nowrap;
}

.name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name-text {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--mc-text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.state.is-bad {
  color: var(--mc-danger);
}

.dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mc-accent);
}

.fig {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.is-end {
  text-align: right;
}

.fig .fig-gem {
  width: 16px;
  height: 16px;
  vertical-align: middle;
}

.note {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 13px;
}

.note-text {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.3;
}

.note.is-none {
  color: var(--mc-text-muted);
}

.note-gem {
  flex: none;
  width: 16px;
}

.note.is-gold {
  color: var(--mc-gold);
}

.note.is-bad .bi {
  color: var(--mc-danger);
}

.note.is-ok .bi {
  color: var(--mc-accent);
}

.note.is-muted .bi {
  color: var(--mc-text-muted);
}

.go {
  font-size: 13px;
  color: var(--mc-text-muted);
}

.skel-lines {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--mc-border);
  font-size: 13px;
  color: var(--mc-text-muted);
}
</style>
