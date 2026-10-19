<script setup lang="ts">
import { computed, useId } from 'vue';
import type { Downtime, OnlinePoint } from '@shared/catalog';
import { ru } from '@shared/i18n/ru';
import { moscowTime } from '../lib/time';

const WIDTH = 560;
const HEIGHT = 120;
const PADDING = 8;
const TICKS = 4;
const MIN_MARK = 4;

const {
  points,
  label,
  downtimes = [],
} = defineProps<{ points: OnlinePoint[]; label: string; downtimes?: Downtime[] }>();
const gradientId = `online-fill-${useId()}`;

const span = computed(() => {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  const start = Date.parse(first.at);
  return { start, length: Math.max(Date.parse(last.at) - start, 1) };
});

const coordinates = computed(() => {
  const range = span.value;
  if (range === null) {
    return [];
  }
  const values = points.map((point) => point.online);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const height = Math.max(max - min, 1);
  return points.map((point) => {
    const x = ((Date.parse(point.at) - range.start) / range.length) * WIDTH;
    const y = PADDING + (1 - (point.online - min) / height) * (HEIGHT - PADDING * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
});

const line = computed(() => `M${coordinates.value.join(' L')}`);
const area = computed(
  () => `${line.value} L${String(WIDTH)},${String(HEIGHT)} L0,${String(HEIGHT)} Z`,
);

const marks = computed(() => {
  const range = span.value;
  if (range === null) {
    return [];
  }
  const end = range.start + range.length;
  return downtimes.flatMap((item, index) => {
    const from = Math.max(Date.parse(item.from), range.start);
    const to = Math.min(item.to === null ? end : Date.parse(item.to), end);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
      return [];
    }
    const width = Math.max(((to - from) / range.length) * WIDTH, MIN_MARK);
    const x = Math.min(((from - range.start) / range.length) * WIDTH, WIDTH - width);
    return [{ key: index, x, width }];
  });
});

const ticks = computed(() => {
  const range = span.value;
  if (range === null) {
    return [];
  }
  return Array.from({ length: TICKS }, (_, index) => ({
    key: index,
    left: `${String((index / TICKS) * 100)}%`,
    text: moscowTime(new Date(range.start + (range.length * index) / TICKS)),
  }));
});
</script>

<template>
  <div class="chart-box">
    <p v-if="coordinates.length === 0" class="empty">{{ ru.serverPage.chartEmpty }}</p>
    <template v-else>
      <svg
        class="chart"
        :viewBox="`0 0 ${String(WIDTH)} ${String(HEIGHT)}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="label"
      >
        <defs>
          <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop class="stop-top" offset="0" />
            <stop class="stop-bottom" offset="1" />
          </linearGradient>
        </defs>
        <g class="grid">
          <line x1="0" y1="30" :x2="WIDTH" y2="30" />
          <line x1="0" y1="60" :x2="WIDTH" y2="60" />
          <line x1="0" y1="90" :x2="WIDTH" y2="90" />
        </g>
        <path class="area" :d="area" :fill="`url(#${gradientId})`" />
        <path class="line" :d="line" />
        <rect
          v-for="mark in marks"
          :key="mark.key"
          class="downtime"
          :x="mark.x"
          y="0"
          :width="mark.width"
          :height="HEIGHT"
        />
      </svg>
      <div class="axis" aria-hidden="true">
        <span v-for="tick in ticks" :key="tick.key" :style="{ left: tick.left }">{{
          tick.text
        }}</span>
        <span class="now">{{ ru.serverPage.now }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chart {
  display: block;
  width: 100%;
  height: 120px;
}

.empty {
  display: grid;
  place-items: center;
  height: 120px;
  margin: 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.grid line {
  stroke: var(--mc-border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.stop-top {
  stop-color: var(--mc-accent);
  stop-opacity: 0.28;
}

.stop-bottom {
  stop-color: var(--mc-accent);
  stop-opacity: 0;
}

.line {
  fill: none;
  stroke: var(--mc-accent);
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.downtime {
  fill: var(--mc-danger);
  opacity: 0.55;
}

.axis {
  position: relative;
  height: 16px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
}

.axis span {
  position: absolute;
  top: 0;
}

.axis .now {
  right: 0;
}
</style>
