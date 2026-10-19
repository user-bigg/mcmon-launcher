<script setup lang="ts">
import { computed } from 'vue';
import type { ServerStatus } from '@shared/catalog';
import { countOf, fill, formatNumber, plural } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';

const {
  online,
  status = 'online',
  size = 'md',
  worded,
} = defineProps<{
  online: number;
  status?: ServerStatus;
  size?: 'sm' | 'md';
  worded?: boolean;
}>();

const label = computed(() =>
  fill(ru.server.onlineShort, { count: countOf(online, ru.plural.players) }),
);
</script>

<template>
  <span v-if="status === 'offline'" class="online is-off" :class="`is-${size}`">
    <span class="dot" aria-hidden="true" />{{ ru.server.offline }}
  </span>
  <span v-else-if="worded && online === 0" class="online is-empty" :class="`is-${size}`">
    <span class="dot" aria-hidden="true" />{{ ru.server.nobody }}
  </span>
  <span v-else class="online" :class="`is-${size}`" :title="worded ? undefined : label">
    <span class="dot" aria-hidden="true" />
    <span aria-hidden="true">{{ formatNumber(online) }}</span>
    <span v-if="worded" class="word" aria-hidden="true">{{
      plural(online, ru.server.playing)
    }}</span>
    <span class="lx-visually-hidden">{{ label }}</span>
  </span>
</template>

<style scoped>
.online {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.online.is-sm {
  gap: 5px;
  font-size: 11px;
  color: var(--lx-text-faint);
}

.dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--mc-accent);
  box-shadow: 0 0 0 3px var(--mc-accent-soft);
}

.is-sm .dot {
  width: 6px;
  height: 6px;
  box-shadow: none;
}

.is-off .dot {
  background: var(--mc-danger);
  box-shadow: 0 0 0 3px var(--lx-danger-soft);
}
.word {
  margin-left: -2px;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.is-empty {
  color: var(--mc-text-muted);
}
</style>
