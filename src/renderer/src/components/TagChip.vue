<script setup lang="ts">
import BiIcon from './BiIcon.vue';
import type { IconName } from './icons';

type Tone = 'neutral' | 'accent' | 'violet' | 'gold' | 'version';

const {
  tone = 'neutral',
  icon,
  small,
} = defineProps<{ tone?: Tone; icon?: IconName | undefined; small?: boolean }>();
</script>

<template>
  <span class="tag" :class="[`is-${tone}`, { 'is-small': small }]">
    <BiIcon v-if="icon" :name="icon" />
    <slot />
  </span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 400;
  background: var(--mc-surface-3);
  color: var(--mc-text-muted);
  border: 1px solid var(--mc-border);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tag.is-small {
  height: 20px;
  padding: 0 7px;
  font-size: 11px;
}

.is-accent {
  background: var(--mc-accent-soft);
  color: var(--mc-accent);
  border-color: transparent;
}

.is-violet {
  background: var(--mc-violet-soft);
  color: var(--mc-violet);
  border-color: transparent;
}

.is-gold {
  background: var(--mc-gold-soft);
  color: var(--mc-gold);
  border-color: transparent;
}

.is-version {
  padding: 0 7px;
  border-radius: var(--mc-radius-sm);
  font-size: 12px;
  color: var(--mc-text);
}
</style>
