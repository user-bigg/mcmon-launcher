<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { TopSlotTier, ServerRow } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { homeRowsRu } from '@shared/i18n/home-rows.ru';
import type { Scene } from '@shared/scenes';
import type { LayerSource } from '../lib/landscape';
import { versionLabel } from '../lib/minecraft';
import { serverTags, tagLabel } from '../lib/tags';
import TopSlotGem from './TopSlotGem.vue';
import PixelLandscape from './PixelLandscape.vue';
import LaunchAction from './LaunchAction.vue';
import OnlineCount from './OnlineCount.vue';
import ServerIcon from './ServerIcon.vue';

const { server, scene, sceneBase, quiet } = defineProps<{
  server: ServerRow;
  scene: Scene | undefined;
  sceneBase: LayerSource;
  quiet?: boolean;
}>();

const tier = computed<TopSlotTier | null>(() => server.topSlot?.tier ?? null);
const titleId = computed(() => `top-slot-${String(server.id)}`);
const page = computed(() => `/server/${String(server.id)}`);
const modes = computed(() => serverTags(server).map(tagLabel).join(' · '));
</script>

<template>
  <section class="top-slot" :aria-labelledby="titleId" :data-tier="tier ?? undefined">
    <div class="frame" :class="[tier === null ? '' : `is-${tier}`, { 'has-scene': scene }]">
      <ServerIcon class="icon" :src="server.icon_url" size="md" />
      <div class="text">
        <div class="name-row">
          <TopSlotGem v-if="tier !== null" :tier="tier" />
          <h3 :id="titleId" :title="server.name">
            <RouterLink class="name selectable" :to="page">{{ server.name }}</RouterLink>
          </h3>
          <span class="version lx-num">{{ versionLabel(server.versions) }}</span>
        </div>
        <p class="desc" :title="server.description">{{ server.description }}</p>
        <div class="meta">
          <OnlineCount :online="server.online" :status="server.status" size="sm" />
          <template v-if="modes">
            <span class="sep" aria-hidden="true" />
            <span class="modes">{{ modes }}</span>
          </template>
        </div>
      </div>
      <div class="actions">
        <RouterLink
          class="link"
          :to="page"
          :aria-label="fill(homeRowsRu.topSlot.moreAbout, { name: server.name })"
        >
          {{ homeRowsRu.topSlot.more }}
        </RouterLink>
        <LaunchAction :server="server" source="top_slot" compact />
      </div>
      <PixelLandscape
        v-if="scene"
        class="cover"
        :scene="scene"
        :base="sceneBase"
        :time="server.cover.time"
        :parallax="false"
        :still="quiet"
      />
    </div>
  </section>
</template>

<style scoped>
.top-slot {
  container-type: inline-size;
}

.frame {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 104px;
  padding: 6px 18px 6px 21px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.is-diamond,
.is-gold {
  box-shadow: inset 3px 0 0 var(--tier);
}

.frame.has-scene {
  grid-template-columns: auto minmax(0, 1fr) auto clamp(120px, 22%, 320px);
  padding-right: 6px;
}

.is-diamond {
  --tier: var(--mc-diamond);
}

.is-gold {
  --tier: var(--mc-gold);
}

.text {
  min-width: 0;
  padding: 10px 0;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

h3 {
  min-width: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.version {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--mc-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 7px;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.modes {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sep {
  width: 3px;
  height: 3px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--mc-text-muted);
}

.actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.link {
  font-size: 14px;
  font-weight: 600;
  color: var(--mc-text-muted);
  text-decoration: none;
  white-space: nowrap;
}

.link:hover,
.name:hover {
  color: var(--mc-text);
}

.name {
  color: inherit;
  text-decoration: none;
}

.cover {
  align-self: stretch;
  border: 1px solid color-mix(in srgb, var(--mc-text) 7%, transparent);
  border-radius: calc(var(--mc-radius) - 6px);
}

@container (max-width: 720px) {
  .frame.has-scene {
    grid-template-columns: auto minmax(0, 1fr) auto 112px;
    gap: 14px;
  }

  .link {
    display: none;
  }
}
</style>
