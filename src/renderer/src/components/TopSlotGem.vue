<script lang="ts">
import type { TopSlotTier } from '@shared/catalog';

type Shade = 'a' | 'b' | 'c';

const gems: Record<TopSlotTier, readonly string[]> = {
  diamond: ['..aaaa..', '.abbbba.', 'abccbbba', 'abcbbbba', '.abbbba.', '..abba..', '...aa...'],
  gold: ['...aaaaa', '..abccba', '.abcbbba', 'abbbbba.', 'aaaaaa..'],
};

function gemPaths(rows: readonly string[]): Record<Shade, string> {
  const paths: Record<Shade, string> = { a: '', b: '', c: '' };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row.charAt(x);
      if (cell === 'a' || cell === 'b' || cell === 'c') {
        paths[cell] += `M${String(x)} ${String(y)}h1v1h-1z`;
      }
    }
  });
  return paths;
}

const shapes = {
  diamond: gemPaths(gems.diamond),
  gold: gemPaths(gems.gold),
};
</script>

<script setup lang="ts">
import { ru } from '@shared/i18n/ru';

const { tier, decorative } = defineProps<{ tier: TopSlotTier; decorative?: boolean }>();
</script>

<template>
  <svg
    class="gem"
    :class="`is-${tier}`"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : ru.topSlots[tier]"
    :aria-hidden="decorative ? 'true' : undefined"
    :viewBox="`0 0 8 ${String(gems[tier].length)}`"
    shape-rendering="crispEdges"
  >
    <title v-if="!decorative">{{ ru.topSlots[tier] }}</title>
    <path class="edge" :d="shapes[tier].a" />
    <path class="body" :d="shapes[tier].b" />
    <path class="shine" :d="shapes[tier].c" />
  </svg>
</template>

<style scoped>
.gem {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.edge {
  fill: color-mix(in srgb, var(--mc-bg) 45%, transparent);
}

.shine {
  fill: color-mix(in srgb, var(--mc-text) 70%, transparent);
}

.is-diamond .body {
  fill: var(--mc-diamond);
}

.is-gold .body {
  fill: var(--mc-gold);
}
</style>
