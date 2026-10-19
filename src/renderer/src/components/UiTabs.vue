<script setup lang="ts" generic="T extends string">
import { useTemplateRef } from 'vue';

export interface TabOption<V extends string> {
  value: V;
  label: string;
  count?: number;
}

const { tabs, label, panel } = defineProps<{
  tabs: TabOption<T>[];
  label: string;
  panel?: string;
}>();
const selected = defineModel<T>({ required: true });
const list = useTemplateRef<HTMLElement>('list');

const moves: Record<string, (index: number, length: number) => number> = {
  ArrowRight: (index, length) => (index + 1) % length,
  ArrowLeft: (index, length) => (index - 1 + length) % length,
  Home: () => 0,
  End: (_, length) => length - 1,
};

function onKey(event: KeyboardEvent): void {
  const move = moves[event.key];
  if (move === undefined || tabs.length === 0) {
    return;
  }
  event.preventDefault();
  const current = tabs.findIndex((tab) => tab.value === selected.value);
  const next = tabs[move(Math.max(current, 0), tabs.length)];
  if (next === undefined) {
    return;
  }
  selected.value = next.value;
  list.value?.querySelector<HTMLElement>(`[data-tab="${next.value}"]`)?.focus();
}
</script>

<template>
  <div ref="list" class="tabs" role="tablist" :aria-label="label" @keydown="onKey">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      :data-tab="tab.value"
      :class="{ 'is-active': selected === tab.value }"
      :aria-selected="selected === tab.value"
      :aria-controls="panel"
      :tabindex="selected === tab.value ? 0 : -1"
      @click="selected = tab.value"
    >
      {{ tab.label }}<span v-if="tab.count !== undefined" class="count">{{ tab.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--mc-border);
}

.tabs button {
  margin-bottom: -1px;
  padding: 9px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--mc-text-muted);
  font-size: 14px;
  font-weight: 400;
}

.tabs button:hover {
  color: var(--mc-text);
}

.tabs button.is-active {
  color: var(--mc-text);
  font-weight: 600;
  border-bottom-color: var(--mc-accent);
}

.count {
  margin-left: 4px;
  font-size: 11px;
  font-weight: 400;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
}
</style>
