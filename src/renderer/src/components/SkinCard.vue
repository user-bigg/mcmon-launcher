<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { ru } from '@shared/i18n/ru';
import { tileLoads } from '../lib/load-queue';
import { watchNear, type Nearness } from '../lib/near-view';
import { drawCape, drawFigure, loadedTexture, loadTexture } from '../lib/skin-draw';
import BiIcon from './BiIcon.vue';

const props = defineProps<{
  kind: 'skin' | 'cape';
  title: string;
  url: string | null;
  slim?: boolean;
  worn: boolean;
  tried: boolean;
  shown: boolean;
  fresh: boolean;
}>();
const emit = defineEmits<{ pick: [] }>();
const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
const card = useTemplateRef<HTMLButtonElement>('card');
// A picture that came this fast was already on disk: it is shown as is, without easing in.
const INSTANT_MS = 120;

const painted = ref(false);
const eased = ref(false);
const failed = ref(false);
let nearness: Nearness = 'far';
let loading: string | null = null;
let cancelLoad: () => void = () => undefined;
let unwatch: () => void = () => undefined;

const mark = computed(() => {
  if (props.worn) {
    return 'worn';
  }
  return props.tried ? 'tried' : 'none';
});

const label = computed(() =>
  [
    props.title,
    ...(props.worn ? [ru.skins.wornMark] : []),
    ...(props.tried ? [ru.skins.triedMark] : []),
    ...(props.fresh ? [ru.skins.newMark] : []),
    ...(failed.value ? [ru.skins.notLoaded] : []),
  ].join(', '),
);

function draw(sheet: HTMLImageElement): void {
  if (canvas.value === null) {
    return;
  }
  if (props.kind === 'skin') {
    drawFigure(canvas.value, sheet, props.slim);
  } else {
    drawCape(canvas.value, sheet);
  }
  painted.value = true;
}

async function load(wanted: string): Promise<void> {
  const startedAt = performance.now();
  loading = wanted;
  const sheet = await loadTexture(wanted).catch(() => null);
  if (loading === wanted) {
    loading = null;
  }
  if (wanted !== props.url) {
    return;
  }
  if (sheet === null) {
    failed.value = true;
    return;
  }
  eased.value = performance.now() - startedAt > INSTANT_MS;
  draw(sheet);
}

// A picture that failed is asked for again the next time the tile comes near the screen.
function request(): void {
  cancelLoad();
  cancelLoad = (): void => undefined;
  const wanted = props.url;
  if (wanted === null || painted.value || nearness === 'far' || loading === wanted) {
    return;
  }
  failed.value = false;
  cancelLoad = tileLoads.add({ run: () => load(wanted), urgent: () => nearness === 'visible' });
}

function paint(): void {
  const ready = props.url === null ? null : loadedTexture(props.url);
  painted.value = false;
  eased.value = false;
  failed.value = false;
  if (ready === null) {
    request();
  } else {
    draw(ready);
  }
}

onMounted(() => {
  paint();
  if (card.value !== null) {
    unwatch = watchNear(card.value, (next) => {
      const wasFar = nearness === 'far';
      nearness = next;
      if (wasFar !== (next === 'far')) {
        request();
      }
    });
  }
});
onBeforeUnmount(() => {
  unwatch();
  cancelLoad();
});
watch(() => [props.url, props.slim], paint);
</script>

<template>
  <button
    ref="card"
    type="button"
    class="card"
    :class="[`is-${kind}`, `is-${mark}`]"
    :title="title"
    :aria-label="label"
    :aria-pressed="shown"
    :data-card="kind"
    :data-card-mark="mark"
    :data-card-painted="painted"
    :data-card-failed="failed"
    @click="emit('pick')"
  >
    <span v-if="url === null" class="frame bare" data-card-blank aria-hidden="true">
      <i class="cloth" />
    </span>
    <span v-else class="frame">
      <span
        v-if="!painted"
        class="ghost"
        :class="failed ? 'is-failed' : 'lx-skel is-late'"
        aria-hidden="true"
      >
        <template v-if="kind === 'skin'">
          <i class="part head" />
          <i class="part torso" />
          <i class="part arm" />
          <i class="part arm is-right" />
          <i class="part leg" />
          <i class="part leg is-right" />
        </template>
        <i v-else class="part cloth" />
        <BiIcon v-if="failed" class="broken" name="exclamation-triangle" />
      </span>
      <canvas
        ref="canvas"
        class="preview"
        :class="{ 'is-in': painted, 'is-eased': eased }"
        aria-hidden="true"
      />
    </span>
    <span v-if="worn" class="tick"><BiIcon name="check2" /></span>
    <span v-if="fresh" class="fresh" :class="{ 'is-waiting': !painted }" data-card-new />
  </button>
</template>

<style scoped>
.card {
  position: relative;
  display: grid;
  justify-items: center;
  align-content: start;
  padding: 8px 4px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface);
  color: var(--mc-text);
  cursor: default;
}

.card:hover {
  border-color: var(--mc-border-strong);
}

.card.is-worn {
  border-color: var(--mc-accent);
  background: var(--mc-accent-soft);
}

.card.is-tried {
  border-color: transparent;
  outline: 2px dashed var(--mc-accent);
  outline-offset: -2px;
}

.card.is-tried:focus-visible {
  outline-style: solid;
  outline-offset: 2px;
}

.frame {
  position: relative;
  display: block;
  width: 40px;
  height: 80px;
}

.is-cape .frame {
  height: 64px;
}

.ghost {
  position: absolute;
  inset: 0;
  display: block;
  border-radius: 0;
  background: none;
}

.part {
  position: absolute;
  background: var(--mc-surface-3);
}

.head {
  top: 0;
  left: 10px;
  width: 20px;
  height: 20px;
}

.torso {
  top: 20px;
  left: 10px;
  width: 20px;
  height: 30px;
}

.arm {
  top: 20px;
  left: 0;
  width: 9px;
  height: 30px;
}

.arm.is-right {
  left: 31px;
}

.leg {
  top: 51px;
  left: 10px;
  width: 9px;
  height: 29px;
}

.leg.is-right {
  left: 21px;
}

.cloth {
  position: absolute;
  inset: 0;
  background: var(--mc-surface-3);
}

.is-failed .part {
  background: var(--mc-surface-2);
}

.broken {
  position: absolute;
  top: 50%;
  left: 50%;
  color: var(--mc-text-dim);
  font-size: 14px;
  transform: translate(-50%, -50%);
}

.bare {
  overflow: hidden;
}

.bare .cloth {
  border-top: 6px solid var(--mc-text-dim);
  background: color-mix(in srgb, var(--mc-text-dim) 42%, var(--mc-surface));
}

.bare::after {
  content: '';
  position: absolute;
  top: 50%;
  left: -25%;
  width: 150%;
  border-top: 2px solid color-mix(in srgb, var(--mc-danger) 62%, var(--mc-surface));
  transform: rotate(-58deg);
}

.preview {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  image-rendering: pixelated;
}

.preview.is-in {
  opacity: 1;
}

@media (prefers-reduced-motion: no-preference) {
  .preview.is-eased {
    transition: opacity 0.18s ease-out;
  }
}

.tick {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--mc-accent);
  color: var(--lx-on-accent);
  font-size: 12px;
}

.fresh {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mc-accent);
}

.fresh.is-waiting {
  visibility: hidden;
}
</style>
