<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { ServerRow } from '@shared/catalog';
import type { PlaySource } from '@shared/telemetry';
import { ru } from '@shared/i18n/ru';
import { compactVersionLabel, versionLabel } from '../lib/minecraft';
import { accessChips, serverTags, tagView, unstableChip } from '../lib/tags';
import { ACTION_COLUMN_PX } from '../lib/catalog-columns';
import TopSlotGem from './TopSlotGem.vue';
import BiIcon from './BiIcon.vue';
import LaunchAction from './LaunchAction.vue';
import OnlineCount from './OnlineCount.vue';
import ScoreCell from './ScoreCell.vue';
import ServerIcon from './ServerIcon.vue';
import TagChip from './TagChip.vue';
import TrendValue from './TrendValue.vue';

const { server, position, favorite, installed, source } = defineProps<{
  server: ServerRow;
  position?: number | null;
  favorite?: boolean;
  installed?: boolean;
  source?: PlaySource | undefined;
}>();

const CHIP_LIMIT = 2;
const CHIP_LIMIT_OWN_LAUNCHER = 1;

const tags = computed(() => {
  const access = accessChips(server.access);
  const unstable = unstableChip(server.unstable);
  const priority = unstable === null ? [] : [unstable];
  const baseLimit = server.launch.kind === 'own_launcher' ? CHIP_LIMIT_OWN_LAUNCHER : CHIP_LIMIT;
  const limit = baseLimit + priority.length;
  return [...access, ...priority, ...serverTags(server).map(tagView)].slice(0, limit);
});
</script>

<template>
  <li class="srow" :class="server.topSlot ? `is-top-slot is-${server.topSlot.tier}` : undefined">
    <span class="rank">
      <TopSlotGem v-if="server.topSlot" :tier="server.topSlot.tier" />
      <template v-else>{{ position }}</template>
    </span>
    <span class="icon-wrap">
      <ServerIcon :src="server.icon_url" size="row" />
      <span v-if="installed" class="installed-badge" :title="ru.server.installed">
        <BiIcon name="check-circle-fill" />
        <span class="lx-visually-hidden">{{ ru.server.installed }}</span>
      </span>
    </span>
    <div class="main">
      <div class="title">
        <RouterLink class="name" :to="`/server/${String(server.id)}`"
          ><span class="name-text selectable">{{ server.name }}</span></RouterLink
        >
        <span v-if="favorite" class="heart" :title="ru.server.favorite">
          <BiIcon name="heart-fill" />
          <span class="lx-visually-hidden">{{ ru.server.favorite }}</span>
        </span>
      </div>
      <div class="sub">
        <TagChip v-for="tag in tags" :key="tag.slug" :icon="tag.icon" small>
          {{ tag.label }}
        </TagChip>
        <TagChip v-if="server.launch.kind === 'own_launcher'" icon="box-arrow-up-right" small>
          {{ ru.server.ownLauncherTag }}
        </TagChip>
      </div>
    </div>
    <span class="version-cell">
      <TagChip v-if="server.versions" tone="version" :title="versionLabel(server.versions)">
        {{ compactVersionLabel(server.versions) }}
      </TagChip>
      <span v-else class="no-version" :title="ru.server.versionUnknown">
        <span aria-hidden="true">—</span>
        <span class="lx-visually-hidden">{{ ru.server.versionUnknown }}</span>
      </span>
    </span>
    <span class="online-cell">
      <span class="online-line">
        <OnlineCount :online="server.online" :status="server.status" />
        <TrendValue :value="server.weekly_trend" />
      </span>
    </span>
    <ScoreCell :energy="server.points" :votes="server.votes_month" />
    <LaunchAction
      class="action"
      :style="{ maxWidth: `${String(ACTION_COLUMN_PX)}px` }"
      :server="server"
      :source="source"
      compact
      narrow
    />
  </li>
</template>

<style scoped>
.srow {
  position: relative;
  display: grid;
  grid-template-columns: var(--lx-row-columns);
  align-items: center;
  gap: 14px;
  height: 68px;
  padding: 0 14px;
  border-radius: var(--mc-radius);
  border: 1px solid transparent;
  color: var(--mc-text);
}

.srow + .srow {
  margin-top: 2px;
}

.srow:hover {
  background: var(--mc-surface);
  border-color: var(--mc-border);
}

.srow:has(.name:focus-visible) {
  outline: 2px solid var(--mc-accent);
  outline-offset: 2px;
}

.srow.is-top-slot {
  overflow: hidden;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--tier) 8%, transparent),
    transparent 45%
  );
  border-color: color-mix(in srgb, var(--tier) 45%, transparent);
}

.srow.is-top-slot:hover {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--tier) 14%, transparent), transparent 45%),
    var(--mc-surface);
  border-color: color-mix(in srgb, var(--tier) 75%, transparent);
}

.srow.is-top-slot::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: var(--tier);
}

.is-diamond {
  --tier: var(--mc-diamond);
}

.is-gold {
  --tier: var(--mc-gold);
}

.rank {
  display: flex;
  justify-content: flex-end;
  font-size: 13px;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
}

.main {
  min-width: 0;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.name {
  font-weight: 600;
  font-size: 15px;
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.name:focus-visible {
  outline: none;
}

.name::after {
  content: '';
  position: absolute;
  inset: 0;
}

.name-text {
  position: relative;
  z-index: 1;
}

.heart {
  display: inline-flex;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  overflow: hidden;
  white-space: nowrap;
}

.sub > * {
  flex-shrink: 0;
}

.icon-wrap {
  position: relative;
  display: block;
  flex-shrink: 0;
}

.installed-badge {
  position: absolute;
  right: -5px;
  bottom: -5px;
  display: flex;
  width: 16px;
  height: 16px;
  font-size: 16px;
  line-height: 1;
  color: var(--mc-accent);
  background: var(--mc-bg);
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--mc-bg);
}

.srow:hover .installed-badge {
  background: var(--mc-surface);
  box-shadow: 0 0 0 2px var(--mc-surface);
}

.version-cell {
  min-width: 0;
}

.no-version {
  color: var(--lx-text-faint);
}

.online-cell {
  position: relative;
  display: flex;
  align-items: flex-start;
  flex-direction: column;
}

.online-line {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.action {
  position: relative;
  justify-self: end;
}
</style>
