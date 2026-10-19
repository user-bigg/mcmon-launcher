<script setup lang="ts" generic="T extends string">
import BiIcon from './BiIcon.vue';

export interface SelectOption<V extends string> {
  value: V;
  label: string;
}

const {
  options,
  label,
  width = 170,
} = defineProps<{
  options: readonly SelectOption<T>[];
  label: string;
  width?: number;
}>();
const selected = defineModel<T>({ required: true });
</script>

<template>
  <span class="select" :style="{ minWidth: `${String(width)}px` }">
    <select v-model="selected" :aria-label="label">
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <BiIcon name="chevron-down" />
  </span>
</template>

<style scoped>
.select {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  height: 32px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-2);
  border: 1px solid var(--mc-border);
}

.select:has(select:focus-visible) {
  outline: 2px solid var(--mc-accent);
  outline-offset: 2px;
}

select {
  width: 100%;
  height: 100%;
  padding: 0 30px 0 12px;
  border: 0;
  outline: 0;
  appearance: none;
  background: transparent;
  font-size: 13px;
  color: var(--mc-text);
}

option {
  background: var(--mc-surface-2);
}

.bi {
  position: absolute;
  right: 10px;
  font-size: 11px;
  color: var(--mc-text-muted);
  pointer-events: none;
}
</style>
