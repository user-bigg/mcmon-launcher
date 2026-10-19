<script setup lang="ts">
import { computed } from 'vue';
import { fill, scoreCount } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';

const {
  energy,
  votes,
  size = 'row',
} = defineProps<{
  energy: number | null;
  votes: number | null;
  size?: 'row' | 'tile';
}>();

function part(value: number | null): { text: string; share: number } {
  return value === null
    ? { text: ru.owner.empty, share: 0 }
    : { text: scoreCount(Math.max(0, value)), share: Math.max(0, value) };
}

const parts = computed(() => ({ energy: part(energy), votes: part(votes) }));
const label = computed(() =>
  fill(ru.server.splitLabel, { energy: parts.value.energy.text, votes: parts.value.votes.text }),
);
</script>

<template>
  <span class="split" :class="`is-${size}`" data-split>
    <span class="lx-visually-hidden">{{ label }}</span>
    <span class="split-nums" aria-hidden="true">
      <span :class="parts.energy.share > 0 ? 'is-energy' : 'is-none'" data-split-energy>{{
        parts.energy.text
      }}</span>
      <span :class="parts.votes.share > 0 ? 'is-votes' : 'is-none'" data-split-votes>{{
        parts.votes.text
      }}</span>
    </span>
    <span class="split-bar" aria-hidden="true">
      <span
        v-if="parts.energy.share > 0"
        class="split-part is-energy"
        :style="{ flexGrow: parts.energy.share }"
      />
      <span
        v-if="parts.votes.share > 0"
        class="split-part is-votes"
        :style="{ flexGrow: parts.votes.share }"
      />
    </span>
  </span>
</template>

<style scoped>
.split {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.split-nums {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.is-tile > .split-nums {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.split-nums > .is-energy {
  color: var(--mc-gold);
}

.split-nums > .is-votes {
  color: var(--mc-votes);
}

.split-nums > .is-none {
  font-weight: 400;
  color: var(--mc-text-dim);
}

.split-bar {
  display: flex;
  gap: 2px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--mc-surface-3);
}

.split-part {
  flex-basis: 0;
  min-width: 4px;
}

.split-part.is-energy {
  background: var(--mc-gold);
}

.split-part.is-votes {
  background: var(--mc-votes);
}
</style>
