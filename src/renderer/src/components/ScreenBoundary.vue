<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onErrorCaptured, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ru } from '@shared/i18n/ru';
import { breaksRendering, logError } from '../lib/boot';
import StateNotice from './StateNotice.vue';
import UiButton from './UiButton.vue';

const route = useRoute();
const failed = ref(false);
const attempt = ref(0);
const instance = getCurrentInstance();
const title = computed(() => {
  const { section } = route.meta;
  return section === undefined ? ru.screenError.title : ru.screenError.sections[section];
});

// The button that had the focus goes away with the notice, and the screen with its controls
// goes away when the notice comes: the focus is put on the scroll area so that the keyboard
// keeps its place.
async function keepFocus(): Promise<void> {
  await nextTick();
  const anchor: unknown = instance?.proxy?.$el;
  if (anchor instanceof Node) {
    anchor.parentElement?.focus();
  }
}

onErrorCaptured((error, _instance, info) => {
  logError(error);
  if (breaksRendering(info) && !failed.value) {
    failed.value = true;
    void keepFocus();
  }
  return false;
});

watch(
  () => route.path,
  () => {
    failed.value = false;
  },
);

function retry(): void {
  attempt.value += 1;
  failed.value = false;
  void keepFocus();
}
</script>

<template>
  <div v-if="failed" class="lx-content" data-screen-error>
    <StateNotice
      class="notice"
      icon="exclamation-circle"
      :title="title"
      :text="ru.screenError.text"
      live="alert"
    >
      <UiButton size="sm" variant="primary" icon="arrow-clockwise" @click="retry()">
        {{ ru.screenError.retry }}
      </UiButton>
      <UiButton v-if="route.path !== '/'" size="sm" to="/">{{ ru.screenError.home }}</UiButton>
    </StateNotice>
  </div>
  <slot v-else :key="attempt" />
</template>

<style scoped>
.notice {
  margin-top: 14px;
}
</style>
