<script setup lang="ts" generic="T extends string">
import BiIcon from './BiIcon.vue';
import type { IconName } from './icons';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: IconName;
}

const { options, label } = defineProps<{ options: SegmentOption<T>[]; label: string }>();
const selected = defineModel<T>({ required: true });
</script>

<template>
  <div class="seg" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="{ 'is-on': selected === option.value }"
      :aria-pressed="selected === option.value"
      @click="selected = option.value"
    >
      <BiIcon v-if="option.icon" :name="option.icon" />
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 3px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
}

.seg button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 0;
  border-radius: calc(var(--mc-radius-sm) - 2px);
  background: transparent;
  color: var(--mc-text-muted);
  font-size: 13px;
  font-weight: 400;
  white-space: nowrap;
}

.seg button:hover {
  color: var(--mc-text);
}

.seg button.is-on {
  background: var(--mc-surface-3);
  color: var(--mc-text);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--mc-bg) 60%, transparent);
}
</style>
