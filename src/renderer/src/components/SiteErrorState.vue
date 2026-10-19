<script setup lang="ts">
import { computed } from 'vue';
import type { SiteError } from '@shared/site';
import { ru } from '@shared/i18n/ru';
import { siteErrorView } from '../lib/site-error';
import StateNotice from './StateNotice.vue';
import UiButton from './UiButton.vue';

const { error } = defineProps<{ error: SiteError | null }>();
const emit = defineEmits<{ retry: [] }>();

const view = computed(() => siteErrorView(error));
</script>

<template>
  <StateNotice
    class="site-error"
    :icon="view.icon"
    :title="view.title"
    :text="view.text"
    :tone="view.tone"
    live="alert"
  >
    <UiButton size="sm" icon="arrow-clockwise" @click="emit('retry')">
      {{ ru.state.retry }}
    </UiButton>
  </StateNotice>
</template>
