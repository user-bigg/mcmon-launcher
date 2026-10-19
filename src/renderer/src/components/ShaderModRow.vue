<script setup lang="ts">
import { computed } from 'vue';
import { ru } from '@shared/i18n/ru';
import type { ShaderChoice } from '@shared/mods';
import type { ShaderPick, ShaderRow } from '../lib/mods';
import { formatModSize } from '../lib/units';
import UiSegmented from './UiSegmented.vue';
import UiToggle from './UiToggle.vue';

const { row } = defineProps<{ row: ShaderRow }>();
const emit = defineEmits<{ choose: [choice: ShaderChoice] }>();

const size = computed(() => (row.size === null ? null : formatModSize(row.size)));
const picked = computed<ShaderPick>({
  get: () => row.choice,
  set: (choice) => {
    emit('choose', choice);
  },
});

function toggle(on: boolean): void {
  emit('choose', on ? row.choice : 'off');
}
</script>

<template>
  <div class="lx-row shader-row" data-mod="shaders">
    <div class="lx-row-text">
      <div class="lx-row-title">{{ ru.mods.shaders }}</div>
      <div class="lx-row-desc">{{ ru.mods.shadersSummary }}</div>
      <div v-if="row.on" class="pick">
        <UiSegmented
          v-model="picked"
          class="seg"
          :options="row.options"
          :label="ru.mods.shadersChoice"
        />
        <span class="credit" data-shader-credit>{{ row.credit }}</span>
      </div>
    </div>
    <span v-if="size !== null" class="size lx-num">{{ size }}</span>
    <UiToggle
      :model-value="row.on"
      :label="ru.mods.shaders"
      :disabled="!row.available && !row.on"
      @update:model-value="toggle"
    />
  </div>
</template>

<style scoped>
.shader-row {
  padding: 12px 16px;
}

.pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-top: 10px;
}

.seg :deep(button) {
  min-width: 96px;
  justify-content: center;
  padding: 5px 14px;
}

.credit {
  font-size: 12px;
  color: var(--lx-text-faint);
}

.size {
  min-width: 56px;
  font-size: 12px;
  text-align: right;
  color: var(--lx-text-faint);
  white-space: nowrap;
}
</style>
