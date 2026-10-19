<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { ServerRow } from '@shared/catalog';
import type { PlaySource } from '@shared/telemetry';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { versionLabel } from '../lib/minecraft';
import { serverTags, tagLabel } from '../lib/tags';
import LaunchAction from './LaunchAction.vue';
import OnlineCount from './OnlineCount.vue';
import ScoreCell from './ScoreCell.vue';
import ServerIcon from './ServerIcon.vue';
import TagChip from './TagChip.vue';

const { server, voteAvailable, fact, source } = defineProps<{
  server: ServerRow;
  voteAvailable?: boolean;
  fact?: string | null;
  source?: PlaySource | undefined;
}>();

const scored = computed(() => server.points + server.votes_month > 0);
const tagline = computed(() =>
  server.wipe_label === null || fact !== undefined
    ? server.description
    : fill(ru.server.descriptionWipe, { description: server.description, wipe: server.wipe_label }),
);
const firstTag = computed(() => {
  const [slug] = serverTags(server);
  return slug === undefined ? null : tagLabel(slug);
});
</script>

<template>
  <article class="card">
    <div class="top">
      <ServerIcon :src="server.icon_url" size="sm" />
      <div class="title">
        <h3>
          <RouterLink class="stretched" :to="`/server/${String(server.id)}`"
            ><span class="name-text selectable">{{ server.name }}</span></RouterLink
          >
        </h3>
        <p class="tagline" :class="{ 'is-full': !fact }">{{ tagline }}</p>
        <p v-if="fact" class="fact" data-fact>{{ fact }}</p>
      </div>
    </div>
    <div class="tags">
      <div class="tag-list">
        <TagChip v-if="server.versions" tone="version">{{ versionLabel(server.versions) }}</TagChip>
        <span v-else class="no-version" :title="ru.server.versionUnknown">
          <span aria-hidden="true">—</span>
          <span class="lx-visually-hidden">{{ ru.server.versionUnknown }}</span>
        </span>
        <TagChip
          v-if="voteAvailable"
          class="mark"
          tone="gold"
          icon="hand-thumbs-up"
          :title="ru.server.voteAvailable"
        >
          <span class="mark-text">{{ ru.server.voteAvailable }}</span>
        </TagChip>
        <TagChip
          v-else-if="server.unstable"
          class="mark"
          icon="exclamation-triangle"
          :title="ru.server.unstableTag"
        >
          <span class="mark-text">{{ ru.server.unstableTag }}</span>
        </TagChip>
        <TagChip v-else-if="firstTag !== null">{{ firstTag }}</TagChip>
      </div>
      <ScoreCell v-if="scored" class="score" :energy="server.points" :votes="server.votes_month" />
    </div>
    <div class="foot">
      <div class="foot-meta">
        <OnlineCount :online="server.online" :status="server.status" worded />
      </div>
      <LaunchAction class="action" :server="server" :source="source" compact />
    </div>
  </article>
</template>

<style scoped>
.card {
  container-type: inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  color: var(--mc-text);
}

.card:hover {
  border-color: var(--mc-border-strong);
  background: var(--mc-surface-2);
}

.top {
  display: flex;
  gap: 12px;
  align-items: center;
}

.title {
  min-width: 0;
}

h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0;
}

.stretched {
  color: inherit;
  text-decoration: none;
}

.stretched::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.name-text {
  position: relative;
  z-index: 1;
}

.fact {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: calc(13px * 1.35);
  color: var(--mc-text);
}

.tagline {
  display: -webkit-box;
  margin: 3px 0 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.35;
  color: var(--mc-text-muted);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.tagline:not(.is-full) {
  -webkit-line-clamp: 1;
  line-clamp: 1;
}

.tagline.is-full {
  min-height: calc(2 * 1.35em);
}

.tags {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px 8px;
  min-width: 0;
  height: 24px;
  overflow: hidden;
}

.tag-list > * {
  flex-shrink: 0;
  max-height: 24px;
}

.score {
  flex-shrink: 0;
}

@container (max-width: 340px) {
  .mark-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

.no-version {
  color: var(--lx-text-faint);
}

.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
}

.foot-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}

.action {
  position: relative;
  flex-shrink: 0;
  margin-left: auto;
}
</style>
