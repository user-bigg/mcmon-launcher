<script setup lang="ts">
const { value, label, thin } = defineProps<{
  value: number;
  label: string;
  thin?: boolean;
}>();
</script>

<template>
  <div
    class="bar"
    :class="{ 'is-thin': thin }"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="value"
    :aria-label="label"
  >
    <i :style="{ transform: `scaleX(${String(Math.min(Math.max(value, 0), 100) / 100)})` }" />
  </div>
</template>

<style scoped>
.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--mc-surface-3);
  overflow: hidden;
}

.bar.is-thin {
  height: 4px;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  transform-origin: left center;
  background:
    repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--mc-text) 12%, transparent) 0 8px,
      transparent 8px 16px
    ),
    linear-gradient(90deg, color-mix(in srgb, var(--mc-violet) 70%, var(--mc-bg)), var(--mc-violet));
}

.bar.is-thin i {
  background: var(--mc-violet);
}

@media (prefers-reduced-motion: no-preference) {
  .bar i {
    transition: transform 0.3s ease;
  }
}
</style>
