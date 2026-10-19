<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { ru } from '@shared/i18n/ru';
import BiIcon from './BiIcon.vue';

const { text, label } = defineProps<{ text: string; label: string }>();
const emit = defineEmits<{ copied: [] }>();

const COPIED_MS = 1600;
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  emit('copied');
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    copied.value = false;
  }, COPIED_MS);
}

onBeforeUnmount(() => {
  clearTimeout(timer);
});
</script>

<template>
  <button
    type="button"
    class="copy"
    :class="{ 'is-copied': copied }"
    :aria-label="label"
    :title="copied ? undefined : label"
    @click="copy()"
  >
    <BiIcon :name="copied ? 'check-lg' : 'copy'" />
    <span class="lx-visually-hidden" role="status">{{ copied ? ru.common.copied : '' }}</span>
  </button>
</template>

<style scoped>
.copy {
  position: relative;
  display: inline-grid;
  flex-shrink: 0;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: calc(var(--mc-radius-sm) - 2px);
  background: transparent;
  color: var(--mc-text-muted);
}

.copy:hover {
  background: var(--mc-surface-3);
  color: var(--mc-text);
}

.copy.is-copied {
  background: var(--mc-accent-soft);
  color: var(--mc-accent);
}
</style>
