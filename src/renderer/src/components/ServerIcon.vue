<script setup lang="ts">
import fallbackIcon from '../assets/pixel/icon-grass.svg';

type Size = 'xs' | 'sm' | 'row' | 'md' | 'lg';

const { src, size = 'sm' } = defineProps<{ src: string | null; size?: Size }>();
</script>

<template>
  <img
    class="server-icon"
    :class="`is-${size}`"
    :src="src ?? fallbackIcon"
    alt=""
    loading="lazy"
    decoding="async"
  />
</template>

<style scoped>
.server-icon {
  display: block;
  flex-shrink: 0;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-3);
  image-rendering: pixelated;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mc-text) 6%, transparent);
}

.is-xs {
  width: 24px;
  height: 24px;
}

.is-sm {
  width: 40px;
  height: 40px;
}

.is-row {
  width: 44px;
  height: 44px;
}

.is-md {
  width: 48px;
  height: 48px;
}

.is-lg {
  width: 76px;
  height: 76px;
  border-radius: var(--mc-radius-lg);
  box-shadow:
    0 0 0 4px var(--mc-bg),
    var(--mc-shadow);
}
</style>
