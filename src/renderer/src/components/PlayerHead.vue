<script setup lang="ts">
import { headUrl } from '../lib/heads';

const { head } = defineProps<{ head: string }>();
</script>

<template>
  <img class="head" :src="headUrl(head)" alt="" />
</template>

<style scoped>
.head {
  display: block;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--mc-radius-sm);
  image-rendering: pixelated;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mc-text) 8%, transparent);
}
</style>
