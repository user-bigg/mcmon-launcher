<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { ServerRow } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { homeRowsRu } from '@shared/i18n/home-rows.ru';
import type { Scene } from '@shared/scenes';
import type { LayerSource } from '../lib/landscape';
import { addressLabel, versionLabel } from '../lib/minecraft';
import { duration, relativeDay } from '../lib/time';
import BiIcon from './BiIcon.vue';
import type { IconName } from './icons';
import PixelLandscape from './PixelLandscape.vue';
import LaunchAction from './LaunchAction.vue';
import OnlineCount from './OnlineCount.vue';
import PingValue from './PingValue.vue';
import ServerIcon from './ServerIcon.vue';

const { server, scene, sceneBase, ping, playedAt, durationSeconds, installed, quiet } =
  defineProps<{
    server: ServerRow;
    scene: Scene | undefined;
    sceneBase: LayerSource;
    ping: number | null;
    playedAt: string;
    durationSeconds: number;
    installed?: boolean;
    quiet?: boolean;
  }>();

interface StatusLine {
  icon: IconName;
  tone: 'ready' | 'muted';
  text: string;
  address?: string;
}

const titleId = computed(() => `continue-${String(server.id)}`);
const version = computed(() => versionLabel(server.versions));
const eyebrow = computed(() =>
  fill(homeRowsRu.continue.eyebrow, {
    when: relativeDay(playedAt),
    duration: duration(durationSeconds),
  }),
);

const address = computed(() => addressLabel(server.address));

const status = computed<StatusLine>(() => {
  if (server.status === 'offline') {
    return { icon: 'info-circle', tone: 'muted', text: homeRowsRu.continue.offline };
  }
  switch (server.launch.kind) {
    case 'direct':
      return installed
        ? {
            icon: 'check-circle-fill',
            tone: 'ready',
            text: fill(homeRowsRu.continue.ready, { version: server.launch.minecraft }),
          }
        : {
            icon: 'cloud-arrow-down',
            tone: 'muted',
            text: fill(homeRowsRu.continue.install, { version: server.launch.minecraft }),
          };
    case 'own_launcher':
      return { icon: 'box-arrow-up-right', tone: 'muted', text: homeRowsRu.continue.ownLauncher };
    case 'none':
      return {
        icon: 'info-circle',
        tone: 'muted',
        text: homeRowsRu.continue.address,
        address: address.value,
      };
  }
});
</script>

<template>
  <section class="hero" :aria-labelledby="titleId">
    <div class="frame" :class="{ 'has-scene': scene }">
      <div class="body">
        <p class="eyebrow"><BiIcon name="clock-history" />{{ eyebrow }}</p>
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
          <RouterLink class="link" :to="`/server/${String(server.id)}`">
            {{ homeRowsRu.continue.serverPage }}<BiIcon name="arrow-right" />
          </RouterLink>
        </div>
        <p class="status" :class="`is-${status.tone}`" :data-status="status.tone">
          <BiIcon :name="status.icon" />
          <span
            >{{ status.text
            }}<span v-if="status.address" class="lx-mono address selectable">{{
              status.address
            }}</span></span
          >
        </p>
      </div>
      <PixelLandscape
        v-if="scene"
        class="cover"
        :scene="scene"
        :base="sceneBase"
        :time="server.cover.time"
        :parallax="!quiet"
        :still="quiet"
      />
    </div>
  </section>
</template>

<style scoped>
.hero {
  container-type: inline-size;
}

.frame {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  min-height: 216px;
  padding: 8px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
}

.frame.has-scene {
  grid-template-columns: minmax(0, 1fr) clamp(220px, 40%, 820px);
}

.body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px 18px 14px;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.title {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
}

.title-text {
  min-width: 0;
}

h2 {
  margin: 0 0 5px;
  font-family: var(--mc-font-display);
  font-size: 24px;
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
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
  margin-top: auto;
  padding-top: 18px;
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

.status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--mc-text-muted);
  min-width: 0;
}

.status > span {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status.is-ready .bi {
  color: var(--mc-accent);
}

.address {
  color: var(--mc-text);
}

.cover {
  border: 1px solid color-mix(in srgb, var(--mc-text) 7%, transparent);
  border-radius: calc(var(--mc-radius-lg) - 8px);
}

@container (max-width: 720px) {
  .frame.has-scene {
    grid-template-columns: minmax(0, 1fr) 30%;
  }

  .body {
    padding-inline: 16px;
  }
}
</style>
