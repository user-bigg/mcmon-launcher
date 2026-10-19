<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { ServerRow } from '@shared/catalog';
import { ru } from '@shared/i18n/ru';
import type { Scene } from '@shared/scenes';
import { COVER_ROWS, type LayerSource } from '../lib/landscape';
import { versionLabel } from '../lib/minecraft';
import BiIcon from './BiIcon.vue';
import LaunchAction from './LaunchAction.vue';
import OnlineCount from './OnlineCount.vue';
import PingValue from './PingValue.vue';
import PixelLandscape from './PixelLandscape.vue';
import ServerIcon from './ServerIcon.vue';

const { server, scene, sceneBase, ping, installed } = defineProps<{
  server: ServerRow;
  scene: Scene | undefined;
  sceneBase: LayerSource;
  ping: number | null;
  installed?: boolean;
}>();

const titleId = computed(() => `top-${String(server.id)}`);
const version = computed(() => versionLabel(server.versions));
const page = computed(() => `/server/${String(server.id)}`);
</script>

<template>
  <section class="top-hero" :class="{ 'has-cover': scene }" :aria-labelledby="titleId">
    <PixelLandscape
      v-if="scene"
      class="cover"
      :scene="scene"
      :base="sceneBase"
      :time="server.cover.time"
      :height="COVER_ROWS"
    />
    <div class="plate">
      <div class="eyebrow-row">
        <p class="eyebrow"><BiIcon name="activity" />{{ ru.home.topEyebrow }}</p>
        <RouterLink class="link" :to="page">
          {{ ru.home.serverPage }}<BiIcon name="arrow-right" />
        </RouterLink>
      </div>
      <div class="main">
        <div class="title">
          <ServerIcon :src="server.icon_url" size="md" />
          <div class="title-text">
            <h2 :id="titleId" class="selectable" :title="server.name">{{ server.name }}</h2>
            <div class="meta">
              <OnlineCount :online="server.online" :status="server.status" />
              <span class="sep" aria-hidden="true" />
              <span class="lx-num">{{ version }}</span>
              <span class="sep" aria-hidden="true" />
              <PingValue :ms="ping" />
            </div>
          </div>
        </div>
        <div class="actions">
          <LaunchAction
            :server="server"
            :size="server.launch.kind === 'direct' ? 'lg' : 'md'"
            solid
            source="home_hero"
            :needs-install="!installed"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.top-hero {
  container-type: inline-size;
  overflow: hidden;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
}

.plate {
  padding: 14px 20px 18px;
}

.has-cover .plate {
  border-top: 1px solid var(--mc-border);
}

.eyebrow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 13px;
  color: var(--mc-text-muted);
  white-space: nowrap;
}

.main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-top: 10px;
}

.title {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.title-text {
  min-width: 0;
}

h2 {
  margin: 0 0 5px;
  font-family: var(--mc-font-display);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  font-size: 13px;
  color: var(--mc-text);
}

.sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--mc-text-muted);
}

.actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px 18px;
}

.link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--mc-text-muted);
  text-decoration: none;
  white-space: nowrap;
}

.link:hover {
  color: var(--mc-text);
}

.link .bi {
  font-size: 13px;
}

@container (max-width: 640px) {
  .main {
    flex-wrap: wrap;
  }
}
</style>
