<script setup lang="ts">
import { computed } from 'vue';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { pingLevel } from '../lib/ping';
import { formatPing } from '../lib/units';
import BiIcon from './BiIcon.vue';

const { ms } = defineProps<{ ms: number | null }>();

const level = computed(() => pingLevel(ms));
const text = computed(() => (ms === null ? ru.server.pingUnknown : formatPing(ms)));
const label = computed(() =>
  ms === null
    ? ru.server.pingUnknownLabel
    : fill(ru.server.pingLabel, { value: formatPing(ms), level: level.value.word }),
);
</script>

<template>
  <span class="ping" :class="`is-${level.tone}`" :title="label">
    <BiIcon :name="level.bars" />
    <span aria-hidden="true">{{ text }}</span>
    <span class="lx-visually-hidden">{{ label }}</span>
  </span>
</template>

<style scoped>
.ping {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--mc-text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ping .bi {
  font-size: 14px;
}

.is-good .bi {
  color: var(--mc-accent);
}

.is-mid .bi {
  color: var(--mc-warning);
}

.is-bad .bi {
  color: var(--mc-danger);
}

.is-none .bi {
  color: var(--lx-text-faint);
}
</style>
