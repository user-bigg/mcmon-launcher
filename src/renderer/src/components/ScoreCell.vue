<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import { compactCount, countOf, fill, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import BiIcon from './BiIcon.vue';

const { energy, votes } = defineProps<{ energy: number; votes: number }>();

const TIP_GAP_PX = 8;
const TIP_LEAD_PX = 24;
const EDGE_PX = 12;

const root = useTemplateRef<HTMLElement>('root');
const tip = useTemplateRef<HTMLElement>('tip');
const anchor = ref<{ left: number; top: number } | null>(null);
let outside: AbortController | null = null;

const parts = computed(() => ({ energy: Math.max(0, energy), votes: Math.max(0, votes) }));
const total = computed(() => parts.value.energy + parts.value.votes);
const tone = computed(() => {
  if (total.value === 0) {
    return 'none';
  }
  return parts.value.energy >= parts.value.votes ? 'energy' : 'votes';
});
const energyText = computed(() =>
  fill(ru.server.scoreEnergy, { energy: formatNumber(parts.value.energy) }),
);
const votesText = computed(() => countOf(parts.value.votes, ru.plural.votes));
const label = computed(() =>
  total.value === 0
    ? ru.server.scoreEmpty
    : fill(ru.server.scoreLabel, {
        total: formatNumber(total.value),
        energy: formatNumber(parts.value.energy),
        votes: votesText.value,
      }),
);
const tipStyle = computed(() =>
  anchor.value === null
    ? undefined
    : { left: `${String(anchor.value.left)}px`, top: `${String(anchor.value.top)}px` },
);

function onOutsidePress(event: PointerEvent): void {
  const inside = (element: HTMLElement | null): boolean =>
    event.target instanceof Node && element?.contains(event.target) === true;
  if (inside(root.value) || inside(tip.value)) {
    return;
  }
  hide();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    hide();
  }
}

function watchOutside(): void {
  outside?.abort();
  outside = new AbortController();
  const { signal } = outside;
  window.addEventListener('pointerdown', onOutsidePress, { capture: true, signal });
  window.addEventListener('keydown', onKey, { capture: true, signal });
  window.addEventListener('scroll', hide, { capture: true, signal });
  window.addEventListener('resize', hide, { signal });
}

function isOpen(): boolean {
  return anchor.value !== null;
}

function toggle(): void {
  if (!isOpen()) {
    void show();
  } else {
    hide();
  }
}

async function show(): Promise<void> {
  const rect = root.value?.getBoundingClientRect();
  if (rect === undefined) {
    return;
  }
  const top = rect.top - TIP_GAP_PX;
  anchor.value = { left: rect.left - TIP_LEAD_PX, top };
  watchOutside();
  await nextTick();
  if (tip.value === null || !isOpen()) {
    return;
  }
  const limit = window.innerWidth - tip.value.offsetWidth - EDGE_PX;
  const height = tip.value.offsetHeight;
  anchor.value = {
    left: Math.max(EDGE_PX, Math.min(rect.left - TIP_LEAD_PX, limit)),
    top: top - height < EDGE_PX ? rect.bottom + TIP_GAP_PX + height : top,
  };
}

function hide(): void {
  anchor.value = null;
  outside?.abort();
  outside = null;
}

onBeforeUnmount(hide);
</script>

<template>
  <button
    ref="root"
    type="button"
    class="score"
    :class="`is-${tone}`"
    :data-score="tone"
    :aria-expanded="anchor !== null"
    @click.stop="toggle"
    @blur="hide"
  >
    <span class="score-value" aria-hidden="true">{{ compactCount(total) }}</span>
    <span class="lx-visually-hidden">{{ label }}</span>
    <span class="score-line" aria-hidden="true">
      <span
        v-if="parts.energy > 0"
        class="score-part is-energy"
        :style="{ flexGrow: parts.energy }"
      />
      <span v-if="parts.votes > 0" class="score-part is-votes" :style="{ flexGrow: parts.votes }" />
    </span>
    <Teleport to="body">
      <span
        v-if="anchor !== null"
        ref="tip"
        class="score-tip"
        :class="`is-${tone}`"
        :style="tipStyle"
        aria-hidden="true"
        @mousedown.prevent
        @click.stop="hide"
      >
        <template v-if="total > 0">
          <span class="tip-total">{{ formatNumber(total) }}</span>
          <span class="tip-parts">
            <span>=</span>
            <span class="tip-energy"><BiIcon name="lightning-charge-fill" />{{ energyText }}</span>
            <span>+</span>
            <span class="tip-votes"><BiIcon name="hand-thumbs-up-fill" />{{ votesText }}</span>
          </span>
        </template>
        <span v-else class="tip-empty">{{ ru.server.scoreEmpty }}</span>
      </span>
    </Teleport>
  </button>
</template>

<style scoped>
.score {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.score-value {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.is-energy > .score-value,
.is-energy > .tip-total,
.tip-energy {
  color: var(--mc-gold);
}

.is-votes > .score-value,
.is-votes > .tip-total,
.tip-votes {
  color: var(--mc-votes);
}

.is-none > .score-value {
  color: var(--mc-text-dim);
}

.score-line {
  display: flex;
  gap: 2px;
  height: 2px;
}

.is-none > .score-line {
  background: var(--mc-border);
}

.score-part {
  flex-basis: 0;
  min-width: 4px;
}

.score-part.is-energy {
  background: var(--mc-gold);
}

.score-part.is-votes {
  background: var(--mc-votes);
}

.score-tip {
  position: fixed;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-2);
  box-shadow: var(--mc-shadow);
  white-space: nowrap;
  cursor: pointer;
  translate: 0 -100%;
  font-variant-numeric: tabular-nums;
}

.tip-total {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
}

.tip-parts {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.tip-energy,
.tip-votes {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.tip-empty {
  font-size: 13px;
  color: var(--mc-text-muted);
}
</style>
