<script setup lang="ts">
import { computed } from 'vue';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { moscowTime } from '../lib/time';
import BiIcon from './BiIcon.vue';

const { at } = defineProps<{ at: string }>();
const emit = defineEmits<{ retry: [] }>();

const text = computed(() => fill(ru.state.stale, { time: moscowTime(at) }));
</script>

<template>
  <div class="stale-note" role="status">
    <BiIcon name="wifi-off" />
    <span class="text">{{ text }}</span>
    <button type="button" class="retry" @click="emit('retry')">{{ ru.state.retry }}</button>
  </div>
</template>

<style scoped>
.stale-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  height: 26px;
  margin: 0;
  padding: 0 0 0 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mc-warning) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--mc-warning) 25%, transparent);
  font-size: 13px;
  color: var(--mc-text);
}

.stale-note > .bi {
  font-size: 14px;
  color: var(--mc-warning);
}

.text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.retry {
  flex-shrink: 0;
  height: 24px;
  min-width: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--mc-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.retry:hover {
  background: color-mix(in srgb, var(--mc-warning) 14%, transparent);
  color: var(--mc-text);
}
</style>
