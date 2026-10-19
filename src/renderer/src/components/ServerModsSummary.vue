<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue';
import type { ServerCard } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { useCatalog } from '../composables/useCatalog';
import { useLibrary } from '../composables/useLibrary';
import { useMods, useServerMods } from '../composables/useMods';
import { useSite } from '../composables/useSite';
import { useWithoutMods } from '../composables/useWithoutMods';
import {
  namesText,
  playedServerMods,
  serverModRows,
  serverModsBytes,
  SUMMARY_NAMES,
} from '../lib/mods';
import { serverSkinsPreview } from '../lib/skins';
import { formatModSize } from '../lib/units';
import BiIcon from './BiIcon.vue';
import UiToggle from './UiToggle.vue';

const { card } = defineProps<{ card: ServerCard }>();

const mods = useMods();
const catalog = useCatalog();
const library = useLibrary();
const site = useSite();
const popId = useId();
const root = useTemplateRef<HTMLElement>('root');
const toggle = useTemplateRef<HTMLButtonElement>('toggle');
const open = ref(false);

const plan = useServerMods(() =>
  card.launch.kind === 'direct' ? { serverId: card.id, minecraft: card.launch.minecraft } : null,
);
const withoutSkins = useWithoutMods(() => `server-${String(card.id)}`);
const skins = computed(() => serverSkinsPreview(card, site.skinMod.value, withoutSkins.off.value));
const skinsSwitch = computed(() => skins.value === 'on' || skins.value === 'user');

const overrides = ref(new Map<string, boolean>());
const saveFailed = ref(false);
const rows = computed(() =>
  (plan.view.value?.installs === true ? serverModRows(plan.view.value) : []).map((row) => {
    const on = overrides.value.get(row.slug);
    return on === undefined ? row : { ...row, on };
  }),
);
const unknownRequired = computed(() => (plan.view.value?.unknownRequired.length ?? 0) > 0);
const shown = computed(() => rows.value.length > 0 || unknownRequired.value);

const bytes = computed(() => {
  const mine = serverModsBytes(rows.value);
  const estimate = library.hasServer(card.id) ? undefined : catalog.estimate(card.id);
  return estimate === undefined ? mine : mine + estimate.downloadBytes;
});

const text = computed(() => {
  const played = playedServerMods(rows.value);
  if (played.length === 0) {
    return ru.mods.summaryRules;
  }
  const names = namesText(
    played.map((row) => row.title),
    { limit: SUMMARY_NAMES },
  );
  if (bytes.value <= 0) {
    return fill(ru.mods.summary, { mods: names });
  }
  return fill(ru.mods.summarySized, { mods: names, size: formatModSize(bytes.value) });
});

async function setOptional(slug: string, on: boolean): Promise<void> {
  saveFailed.value = false;
  overrides.value = new Map(overrides.value).set(slug, on);
  const saved = await mods.setServerOptional(card.id, slug, on);
  await plan.reload();
  const next = new Map(overrides.value);
  next.delete(slug);
  overrides.value = next;
  saveFailed.value = !saved;
}

function close(): void {
  open.value = false;
}

function onDocument(event: MouseEvent): void {
  if (event.target instanceof Node && root.value?.contains(event.target) !== true) {
    close();
  }
}

function onEscape(event: KeyboardEvent): void {
  if (!open.value) {
    return;
  }
  event.stopPropagation();
  close();
  toggle.value?.focus();
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (open.value && next instanceof Node && root.value?.contains(next) !== true) {
    close();
  }
}

watch(open, (value) => {
  if (value) {
    document.addEventListener('mousedown', onDocument);
  } else {
    document.removeEventListener('mousedown', onDocument);
    saveFailed.value = false;
  }
});

watch(
  () => card.id,
  () => {
    close();
  },
);

onBeforeUnmount(close);
</script>

<template>
  <div
    v-if="shown"
    ref="root"
    class="mods-summary"
    data-server-mods
    @keydown.esc="onEscape"
    @focusout="onFocusOut"
  >
    <button
      ref="toggle"
      type="button"
      class="summary"
      :class="{ 'is-open': open }"
      :title="text"
      :aria-expanded="open"
      :aria-controls="open ? popId : undefined"
      @click="open = !open"
    >
      <span class="summary-text">{{ text }}</span>
      <BiIcon :name="open ? 'chevron-up' : 'chevron-down'" />
    </button>
    <div
      v-if="open"
      :id="popId"
      class="pop"
      role="group"
      :aria-label="ru.mods.serverList"
      data-server-mods-list
    >
      <div v-for="row in rows" :key="row.slug" class="pop-row" :data-server-mod="row.slug">
        <div class="pop-text">
          <b>{{ row.title }}</b>
          <span>{{ row.note }}</span>
        </div>
        <span
          v-if="row.kind === 'locked'"
          class="mark"
          role="img"
          :aria-label="ru.mods.requiredLock"
          :title="ru.mods.requiredLock"
        >
          <BiIcon name="lock-fill" />
        </span>
        <span
          v-else-if="row.kind === 'forbidden'"
          class="mark"
          role="img"
          :aria-label="ru.mods.forbiddenMark"
        >
          <BiIcon name="slash-circle" />
        </span>
        <UiToggle
          v-else
          :model-value="row.on"
          :label="row.title"
          :disabled="!row.available || overrides.has(row.slug)"
          @update:model-value="setOptional(row.slug, $event)"
        />
      </div>
      <div v-if="skinsSwitch" class="pop-row" data-server-mod="skins">
        <div class="pop-text">
          <b>{{ ru.mods.skins }}</b>
          <span>{{ ru.mods.optional }}</span>
        </div>
        <UiToggle
          :model-value="!withoutSkins.off.value"
          :label="ru.mods.skins"
          @update:model-value="withoutSkins.set(!$event)"
        />
      </div>
      <p v-if="unknownRequired" class="pop-note">{{ ru.mods.unknownRequired }}</p>
      <p v-if="saveFailed" class="pop-note" role="alert" data-server-mods-error>
        {{ ru.mods.saveFailed }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.mods-summary {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
  padding-top: 3px;
}

.summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--mc-text-muted);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  text-decoration: underline dotted;
  text-decoration-color: var(--mc-text-dim);
  text-underline-offset: 3px;
}

.summary:hover,
.summary.is-open {
  color: var(--mc-text);
}

.summary-text {
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.summary .bi {
  font-size: 11px;
}

.summary:focus-visible {
  outline: 2px solid var(--mc-accent);
  outline-offset: 2px;
  border-radius: var(--mc-radius-sm);
}

.pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  width: 300px;
  padding: 6px;
  border-radius: var(--mc-radius);
  border: 1px solid var(--mc-border-strong);
  background: var(--mc-surface-2);
  box-shadow: var(--mc-shadow);
}

.pop-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
}

.pop-row + .pop-row {
  border-top: 1px solid var(--mc-border);
}

.pop-text {
  flex: 1;
  min-width: 0;
}

.pop-text b {
  display: block;
  font-size: 14px;
  font-weight: 600;
}

.pop-text span {
  font-size: 12px;
  color: var(--mc-text-muted);
}

.mark {
  display: grid;
  place-items: center;
  width: 34px;
  font-size: 14px;
  color: var(--mc-text-muted);
}

.pop-note {
  margin: 0;
  padding: 9px 10px;
  border-top: 1px solid var(--mc-border);
  font-size: 12px;
  color: var(--mc-text-muted);
}
</style>
