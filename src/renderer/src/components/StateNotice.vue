<script setup lang="ts">
import BiIcon from './BiIcon.vue';
import type { IconName } from './icons';

type Tone = 'neutral' | 'danger';

const {
  icon,
  title,
  text,
  tone = 'neutral',
  live = 'status',
} = defineProps<{
  icon: IconName;
  title: string;
  text?: string | undefined;
  tone?: Tone | undefined;
  live?: 'status' | 'alert' | undefined;
}>();
</script>

<template>
  <section class="state-notice" :class="`is-${tone}`" :role="live" :data-state-tone="tone">
    <BiIcon class="icon" :name="icon" />
    <div class="body">
      <h2 class="title">{{ title }}</h2>
      <p v-if="text" class="text">{{ text }}</p>
      <div v-if="$slots.default" class="actions"><slot /></div>
    </div>
  </section>
</template>

<style scoped>
.state-notice {
  display: flex;
  gap: 14px;
  padding: 20px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.icon {
  margin-top: 1px;
  font-size: 20px;
  color: var(--mc-text-muted);
}

.is-danger .icon {
  color: var(--mc-danger);
}

.body {
  min-width: 0;
}

.title {
  margin: 0;
  font-family: var(--mc-font-body);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.35;
}

.text {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--mc-text-muted);
  text-wrap: pretty;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
</style>
