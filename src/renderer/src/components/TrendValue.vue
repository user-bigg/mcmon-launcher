<script setup lang="ts">
import { computed } from 'vue';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';

const { value } = defineProps<{ value: number | null }>();

const FLAT_PERCENT = 1;

const percent = computed(() => value ?? 0);
const shown = computed(() => Math.abs(percent.value) >= FLAT_PERCENT);
const up = computed(() => percent.value > 0);
const text = computed(() =>
  fill(up.value ? ru.server.trendUp : ru.server.trendDown, { value: Math.abs(percent.value) }),
);
const label = computed(() =>
  fill(up.value ? ru.server.trendLabelUp : ru.server.trendLabelDown, {
    value: Math.abs(percent.value),
  }),
);
</script>

<template>
  <span v-if="shown" class="trend" :class="up ? 'is-up' : 'is-down'" :title="label">
    <span aria-hidden="true">{{ text }}</span>
    <span class="lx-visually-hidden">{{ label }}</span>
  </span>
</template>

<style scoped>
.trend {
  font-size: 11px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.is-up {
  color: var(--mc-accent);
}

.is-down {
  color: var(--mc-text-muted);
}
</style>
