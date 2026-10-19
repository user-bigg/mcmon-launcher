<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import type { CoverTime } from '@shared/catalog';
import type { Scene } from '@shared/scenes';
import { CONTEXT_KEY } from '../composables/context';
import {
  BUILTIN_SCENE,
  BUILTIN_SCENE_KEY,
  builtinLayerUrl,
  builtinSinkRows,
  STAND_IN_AFTER_MS,
  STAND_IN_HOLD_MS,
} from '../lib/builtin-scene';
import {
  coverScale,
  focusShift,
  parallaxOffset,
  parallaxReach,
  parallaxRoom,
  pixelScale,
  placeLayers,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  sceneTime,
  type LayerSource,
  type LayerTile,
  type PlacedLayer,
} from '../lib/landscape';

const EASING = 0.08;
const SETTLED = 0.001;
const CLOCK_MS = 60_000;

const props = withDefaults(
  defineProps<{
    scene: Scene;
    base: LayerSource;
    time?: CoverTime;
    height?: number | string;
    parallax?: boolean;
    still?: boolean;
    focus?: number;
    cover?: boolean;
    standIn?: boolean;
  }>(),
  { time: 'auto', parallax: true, still: false, cover: false, standIn: true },
);

interface LayerView extends PlacedLayer {
  pending: boolean;
  builtin: boolean;
  tile: LayerTile | null;
  animation: string[];
  style: Record<string, string> | undefined;
}

const root = useTemplateRef<HTMLDivElement>('root');
const width = ref(0);
const boxHeight = ref(0);
const visible = ref(true);
const focused = ref(true);
const shown = ref(true);
const reduced = ref(false);

const context = inject(CONTEXT_KEY, undefined);
const clock = ref(context?.now() ?? new Date());
const resolvedTime = computed(() => sceneTime(props.time, clock.value));
const animated = computed(() => !props.still && !reduced.value);
const layers = computed(() =>
  placeLayers(props.scene, resolvedTime.value, props.base)
    .filter((layer) => layer.url !== '')
    .map((layer) => layerView(layer, animated.value)),
);
const loadedUrls = ref<ReadonlySet<string>>(new Set());
const failedUrls = ref<ReadonlySet<string>>(new Set());
// A layer that failed to load is not a drawn one: the built-in scene stays instead of a sky
// with holes. Where no scene stands in, waiting for it forever would leave the frame empty.
const ready = computed(
  () =>
    layers.value.length > 0 &&
    layers.value.every(
      (layer) =>
        loadedUrls.value.has(layer.url) || (!props.standIn && failedUrls.value.has(layer.url)),
    ),
);

function settle(url: string): void {
  if (!loadedUrls.value.has(url)) {
    loadedUrls.value = new Set([...loadedUrls.value, url]);
  }
}

function fail(url: string): void {
  if (!failedUrls.value.has(url)) {
    failedUrls.value = new Set([...failedUrls.value, url]);
  }
  if (props.standIn && !ready.value) {
    clearTimeout(overdueTimer);
    overdue.value = true;
  }
}

const overdue = ref(false);
const holding = ref(false);
let overdueTimer: ReturnType<typeof setTimeout> | undefined;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
const standingIn = computed(
  () =>
    props.standIn &&
    props.scene.key !== BUILTIN_SCENE_KEY &&
    ((!ready.value && overdue.value) || holding.value),
);
const stack = computed<LayerView[]>(() => [
  ...(standingIn.value
    ? placeLayers(BUILTIN_SCENE, 'day', builtinLayerUrl).map((layer) => ({
        ...layerView(layer, animated.value),
        builtin: true,
        name: BUILTIN_SCENE_KEY + '-' + layer.name,
      }))
    : []),
  ...layers.value.map((layer) => ({ ...layer, pending: !ready.value })),
]);

function awaitLayers(): void {
  clearTimeout(overdueTimer);
  overdue.value = false;
  overdueTimer = setTimeout(() => {
    overdue.value = true;
  }, STAND_IN_AFTER_MS);
}

function release(): void {
  clearTimeout(overdueTimer);
  clearTimeout(holdTimer);
  holding.value = overdue.value;
  overdue.value = false;
  holdTimer = setTimeout(() => {
    holding.value = false;
  }, STAND_IN_HOLD_MS);
}

watch(ready, (isReady) => {
  if (isReady) {
    release();
  } else {
    awaitLayers();
  }
});

watch(
  () => props.scene.key,
  (_key, before) => {
    if (before === BUILTIN_SCENE_KEY && !ready.value) {
      clearTimeout(overdueTimer);
      overdue.value = true;
    }
  },
  { flush: 'post' },
);

const pixel = computed(() =>
  props.cover ? coverScale(width.value, boxHeight.value) : pixelScale(width.value),
);
const sink = computed(() =>
  pixel.value > 0 && boxHeight.value > 0
    ? builtinSinkRows(boxHeight.value / pixel.value) * pixel.value
    : 0,
);
const shift = computed(() =>
  focusShift(width.value, pixel.value, props.focus ?? props.scene.focus),
);
const running = computed(() => !props.still && visible.value && focused.value && shown.value);
const moving = computed(() => props.parallax && running.value && !reduced.value);
const motion = computed(() => {
  if (props.still) {
    return 'still';
  }
  return props.parallax ? 'parallax' : 'drift';
});

const cssHeight = computed(() =>
  typeof props.height === 'number' ? `${String(props.height * pixel.value)}px` : props.height,
);

const rootStyle = computed(() => ({
  '--lx-scene-sky':
    standingIn.value && !ready.value
      ? BUILTIN_SCENE.skies.day
      : props.scene.skies[resolvedTime.value],
  '--lx-scene-cols': String(SCENE_WIDTH),
  '--lx-scene-px': `${String(pixel.value)}px`,
  '--lx-scene-shift': `${String(shift.value)}px`,
  '--lx-builtin-sink': `${String(sink.value)}px`,
  ...(cssHeight.value === undefined ? {} : { height: cssHeight.value }),
}));

function layerView(layer: PlacedLayer, live: boolean): LayerView {
  const { motion } = layer;
  const keyframes = live ? (motion?.keyframes ?? null) : null;
  return {
    ...layer,
    pending: false,
    builtin: props.scene.key === BUILTIN_SCENE_KEY,
    tile: keyframes === null ? null : (motion?.tile ?? null),
    animation: keyframes === null ? [] : ['landscape-anim', `landscape-anim-${keyframes}`],
    style:
      motion === null
        ? undefined
        : { opacity: String(motion.still), ...(keyframes === null ? {} : motion.vars) },
  };
}

const pointer = { target: 0, current: 0, frame: 0 };
let listening = false;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let resizeObserver: ResizeObserver | undefined;
let intersectionObserver: IntersectionObserver | undefined;
let reducedQuery: MediaQueryList | undefined;

function box(): DOMRect | undefined {
  return root.value?.getBoundingClientRect();
}

function layerNodes(): HTMLElement[] {
  return Array.from(root.value?.querySelectorAll<HTMLElement>('[data-depth]') ?? []);
}

function render(): void {
  const nodes = layerNodes();
  const bounded = nodes.filter((node) => node.dataset.drifts === undefined);
  const deepest = Math.max(0, ...bounded.map((node) => Number(node.dataset.depth)));
  const reach = parallaxReach(
    width.value,
    parallaxRoom(width.value, pixel.value, shift.value),
    deepest,
  );
  for (const node of nodes) {
    const x = parallaxOffset({
      pointer: pointer.current,
      depth: Number(node.dataset.depth),
      width: width.value,
      reach,
    });
    node.style.transform = `translate3d(${String(x)}px, 0, 0)`;
  }
}

function tick(): void {
  pointer.frame = 0;
  pointer.current += (pointer.target - pointer.current) * EASING;
  render();
  if (Math.abs(pointer.target - pointer.current) >= SETTLED) {
    requestFrame();
  }
}

function requestFrame(): void {
  if (pointer.frame === 0) {
    pointer.frame = requestAnimationFrame(tick);
  }
}

function onPointer(event: PointerEvent): void {
  const rect = box();
  if (rect === undefined || rect.width === 0 || event.pointerType === 'touch') {
    return;
  }
  const offset = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
  pointer.target = Math.max(-1, Math.min(1, offset));
  requestFrame();
}

function start(): void {
  if (listening) {
    return;
  }
  listening = true;
  root.value?.parentElement?.addEventListener('pointermove', onPointer, { passive: true });
}

function stop(): void {
  if (!listening) {
    return;
  }
  listening = false;
  root.value?.parentElement?.removeEventListener('pointermove', onPointer);
  cancelAnimationFrame(pointer.frame);
  pointer.frame = 0;
}

function reset(): void {
  pointer.target = 0;
  pointer.current = 0;
  for (const node of layerNodes()) {
    node.style.transform = '';
  }
}

function measure(): void {
  width.value = root.value?.clientWidth ?? 0;
  boxHeight.value = root.value?.clientHeight ?? 0;
}

function onFocus(): void {
  focused.value = true;
}

function onBlur(): void {
  focused.value = false;
}

function onVisibility(): void {
  shown.value = !document.hidden;
}

function onReducedChange(): void {
  reduced.value = reducedQuery?.matches ?? false;
}

function observe(element: HTMLElement): void {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
  }
  if (typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver((entries) => {
      visible.value = entries.at(-1)?.isIntersecting ?? true;
    });
    intersectionObserver.observe(element);
  }
}

watch(moving, (isMoving) => {
  if (isMoving) {
    start();
    return;
  }
  stop();
  reset();
});

onMounted(() => {
  measure();
  if (!ready.value) {
    awaitLayers();
  }
  focused.value = document.hasFocus();
  onVisibility();
  reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  onReducedChange();
  reducedQuery.addEventListener('change', onReducedChange);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  if (root.value !== null) {
    observe(root.value);
  }
  if (moving.value) {
    start();
  }
  watch(
    () => props.time === 'auto',
    (auto) => {
      clearInterval(clockTimer);
      clockTimer = undefined;
      if (auto) {
        clock.value = context?.now() ?? new Date();
        clockTimer = setInterval(() => {
          clock.value = context?.now() ?? new Date();
        }, CLOCK_MS);
      }
    },
    { immediate: true },
  );
});

onBeforeUnmount(() => {
  stop();
  clearTimeout(overdueTimer);
  clearTimeout(holdTimer);
  clearInterval(clockTimer);
  resizeObserver?.disconnect();
  intersectionObserver?.disconnect();
  reducedQuery?.removeEventListener('change', onReducedChange);
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('blur', onBlur);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div
    ref="root"
    class="landscape"
    :class="{
      'is-running': running,
      'is-moving': moving,
      'is-ready': ready,
      'is-stand-in': standingIn,
    }"
    :style="rootStyle"
    :data-scene="`${scene.key}-${resolvedTime}`"
    :data-motion="motion"
    aria-hidden="true"
  >
    <div
      v-for="layer in stack"
      :key="layer.name"
      class="landscape-layer"
      :class="{ 'is-pending': layer.pending, 'is-builtin': layer.builtin }"
      :data-layer="layer.name"
      :data-depth="layer.depth"
      :data-drifts="layer.tile === 'x' ? '' : undefined"
    >
      <div
        v-if="layer.tile === 'x'"
        class="landscape-strip"
        :class="layer.animation"
        :style="layer.style"
      >
        <img
          v-for="copy in 3"
          :key="copy"
          class="landscape-tile"
          :src="layer.url"
          alt=""
          :width="SCENE_WIDTH"
          :height="SCENE_HEIGHT"
          draggable="false"
          @load="settle(layer.url)"
          @error="fail(layer.url)"
        />
      </div>
      <div
        v-else-if="layer.tile === 'y'"
        class="landscape-strip-y"
        :class="layer.animation"
        :style="layer.style"
      >
        <img
          v-for="copy in 2"
          :key="copy"
          class="landscape-tile-y"
          :src="layer.url"
          alt=""
          :width="SCENE_WIDTH"
          :height="SCENE_HEIGHT"
          draggable="false"
          @load="settle(layer.url)"
          @error="fail(layer.url)"
        />
      </div>
      <img
        v-else
        class="landscape-image"
        :class="layer.animation"
        :style="layer.style"
        :src="layer.url"
        alt=""
        :width="SCENE_WIDTH"
        :height="SCENE_HEIGHT"
        draggable="false"
        @load="settle(layer.url)"
        @error="fail(layer.url)"
      />
    </div>
  </div>
</template>

<style scoped>
.landscape {
  position: relative;
  height: 100%;
  overflow: hidden;
  background-color: var(--mc-surface);
  pointer-events: none;
  user-select: none;
}

.landscape::before {
  content: '';
  position: absolute;
  inset: 0;
  background-color: var(--lx-scene-sky);
}

.landscape:not(.is-ready, .is-stand-in)::before,
.landscape-layer.is-pending {
  opacity: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .landscape::before,
  .landscape-layer {
    transition: opacity 0.2s ease;
  }
}

.landscape-layer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  translate: var(--lx-scene-shift) 0;
}

.landscape-layer.is-builtin {
  translate: var(--lx-scene-shift) var(--lx-builtin-sink);
}

.is-moving .landscape-layer {
  will-change: transform;
}

.landscape-image,
.landscape-tile,
.landscape-tile-y {
  display: block;
  flex: none;
  height: auto;
  max-width: none;
  image-rendering: pixelated;
}

.landscape-image,
.landscape-strip-y {
  width: calc(var(--lx-scene-cols) * var(--lx-scene-px));
}

.landscape-strip {
  display: flex;
  flex: none;
  width: calc(3 * var(--lx-scene-cols) * var(--lx-scene-px));
}

.landscape-tile {
  width: calc(100% / 3);
}

.landscape-strip-y {
  display: flex;
  flex: none;
  flex-direction: column;
}

.landscape-tile-y {
  width: 100%;
}

@media (prefers-reduced-motion: no-preference) {
  .landscape-anim-fall {
    animation: lx-fall var(--lx-anim-dur) var(--lx-anim-timing) var(--lx-anim-delay) infinite
      backwards;
  }

  .landscape-anim-rise {
    animation: lx-rise var(--lx-anim-dur) var(--lx-anim-timing) var(--lx-anim-delay) infinite
      backwards;
  }

  .landscape-anim-drift {
    animation: lx-drift var(--lx-anim-dur) var(--lx-anim-timing) var(--lx-anim-delay) infinite
      backwards;
  }

  .landscape-anim-drift-back {
    animation: lx-drift-back var(--lx-anim-dur) var(--lx-anim-timing) var(--lx-anim-delay) infinite
      backwards;
  }

  .landscape-anim-sway {
    animation: lx-sway var(--lx-anim-dur) ease-in-out var(--lx-anim-delay) infinite alternate
      backwards;
  }

  .landscape-anim-bob {
    animation: lx-bob var(--lx-anim-dur) steps(2, jump-none) var(--lx-anim-delay) infinite alternate
      backwards;
  }

  .landscape-anim-twinkle {
    animation: lx-twinkle var(--lx-anim-dur) ease-in-out var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-flash {
    animation: lx-flash var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-flicker {
    animation: lx-flicker var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-pulse {
    animation: lx-pulse var(--lx-anim-dur) ease-in-out var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-burst {
    animation: lx-burst var(--lx-anim-dur) ease-out var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-meteor {
    animation: lx-meteor var(--lx-anim-dur) ease-out var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-launch {
    animation: lx-launch var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-liftoff {
    animation: lx-liftoff var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-ignite {
    animation: lx-ignite var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-alt {
    animation: lx-alt var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-puff {
    animation: lx-puff var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-quarter {
    animation: lx-quarter var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape-anim-blip {
    animation: lx-blip var(--lx-anim-dur) linear var(--lx-anim-delay) infinite backwards;
  }

  .landscape:not(.is-running) .landscape-anim {
    animation-play-state: paused;
  }
}

@keyframes lx-fall {
  from {
    transform: translateY(0);
  }

  to {
    transform: translateY(50%);
  }
}

@keyframes lx-rise {
  from {
    transform: translateY(50%);
  }

  to {
    transform: translateY(0);
  }
}

@keyframes lx-drift {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(calc(100% / 3));
  }
}

@keyframes lx-drift-back {
  from {
    transform: translateX(calc(100% / 3));
  }

  to {
    transform: translateX(0);
  }
}

@keyframes lx-sway {
  from {
    transform: translateX(calc(var(--lx-anim-amp) * -50% / 384));
  }

  to {
    transform: translateX(calc(var(--lx-anim-amp) * 50% / 384));
  }
}

@keyframes lx-bob {
  from {
    transform: translateY(0);
  }

  to {
    transform: translateY(calc(200% / 176));
  }
}

@keyframes lx-twinkle {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.15;
  }
}

@keyframes lx-flash {
  0%,
  86% {
    opacity: 0;
  }

  87% {
    opacity: 1;
  }

  88.5% {
    opacity: 0.15;
  }

  90% {
    opacity: 1;
  }

  93%,
  100% {
    opacity: 0;
  }
}

@keyframes lx-flicker {
  0%,
  100% {
    opacity: 1;
  }

  18% {
    opacity: 0.7;
  }

  33% {
    opacity: 0.95;
  }

  52% {
    opacity: 0.6;
  }

  68% {
    opacity: 1;
  }

  84% {
    opacity: 0.75;
  }
}

@keyframes lx-pulse {
  0%,
  100% {
    opacity: 0.3;
  }

  50% {
    opacity: 1;
  }
}

@keyframes lx-burst {
  0% {
    opacity: 0;
  }

  3% {
    opacity: 1;
  }

  28% {
    opacity: 0.55;
  }

  50%,
  100% {
    opacity: 0;
  }
}

@keyframes lx-meteor {
  0% {
    opacity: 0;
    transform: translate(0, 0);
  }

  2% {
    opacity: 1;
  }

  10%,
  100% {
    opacity: 0;
    transform: translate(-9%, 9%);
  }
}

@keyframes lx-launch {
  0%,
  55% {
    opacity: 1;
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45);
  }

  80% {
    opacity: 1;
    transform: translateY(-90%);
  }

  81%,
  97% {
    opacity: 0;
    transform: translateY(-90%);
  }

  98%,
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes lx-liftoff {
  0%,
  53% {
    opacity: 0;
    transform: translateY(0);
  }

  55% {
    opacity: 1;
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45);
  }

  80% {
    opacity: 1;
    transform: translateY(-90%);
  }

  81%,
  100% {
    opacity: 0;
    transform: translateY(-90%);
  }
}

@keyframes lx-ignite {
  0%,
  52% {
    opacity: 0;
  }

  56% {
    opacity: 1;
  }

  85% {
    opacity: 0.7;
  }

  96%,
  100% {
    opacity: 0;
  }
}

@keyframes lx-alt {
  0%,
  49.99% {
    opacity: 1;
  }

  50%,
  100% {
    opacity: 0;
  }
}

@keyframes lx-puff {
  0% {
    opacity: 0;
    transform: translate(0, 0);
  }

  15% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate(calc(var(--lx-anim-amp) * 1%), -25%);
  }
}

@keyframes lx-quarter {
  0%,
  24.99% {
    opacity: 1;
  }

  25%,
  100% {
    opacity: 0;
  }
}

@keyframes lx-blip {
  0% {
    opacity: 0;
  }

  6% {
    opacity: 1;
  }

  20%,
  100% {
    opacity: 0;
  }
}
</style>
