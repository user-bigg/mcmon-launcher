<script setup lang="ts">
import { computed } from 'vue';
import { ru } from '@shared/i18n/ru';
import type { ModsAnswer } from '@shared/launch';
import BiIcon from './BiIcon.vue';
import UiButton from './UiButton.vue';

const { kind, refused, waiting } = defineProps<{
  kind: 'required' | 'optional';
  refused: boolean;
  waiting: number;
}>();
const emit = defineEmits<{ retry: []; cancel: []; answer: [answer: ModsAnswer] }>();

const text = computed(() => {
  if (kind === 'required') {
    return ru.mods.failedRequired;
  }
  return waiting > 0 ? ru.mods.failedOptionalAsk : ru.mods.failedOptional;
});
</script>

<template>
  <div class="problem" :role="kind === 'required' ? 'alert' : 'status'" :data-mod-problem="kind">
    <p>
      <BiIcon v-if="kind === 'required'" name="lock-fill" />
      {{ text }}
    </p>
    <div v-if="refused" class="buttons">
      <UiButton size="sm" variant="primary" icon="arrow-clockwise" @click="emit('retry')">
        {{ ru.mods.retry }}
      </UiButton>
      <UiButton size="sm" @click="emit('cancel')">{{ ru.mods.cancel }}</UiButton>
    </div>
    <div v-else-if="waiting > 0" class="buttons" data-mod-choice>
      <UiButton size="sm" variant="play" icon="play-fill" @click="emit('answer', 'without')">
        {{ waiting > 1 ? ru.mods.playWithoutMany : ru.mods.playWithout }}
      </UiButton>
      <UiButton size="sm" icon="arrow-clockwise" @click="emit('answer', 'retry')">
        {{ ru.mods.retry }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.problem {
  max-width: 420px;
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border-strong);
  background: var(--mc-surface-2);
}

.problem p {
  margin: 0;
  font-size: 13px;
  color: var(--mc-text-muted);
  text-wrap: pretty;
}

.problem p .bi {
  margin-right: 2px;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
</style>
