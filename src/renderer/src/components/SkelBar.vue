<script setup lang="ts">
import { computed } from 'vue';

const { w, h, round } = defineProps<{ w: number | string; h: number; round?: boolean }>();

const size = computed(() => ({
  width: typeof w === 'number' ? `${String(w)}px` : w,
  height: `${String(h)}px`,
}));
</script>

<template>
  <span class="lx-skel" :class="{ 'is-round': round }" :style="size" aria-hidden="true" />
</template>
