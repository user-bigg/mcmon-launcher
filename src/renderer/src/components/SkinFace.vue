<script setup lang="ts">
import { onMounted, ref, useTemplateRef, watch } from 'vue';
import { drawFace, loadTexture } from '../lib/skin-draw';

const { skin, size = 30 } = defineProps<{ skin: string; size?: 30 | 42 }>();
const canvas = useTemplateRef<HTMLCanvasElement>('canvas');

const painted = ref(false);

async function paint(): Promise<void> {
  const wanted = skin;
  const sheet = await loadTexture(wanted);
  if (canvas.value !== null && sheet !== null && wanted === skin) {
    drawFace(canvas.value, sheet);
    painted.value = true;
  }
}

onMounted(paint);
watch(() => skin, paint);
</script>

<template>
  <canvas
    ref="canvas"
    class="face"
    :class="[`is-${String(size)}`, { 'lx-skel is-late is-raised': !painted }]"
    :data-face="skin"
  />
</template>

<style scoped>
.face {
  display: block;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-3);
  image-rendering: pixelated;
}

.is-42 {
  width: 42px;
  height: 42px;
}
</style>
