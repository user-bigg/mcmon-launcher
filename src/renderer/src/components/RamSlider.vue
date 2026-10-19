<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatGb } from '../lib/units';

const { min, max, recommended, label } = defineProps<{
  min: number;
  max: number;
  recommended: { from: number; to: number };
  label: string;
}>();
const value = defineModel<number>({ required: true });
const dragging = ref(false);

const span = computed(() => max - min);
const ticks = computed(() =>
  Array.from({ length: Math.floor(span.value / 2) + 1 }, (_, index) => {
    const gb = min + index * 2;
    return { gb, left: percent(gb), text: gb === min || gb === max ? formatGb(gb) : String(gb) };
  }),
);

function percent(gb: number): string {
  return `${String(((gb - min) / span.value) * 100)}%`;
}

function clamp(gb: number): number {
  return Math.min(max, Math.max(min, gb));
}

const steps: Record<string, (current: number) => number> = {
  ArrowLeft: (current) => current - 1,
  ArrowDown: (current) => current - 1,
  ArrowRight: (current) => current + 1,
  ArrowUp: (current) => current + 1,
  PageDown: (current) => current - 2,
  PageUp: (current) => current + 2,
  Home: () => min,
  End: () => max,
};

function onKey(event: KeyboardEvent): void {
  const step = steps[event.key];
  if (step === undefined) {
    return;
  }
  event.preventDefault();
  value.value = clamp(step(value.value));
}

function pick(event: PointerEvent): void {
  const track = event.currentTarget;
  if (!(track instanceof HTMLElement)) {
    return;
  }
  const box = track.getBoundingClientRect();
  const ratio = (event.clientX - box.left) / box.width;
  value.value = clamp(Math.round(min + ratio * span.value));
}

function onDown(event: PointerEvent): void {
  const track = event.currentTarget;
  if (track instanceof HTMLElement) {
    track.setPointerCapture(event.pointerId);
  }
  dragging.value = true;
  pick(event);
}

function onMove(event: PointerEvent): void {
  if (dragging.value) {
    pick(event);
  }
}

function onUp(event: PointerEvent): void {
  const track = event.currentTarget;
  if (track instanceof HTMLElement && track.hasPointerCapture(event.pointerId)) {
    track.releasePointerCapture(event.pointerId);
  }
  dragging.value = false;
}
</script>

<template>
  <div class="ram-slider">
    <div
      class="track"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <div class="rail">
        <span
          class="rec"
          :style="{
            left: percent(recommended.from),
            width: percent(min + recommended.to - recommended.from),
          }"
        />
        <span class="fill" :style="{ width: percent(value) }" />
      </div>
      <span
        class="knob"
        role="slider"
        tabindex="0"
        :aria-label="label"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="value"
        :aria-valuetext="formatGb(value)"
        :style="{ left: percent(value) }"
        @keydown="onKey"
      />
    </div>
    <div class="scale" aria-hidden="true">
      <span v-for="tick in ticks" :key="tick.gb" :style="{ left: tick.left }">{{ tick.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.track {
  position: relative;
  height: 34px;
  margin-top: 8px;
  touch-action: none;
}

.rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 12px;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--mc-surface-3);
}

.rec {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--mc-accent) 16%, transparent);
}

.fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 999px;
  background: var(--mc-accent);
}

.knob {
  position: absolute;
  top: 5px;
  width: 22px;
  height: 22px;
  margin-left: -11px;
  border-radius: 50%;
  background: var(--mc-text);
  box-shadow:
    0 0 0 4px var(--mc-accent-soft),
    0 2px 6px color-mix(in srgb, var(--mc-bg) 70%, transparent);
}

.scale {
  position: relative;
  height: 16px;
  font-size: 11px;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.scale span {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
}

.scale span:first-child {
  transform: none;
}

.scale span:last-child {
  transform: translateX(-100%);
}
</style>
