<script setup lang="ts">
import { computed } from 'vue';

const { text } = defineProps<{ text: string }>();
defineSlots<Record<string, () => unknown>>();

interface Part {
  key: number;
  slot: string | null;
  text: string;
}

const parts = computed<Part[]>(() =>
  text
    .split(/(\{\w+\})/)
    .filter((piece) => piece !== '')
    .map((piece, key) => {
      const match = /^\{(\w+)\}$/.exec(piece);
      return { key, slot: match?.[1] ?? null, text: piece };
    }),
);
</script>

<template>
  <template v-for="part in parts" :key="part.key">
    <slot v-if="part.slot !== null" :name="part.slot" />
    <template v-else>{{ part.text }}</template>
  </template>
</template>
