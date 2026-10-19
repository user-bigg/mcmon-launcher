<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ru } from '@shared/i18n/ru';
import type { LookError } from '@shared/look';
import BiIcon from '../components/BiIcon.vue';
import type { IconName } from '../components/icons';
import SiteErrorState from '../components/SiteErrorState.vue';
import SkelBar from '../components/SkelBar.vue';
import SkinCard from '../components/SkinCard.vue';
import SkinFigure from '../components/SkinFigure.vue';
import StateNotice from '../components/StateNotice.vue';
import UiButton from '../components/UiButton.vue';
import UiTabs, { type TabOption } from '../components/UiTabs.vue';
import { useAccounts } from '../composables/useAccounts';
import { useWardrobe } from '../composables/useWardrobe';
import { lookChange, lookErrorText, skinTags, wornPresetId } from '../lib/wardrobe';

type Tab = 'skins' | 'capes';
type View = 'loading' | 'guest' | 'no-nick' | 'error' | 'ready';

interface Status {
  kind: 'failure' | 'wait' | 'saved' | 'tried' | 'hint';
  icon: IconName | null;
  text: string;
}

const PANEL = 'skins-panel';
const SKELETON_CARDS = 14;

const accounts = useAccounts();
const wardrobe = useWardrobe();

const settled = ref(false);
const tab = ref<Tab>('skins');
const tag = ref<string | null>(null);
const pickedSkin = ref<string>();
const pickedCape = ref<string | null>();
const busy = ref(false);
const saved = ref(false);
const failure = ref<LookError | null>(null);

const mc = computed(() => accounts.mc.value);
const nick = computed(() => accounts.pinned.value?.name ?? null);
const allowed = computed(() => settled.value && mc.value !== null && nick.value !== null);

const view = computed<View>(() => {
  if (!settled.value) {
    return 'loading';
  }
  if (mc.value === null) {
    return 'guest';
  }
  if (nick.value === null) {
    return 'no-nick';
  }
  return wardrobe.status.value;
});

const skins = computed(() => wardrobe.presets.value?.skins ?? []);
const capes = computed(() => wardrobe.presets.value?.capes ?? []);
const wornSkin = computed(() => mc.value?.skin ?? null);
const wornCape = computed(() => mc.value?.cape ?? null);
const savedSkinId = computed(() => wornPresetId(skins.value, wornSkin.value));
const savedCapeId = computed(() => wornPresetId(capes.value, wornCape.value));

const shownSkinId = computed(() => pickedSkin.value ?? savedSkinId.value);
const shownCapeId = computed(() =>
  pickedCape.value === undefined ? savedCapeId.value : pickedCape.value,
);
const shownSkin = computed(() => skins.value.find((item) => item.id === shownSkinId.value) ?? null);
const shownCape = computed(() => capes.value.find((item) => item.id === shownCapeId.value) ?? null);
const keptSkin = computed(() => (pickedSkin.value === undefined ? wornSkin.value : null));
const keptCape = computed(() => (pickedCape.value === undefined ? wornCape.value : null));

const figureSkin = computed(() => shownSkin.value?.url ?? keptSkin.value?.url ?? null);
const figureCape = computed(() => shownCape.value?.url ?? keptCape.value?.url ?? null);
const figureSlim = computed(() => (shownSkin.value ?? keptSkin.value)?.model === 'slim');
const skinTitle = computed(() => {
  const outside = keptSkin.value === null ? ru.skins.standard : ru.skins.offCatalog;
  return shownSkin.value?.title ?? outside;
});
const capeTitle = computed(() => {
  const outside = keptCape.value === null ? ru.skins.noCape : ru.skins.offCatalog;
  return shownCape.value?.title ?? outside;
});

const bareWorn = computed(() => wornCape.value === null);
const bareTried = computed(() => pickedCape.value === null && !bareWorn.value);
const bareShown = computed(
  () => pickedCape.value === null || (pickedCape.value === undefined && bareWorn.value),
);

const change = computed(() =>
  lookChange(
    { skin: pickedSkin.value, cape: pickedCape.value },
    { skin: savedSkinId.value, cape: savedCapeId.value, capeWorn: wornCape.value !== null },
  ),
);
const dirty = computed(() => change.value !== null);
const dressed = computed(() => wornSkin.value !== null || wornCape.value !== null);

const tags = computed(() => skinTags(skins.value));
const visibleSkins = computed(() => {
  const wanted = tag.value;
  return wanted === null ? skins.value : skins.value.filter((item) => item.tags.includes(wanted));
});

const tabs = computed<TabOption<Tab>[]>(() => [
  { value: 'skins', label: ru.skins.tabSkins, count: skins.value.length },
  { value: 'capes', label: ru.skins.tabCapes, count: capes.value.length },
]);

const license = computed(() => accounts.license.value !== null);

const status = computed<Status>(() => {
  const refused = failure.value;
  if (refused !== null) {
    return refused.code === 'rate_limited'
      ? { kind: 'wait', icon: 'clock-history', text: lookErrorText(refused) }
      : { kind: 'failure', icon: 'exclamation-triangle', text: lookErrorText(refused) };
  }
  if (saved.value) {
    return { kind: 'saved', icon: 'check2', text: ru.skins.saved };
  }
  if (dirty.value) {
    return { kind: 'tried', icon: null, text: ru.skins.tried };
  }
  return {
    kind: 'hint',
    icon: null,
    text: tab.value === 'capes' ? ru.skins.capesLead : ru.skins.skinsLead,
  };
});

function scrollChips(event: WheelEvent): void {
  const row = event.currentTarget;
  if (row instanceof HTMLElement && event.deltaY !== 0 && row.scrollWidth > row.clientWidth) {
    row.scrollLeft += event.deltaY;
    event.preventDefault();
  }
}

function touched(): void {
  saved.value = false;
  failure.value = null;
}

function forget(): void {
  pickedSkin.value = undefined;
  pickedCape.value = undefined;
}

function pickSkin(id: string): void {
  touched();
  pickedSkin.value = id === savedSkinId.value ? undefined : id;
}

function pickCape(id: string | null): void {
  touched();
  const same = id === savedCapeId.value && (id !== null || wornCape.value === null);
  pickedCape.value = same ? undefined : id;
}

function undo(): void {
  touched();
  forget();
}

async function send(action: () => Promise<LookError | null>): Promise<void> {
  if (busy.value) {
    return;
  }
  touched();
  busy.value = true;
  try {
    failure.value = await action();
  } finally {
    busy.value = false;
  }
  if (failure.value === null) {
    forget();
    saved.value = true;
  }
}

function save(): void {
  const wanted = change.value;
  if (wanted !== null) {
    void send(() => accounts.wear(wanted));
  }
}

function reset(): void {
  if (dressed.value) {
    void send(() => accounts.resetLook());
  } else {
    undo();
  }
}

watch(
  allowed,
  (open) => {
    if (open) {
      void wardrobe.load();
    }
  },
  { immediate: true },
);

watch(
  () => mc.value?.id,
  () => {
    undo();
  },
);

watch(tags, (known) => {
  if (tag.value !== null && !known.includes(tag.value)) {
    tag.value = null;
  }
});

onMounted(async () => {
  await accounts.ready;
  settled.value = true;
  void accounts.refreshMc();
});
</script>

<template>
  <div class="lx-content skins" :data-skins="view">
    <h1 class="lx-h1">{{ ru.skins.title }}</h1>
    <p class="lx-sub">{{ ru.skins.subtitle }}</p>

    <StateNotice
      v-if="view === 'guest'"
      class="state"
      icon="person"
      :title="ru.skins.guestTitle"
      :text="ru.skins.guestText"
    >
      <UiButton variant="primary" size="sm" to="/accounts">{{ ru.skins.guestAction }}</UiButton>
    </StateNotice>

    <StateNotice
      v-else-if="view === 'no-nick'"
      class="state"
      icon="person-badge"
      :title="ru.skins.noNickTitle"
      :text="ru.skins.noNickText"
    >
      <UiButton variant="primary" size="sm" to="/accounts">{{ ru.skins.noNickAction }}</UiButton>
    </StateNotice>

    <SiteErrorState
      v-else-if="view === 'error'"
      class="state"
      :error="wardrobe.error.value"
      @retry="wardrobe.load()"
    />

    <div v-else-if="view === 'loading'" class="layout" aria-busy="true">
      <span class="lx-visually-hidden" role="status">{{ ru.state.loading }}</span>
      <div class="lx-skel-frame stage-skel" />
      <div>
        <SkelBar w="100%" :h="38" />
        <div class="grid grid-skel">
          <SkelBar v-for="index in SKELETON_CARDS" :key="index" w="100%" :h="98" />
        </div>
      </div>
    </div>

    <div v-else class="layout">
      <section class="stage" :aria-label="ru.skins.title">
        <SkinFigure
          class="view"
          :skin="figureSkin"
          :slim="figureSlim"
          :standard="wardrobe.standardSkin.value"
          :cape="figureCape"
          :back="tab === 'capes'"
        />
        <dl class="worn">
          <div>
            <dt>{{ ru.skins.skin }}</dt>
            <dd data-worn="skin" :title="skinTitle">{{ skinTitle }}</dd>
          </div>
          <div>
            <dt>{{ ru.skins.cape }}</dt>
            <dd data-worn="cape" :title="capeTitle">{{ capeTitle }}</dd>
          </div>
        </dl>
        <button
          v-if="dressed || dirty"
          type="button"
          class="reset"
          :disabled="busy"
          data-skins-reset
          @click="reset"
        >
          <BiIcon name="arrow-counterclockwise" />
          {{ ru.skins.reset }}
        </button>
        <p class="nick">
          <b class="selectable">{{ nick }}</b>
          <small>{{ ru.skins.nick }}</small>
        </p>
        <p class="note">{{ ru.skins.note }}</p>
        <p v-if="license" class="note" data-skins-license>{{ ru.skins.licenseNote }}</p>
      </section>

      <div class="shelf">
        <div class="bar">
          <div class="bar-row">
            <UiTabs
              v-model="tab"
              class="bar-tabs"
              :tabs="tabs"
              :label="ru.skins.tabs"
              :panel="PANEL"
            />
            <UiButton v-if="dirty" size="sm" :disabled="busy" data-skins-undo @click="undo">
              {{ ru.skins.undo }}
            </UiButton>
            <UiButton
              v-if="dirty || busy"
              variant="primary"
              size="sm"
              :disabled="busy"
              data-skins-save
              @click="save"
            >
              {{ busy ? ru.skins.saving : ru.skins.wear }}
            </UiButton>
          </div>
          <p
            v-if="failure !== null"
            class="message"
            :class="`is-${status.kind}`"
            role="alert"
            data-skins-error
          >
            <BiIcon v-if="status.icon !== null" :name="status.icon" />
            <span>{{ status.text }}</span>
          </p>
          <p v-else class="message" :class="`is-${status.kind}`" role="status" data-skins-status>
            <BiIcon v-if="status.icon !== null" :name="status.icon" />
            <span>{{ status.text }}</span>
          </p>
        </div>

        <div :id="PANEL" role="tabpanel">
          <template v-if="tab === 'skins'">
            <div
              v-if="tags.length > 0"
              class="chips"
              role="group"
              :aria-label="ru.skins.tags"
              @wheel="scrollChips"
            >
              <button
                type="button"
                class="chip"
                :class="{ 'is-on': tag === null }"
                :aria-pressed="tag === null"
                @click="tag = null"
              >
                {{ ru.skins.allTags }}
              </button>
              <button
                v-for="item in tags"
                :key="item"
                type="button"
                class="chip"
                :class="{ 'is-on': tag === item }"
                :aria-pressed="tag === item"
                @click="tag = item"
              >
                {{ item }}
              </button>
            </div>
            <p v-if="skins.length === 0" class="empty" data-skins-empty>
              {{ ru.skins.skinsEmpty }}
            </p>
            <div v-else class="grid" data-grid="skins">
              <SkinCard
                v-for="item in visibleSkins"
                :key="item.id"
                kind="skin"
                :title="item.title"
                :url="item.url"
                :slim="item.model === 'slim'"
                :worn="item.id === savedSkinId"
                :tried="item.id === pickedSkin"
                :shown="item.id === shownSkinId"
                :fresh="item.isNew"
                :data-preset="item.id"
                @pick="pickSkin(item.id)"
              />
            </div>
          </template>
          <template v-else>
            <p v-if="capes.length === 0" class="empty" data-skins-empty>
              {{ ru.skins.capesEmpty }}
            </p>
            <div v-else class="grid" data-grid="capes">
              <SkinCard
                kind="cape"
                :title="ru.skins.noCape"
                :url="null"
                :worn="bareWorn"
                :tried="bareTried"
                :shown="bareShown"
                :fresh="false"
                data-preset-none
                @pick="pickCape(null)"
              />
              <SkinCard
                v-for="item in capes"
                :key="item.id"
                kind="cape"
                :title="item.title"
                :url="item.url"
                :worn="item.id === savedCapeId"
                :tried="item.id === pickedCape"
                :shown="item.id === shownCapeId"
                :fresh="item.isNew"
                :data-preset="item.id"
                @pick="pickCape(item.id)"
              />
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.state {
  margin-top: 16px;
  max-width: 560px;
}

.layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  margin-top: 16px;
}

.stage {
  position: sticky;
  top: 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 0 14px 14px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-surface);
  overflow: hidden;
}

.view {
  margin: 0 -14px;
}

.stage-skel {
  height: 520px;
}

.worn {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.worn div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.worn dt {
  flex: none;
}

.worn dd {
  display: -webkit-box;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--mc-text);
  text-align: right;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.reset {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--mc-text-muted);
  font-size: 13px;
  font-weight: 400;
}

.reset:hover:not(:disabled) {
  color: var(--mc-text);
  text-decoration: underline;
}

.reset:disabled {
  opacity: 0.55;
}

.nick {
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--mc-border);
}

.nick b {
  display: block;
  font-family: var(--mc-font-mono);
  font-size: 13px;
  font-weight: 600;
}

.nick small {
  display: block;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--mc-text-muted);
  text-wrap: pretty;
}

.bar {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: -12px 0 12px;
  padding-top: 12px;
  border-bottom: 1px solid var(--mc-border);
  background: var(--mc-bg);
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
}

.bar .bar-tabs {
  flex: 1;
  min-width: 0;
  border-bottom: 0;
}

.message {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  margin: 0;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.message span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message .bi {
  font-size: 14px;
}

.message.is-saved .bi {
  color: var(--mc-accent);
}

.message.is-wait {
  color: var(--mc-text);
}

.message.is-wait .bi {
  color: var(--mc-warning);
}

.message.is-failure {
  color: var(--mc-danger);
}

.chips {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(to right, var(--mc-text) calc(100% - 32px), transparent);
}

.chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex-shrink: 0;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--mc-border);
  border-radius: 999px;
  background: var(--mc-surface);
  color: var(--mc-text-muted);
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;
}

.chip:hover {
  border-color: var(--mc-border-strong);
  color: var(--mc-text);
}

.chip.is-on {
  background: var(--mc-accent-soft);
  border-color: color-mix(in srgb, var(--mc-accent) 35%, transparent);
  color: var(--mc-accent);
}

.chip:focus-visible {
  outline-offset: -2px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
  gap: 8px;
}

.grid-skel {
  margin-top: 16px;
}

.empty {
  margin: 0;
  padding: 28px 20px;
  border: 1px dashed var(--mc-border-strong);
  border-radius: var(--mc-radius);
  color: var(--mc-text-muted);
  text-align: center;
}
</style>
