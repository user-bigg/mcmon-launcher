<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { ModGroup } from '@shared/mods';
import ModRow from '../components/ModRow.vue';
import ShaderModRow from '../components/ShaderModRow.vue';
import SiteErrorState from '../components/SiteErrorState.vue';
import SkelBar from '../components/SkelBar.vue';
import StateNotice from '../components/StateNotice.vue';
import { useMods } from '../composables/useMods';
import { modsGroups } from '../lib/mods';

const SKELETON_ROWS = 6;
const SPY_GAP = 48;

const mods = useMods();
const groups = computed(() =>
  mods.view.value === null ? [] : modsGroups(mods.view.value, mods.lastShaders.value),
);
const minecraft = computed(() => mods.view.value?.minecraft ?? null);

const root = useTemplateRef<HTMLElement>('root');
const bar = useTemplateRef<HTMLElement>('bar');
const current = ref<ModGroup | null>(null);
let scroller: HTMLElement | null = null;

function heading(group: ModGroup): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-mods-group="${group}"]`) ?? null;
}

function spy(): void {
  const line = (bar.value?.getBoundingClientRect().bottom ?? 0) + SPY_GAP;
  let seen: ModGroup | null = groups.value[0]?.group ?? null;
  for (const group of groups.value) {
    const top = heading(group.group)?.getBoundingClientRect().top;
    if (top !== undefined && top <= line) {
      seen = group.group;
    }
  }
  current.value = seen;
}

function jump(group: ModGroup): void {
  const target = heading(group);
  if (target === null || scroller === null) {
    return;
  }
  const offset = (bar.value?.offsetHeight ?? 0) + SPY_GAP;
  const top =
    target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top: top - offset });
  current.value = group;
  target.focus({ preventScroll: true });
}

watch(
  () => groups.value.map((group) => group.group).join(','),
  () => nextTick(spy),
);

onMounted(async () => {
  scroller = root.value?.closest<HTMLElement>('.lx-main') ?? null;
  scroller?.addEventListener('scroll', spy, { passive: true });
  if (mods.status.value !== 'loading') {
    void mods.load();
  }
  await nextTick();
  spy();
});

onBeforeUnmount(() => {
  scroller?.removeEventListener('scroll', spy);
});
</script>

<template>
  <div ref="root" class="lx-content mods">
    <h1 class="lx-h1">{{ ru.mods.title }}</h1>
    <p class="lx-sub">{{ ru.mods.sub }}</p>

    <div
      v-if="mods.status.value === 'loading' && mods.view.value === null"
      class="skeleton"
      data-loading
      role="status"
      :aria-label="ru.state.loading"
    >
      <SkelBar w="100%" :h="34" />
      <div class="lx-rows group-rows">
        <div v-for="index in SKELETON_ROWS" :key="index" class="lx-row">
          <div class="skel-lines">
            <SkelBar :w="180" :h="14" />
            <SkelBar :w="300" :h="12" />
          </div>
        </div>
      </div>
    </div>
    <SiteErrorState
      v-else-if="mods.view.value === null"
      class="spaced"
      :error="mods.error.value"
      @retry="mods.load()"
    />
    <StateNotice
      v-else-if="groups.length === 0"
      class="spaced"
      icon="puzzle"
      :title="ru.mods.empty"
    />
    <template v-else>
      <p v-if="mods.saveFailed.value" class="save-failed" role="alert" data-mods-error>
        {{ ru.mods.saveFailed }}
      </p>
      <nav ref="bar" class="jump" :aria-label="ru.mods.jump">
        <button
          v-for="group in groups"
          :key="group.group"
          type="button"
          :class="{ 'is-on': current === group.group }"
          :aria-current="current === group.group ? 'true' : undefined"
          :aria-label="
            fill(ru.mods.jumpLabel, { group: group.label, on: group.on, total: group.total })
          "
          @click="jump(group.group)"
        >
          {{ group.label }}
          <span class="lx-num">{{
            fill(ru.mods.jumpCount, { on: group.on, total: group.total })
          }}</span>
        </button>
      </nav>

      <section v-for="group in groups" :key="group.group" class="group">
        <h2 class="group-head" tabindex="-1" :data-mods-group="group.group">{{ group.label }}</h2>
        <div class="lx-rows group-rows">
          <ShaderModRow
            v-if="group.shaders !== null"
            :row="group.shaders"
            @choose="mods.setShaders($event)"
          />
          <ModRow
            v-for="mod in group.mods"
            :key="mod.slug"
            :mod="mod"
            :minecraft="minecraft"
            @toggle="mods.setEnabled(mod.slug, $event)"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.spaced {
  margin-top: 16px;
}

.skeleton {
  margin-top: 14px;
}

.skel-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.jump {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  gap: 2px;
  margin: 14px 0 0;
  padding: 3px;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface);
  box-shadow: 0 -12px 0 var(--mc-bg);
}

.jump button {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: calc(var(--mc-radius-sm) - 2px);
  background: transparent;
  color: var(--mc-text-muted);
  font-size: 13px;
  white-space: nowrap;
}

.jump button:hover {
  color: var(--mc-text);
}

.jump button.is-on {
  background: var(--mc-surface-3);
  color: var(--mc-text);
}

.jump button:focus-visible {
  outline: 2px solid var(--mc-accent);
  outline-offset: 1px;
}

.jump .lx-num {
  margin-left: 4px;
  color: var(--lx-text-faint);
}

.save-failed {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--mc-danger);
}

.group-head:focus-visible {
  outline: 2px solid var(--mc-accent);
  outline-offset: 2px;
  border-radius: var(--mc-radius-sm);
}

.group-head:focus:not(:focus-visible) {
  outline: none;
}

.group-head {
  margin: 18px 0 8px;
  font-family: var(--mc-font-body);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.group-rows {
  overflow: hidden;
}

.skeleton .group-rows {
  margin-top: 14px;
}
</style>
