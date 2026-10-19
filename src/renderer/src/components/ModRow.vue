<script setup lang="ts">
import { computed } from 'vue';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { CatalogModView } from '@shared/mods';
import { formatModSize } from '../lib/units';
import BiIcon from './BiIcon.vue';
import UiToggle from './UiToggle.vue';

const { mod, minecraft } = defineProps<{ mod: CatalogModView; minecraft: string | null }>();
const emit = defineEmits<{ toggle: [on: boolean] }>();

const size = computed(() => {
  const bytes = mod.totalSize ?? mod.size;
  return bytes === null || !mod.available ? null : formatModSize(bytes);
});
const unavailable = computed(() =>
  mod.available || minecraft === null ? null : fill(ru.mods.unavailable, { minecraft }),
);
</script>

<template>
  <div class="lx-row mod-row" :data-mod="mod.slug">
    <div class="lx-row-text">
      <div class="lx-row-title">{{ mod.title }}</div>
      <div class="lx-row-desc">{{ mod.summary }}</div>
      <div v-if="mod.credit !== null" class="rule">{{ mod.credit }}</div>
      <div v-if="unavailable !== null" class="rule" data-mod-unavailable>
        <BiIcon name="info-circle" />{{ unavailable }}
      </div>
      <div v-if="mod.server" class="rule" data-mod-server>
        <BiIcon name="check2" />{{ ru.mods.serverAsks }}
      </div>
      <div v-if="mod.often_forbidden" class="rule" data-mod-often-forbidden>
        <BiIcon name="info-circle" />{{ ru.mods.oftenForbidden }}
      </div>
    </div>
    <span v-if="size !== null" class="size lx-num">{{ size }}</span>
    <UiToggle
      :model-value="mod.enabled"
      :label="mod.title"
      :disabled="!mod.available && !mod.enabled"
      @update:model-value="emit('toggle', $event)"
    />
  </div>
</template>

<style scoped>
.mod-row {
  padding: 12px 16px;
}

.rule {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.size {
  min-width: 56px;
  font-size: 12px;
  text-align: right;
  color: var(--lx-text-faint);
  white-space: nowrap;
}
</style>
