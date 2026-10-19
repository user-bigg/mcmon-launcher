<script setup lang="ts">
import ContinueHero from '../components/ContinueHero.vue';
import TopSlotRow from '../components/TopSlotRow.vue';
import { demoScene, heroDemos, topSlotDemos } from '../mock/home-rows-demo';

const skyOnly = (): string => '';

const part = new URLSearchParams(location.search).get('part') ?? 'all';
const showHero = part === 'all' || part === 'hero';
const showTopSlot = part === 'all' || part === 'top-slot';
</script>

<template>
  <div class="demo">
    <aside class="side" aria-hidden="true" />
    <main class="lx-main">
      <div class="lx-content">
        <template v-if="showHero">
          <div v-for="item in heroDemos" :key="item.caption" class="case">
            <p class="caption lx-mono">{{ item.caption }}</p>
            <ContinueHero
              :server="item.server"
              :scene="demoScene(item.server.cover.scene)"
              :scene-base="skyOnly"
              :ping="item.ping"
              :installed="item.installed"
              :played-at="item.playedAt"
              :duration-seconds="item.durationSeconds"
            />
          </div>
        </template>
        <template v-if="showTopSlot">
          <div v-for="item in topSlotDemos" :key="item.caption" class="case">
            <p class="caption lx-mono">{{ item.caption }}</p>
            <TopSlotRow
              :server="item.server"
              :scene="demoScene(item.server.cover.scene)"
              :scene-base="skyOnly"
            />
          </div>
        </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
.demo {
  grid-row: 1 / -1;
  display: grid;
  grid-template-columns: var(--lx-side-w) minmax(0, 1fr);
  height: 100%;
  background: var(--mc-bg);
}

.side {
  border-right: 1px solid var(--mc-border);
  background: var(--mc-bg);
}

.case + .case {
  margin-top: 18px;
}

.caption {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--lx-text-faint);
}
</style>
