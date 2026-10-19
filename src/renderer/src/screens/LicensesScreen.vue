<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ru } from '@shared/i18n/ru';
import UiButton from '../components/UiButton.vue';

const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

const text = ref<string | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    const response = await fetch(new URL(NOTICES_FILE, document.baseURI));
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('text/plain')) {
      throw new Error(String(response.status));
    }
    text.value = await response.text();
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <div class="lx-content">
    <UiButton size="sm" icon="arrow-left" to="/settings">{{ ru.licenses.back }}</UiButton>
    <h1 class="lx-h1 title">{{ ru.licenses.title }}</h1>
    <p class="lx-sub">{{ ru.licenses.subtitle }}</p>
    <p v-if="failed" class="lx-state" role="status">{{ ru.licenses.error }}</p>
    <p v-else-if="text === null" class="lx-state" role="status">{{ ru.state.loading }}</p>
    <pre v-else class="notices selectable">{{ text }}</pre>
  </div>
</template>

<style scoped>
.title {
  margin-top: 16px;
}

.notices {
  margin: 20px 0 0;
  padding: 16px;
  max-width: 100%;
  overflow-x: auto;
  white-space: pre-wrap;
  font-family: var(--mc-font-body);
  font-size: 12px;
  line-height: 1.5;
  color: var(--mc-text-muted);
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}
</style>
