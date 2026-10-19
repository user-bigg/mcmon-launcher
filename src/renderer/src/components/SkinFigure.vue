<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { ru } from '@shared/i18n/ru';
import type { Figure } from '../lib/figure';
import { drawFigure, loadTexture, plainSkin, type Sheet } from '../lib/skin-draw';
import BiIcon from './BiIcon.vue';

type Mode = 'loading' | 'solid' | 'flat';

const props = defineProps<{
  skin: string | null;
  standard: string | null;
  slim: boolean;
  cape: string | null;
  back: boolean;
}>();

const FALLBACK_SIZE = { width: 278, height: 340 } as const;

const box = useTemplateRef<HTMLDivElement>('box');
const solid = useTemplateRef<HTMLCanvasElement>('solid');
const flat = useTemplateRef<HTMLCanvasElement>('flat');
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mode = ref<Mode>('loading');
const walking = ref(!still);
const turned = ref(props.back);
const dragged = ref(false);

let figure: Figure | null = null;
let skinSheetNow: Sheet | null = null;
let capeSheetNow: Sheet | null = null;
let skinTicket = 0;
let capeTicket = 0;
let alive = true;
let watcher: ResizeObserver | null = null;

function boxSize(): { width: number; height: number } {
  const { clientWidth = 0, clientHeight = 0 } = box.value ?? {};
  return {
    width: clientWidth > 0 ? clientWidth : FALLBACK_SIZE.width,
    height: clientHeight > 0 ? clientHeight : FALLBACK_SIZE.height,
  };
}

function fit(): void {
  const { width, height } = boxSize();
  figure?.resize(width, height);
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function paintFlat(): void {
  if (flat.value !== null && skinSheetNow !== null) {
    drawFigure(flat.value, skinSheetNow, props.slim, turned.value ? 'back' : 'front', capeSheetNow);
  }
}

// A texture of an unexpected size makes the viewer throw; the figure keeps what it showed.
function paintSolid(): void {
  if (figure === null) {
    return;
  }
  try {
    if (skinSheetNow !== null) {
      figure.setSkin(skinSheetNow, props.slim);
    }
    figure.setCape(capeSheetNow);
  } catch {
    return;
  }
}

function paint(): void {
  paintSolid();
  paintFlat();
}

function face(back: boolean): void {
  turned.value = back;
  figure?.face(back);
  paintFlat();
}

async function showSkin(): Promise<void> {
  skinTicket += 1;
  const ticket = skinTicket;
  const wanted = props.skin ?? props.standard;
  const sheet = (wanted === null ? null : await loadTexture(wanted)) ?? plainSkin();
  if (alive && ticket === skinTicket) {
    skinSheetNow = sheet;
    paint();
  }
}

async function showCape(): Promise<void> {
  capeTicket += 1;
  const ticket = capeTicket;
  const sheet = props.cape === null ? null : await loadTexture(props.cape);
  if (alive && ticket === capeTicket) {
    capeSheetNow = sheet;
    paint();
    face(props.back);
  }
}

function toggleWalk(): void {
  walking.value = !walking.value;
  figure?.setWalking(walking.value);
}

async function start(): Promise<void> {
  const canvas = solid.value;
  if (canvas === null) {
    return;
  }
  try {
    const { createFigure } = await import('../lib/figure');
    if (!alive) {
      return;
    }
    figure = createFigure({
      canvas,
      ...boxSize(),
      still,
      shadowColor: token('--mc-bg'),
      onDrag: (): void => {
        dragged.value = true;
      },
    });
    figure.setWalking(walking.value);
    figure.face(turned.value);
    mode.value = 'solid';
    watcher = new ResizeObserver(fit);
    watcher.observe(box.value ?? canvas);
  } catch {
    mode.value = 'flat';
  }
  paint();
}

watch(() => [props.skin, props.standard, props.slim], showSkin);
watch(() => props.cape, showCape);
watch(
  () => props.back,
  (back) => {
    face(back);
  },
);

onMounted(() => {
  void showSkin();
  void showCape();
  void start();
});

onBeforeUnmount(() => {
  alive = false;
  watcher?.disconnect();
  figure?.dispose();
  figure = null;
});
</script>

<template>
  <div
    ref="box"
    class="figure"
    :class="`is-${mode}`"
    :data-figure="mode"
    :data-side="turned ? 'back' : 'front'"
    :data-skin="skin ?? 'standard'"
    :data-standard="standard ?? 'plain'"
    :data-cape="cape ?? 'none'"
  >
    <canvas
      v-show="mode !== 'flat'"
      ref="solid"
      class="solid"
      role="img"
      :aria-label="ru.skins.figure"
    />
    <canvas
      v-show="mode === 'flat'"
      ref="flat"
      class="flat"
      role="img"
      :aria-label="ru.skins.figure"
    />
    <div class="tools">
      <button
        v-if="mode === 'solid'"
        type="button"
        class="tool"
        :class="{ 'is-on': walking }"
        :aria-pressed="walking"
        :aria-label="ru.skins.walk"
        :title="ru.skins.walk"
        data-figure-walk
        @click="toggleWalk"
      >
        <BiIcon name="person-walking" />
      </button>
      <button
        type="button"
        class="tool"
        :aria-label="turned ? ru.skins.turnFront : ru.skins.turnBack"
        :title="turned ? ru.skins.turnFront : ru.skins.turnBack"
        data-figure-turn
        @click="face(!turned)"
      >
        <BiIcon name="arrow-repeat" />
      </button>
    </div>
    <p v-if="mode === 'solid' && !dragged" class="hint">{{ ru.skins.hint }}</p>
  </div>
</template>

<style scoped>
.figure {
  position: relative;
  height: 340px;
  background: linear-gradient(180deg, var(--mc-surface-2), var(--mc-surface));
}

.is-solid {
  cursor: grab;
}

.is-solid:active {
  cursor: grabbing;
}

.solid {
  display: block;
  outline: none;
}

.flat {
  display: block;
  width: 128px;
  height: 256px;
  margin: 0 auto;
  padding-top: 42px;
  box-sizing: content-box;
  image-rendering: pixelated;
}

.tools {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
}

.tool {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: var(--lx-shade);
  color: var(--mc-text-muted);
  cursor: default;
}

.tool:hover,
.tool.is-on {
  color: var(--mc-text);
  background: var(--mc-bg);
}

.hint {
  position: absolute;
  right: 0;
  bottom: 6px;
  left: 0;
  margin: 0;
  text-align: center;
  font-size: 11px;
  color: var(--mc-text-muted);
  pointer-events: none;
}

@media (max-height: 699px) {
  .figure {
    height: 260px;
  }

  .flat {
    width: 96px;
    height: 192px;
    padding-top: 34px;
  }
}
</style>
