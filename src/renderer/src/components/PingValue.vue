<script setup lang="ts">
import { ru } from '@shared/i18n/ru';
import BiIcon from './BiIcon.vue';
import PingBadge from './PingBadge.vue';

const { ms } = defineProps<{ ms: number | null }>();
</script>

<template>
  <PingBadge v-if="ms !== null && ms > 0" :ms="ms" />
  <span v-else class="ping is-none" :title="ru.server.pingUnknownLabel" data-ping="none">
    <BiIcon name="dash-lg" />
    <span aria-hidden="true">{{ ru.server.pingUnknown }}</span>
    <span class="lx-visually-hidden">{{ ru.server.pingUnknownLabel }}</span>
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
}

.ping .bi {
  font-size: 14px;
  color: var(--lx-text-faint);
}
</style>
