<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { hostSystemOf } from '@shared/host-system';
import { urlHost } from '@shared/links';
import { JAVA_RANGES, type AutostartView, type JavaRange } from '@shared/system';
import { statusVersion } from '@shared/update';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import BiIcon from '../components/BiIcon.vue';
import FillText from '../components/FillText.vue';
import type { IconName } from '../components/icons';
import RamSlider from '../components/RamSlider.vue';
import SettingsAbout from '../components/SettingsAbout.vue';
import SettingsAlerts from '../components/SettingsAlerts.vue';
import SettingsPrivacy from '../components/SettingsPrivacy.vue';
import TagChip from '../components/TagChip.vue';
import ProgressBar from '../components/ProgressBar.vue';
import UiButton from '../components/UiButton.vue';
import UiSelect from '../components/UiSelect.vue';
import UiToggle from '../components/UiToggle.vue';
import { CHANNELS, SPEED_LIMITS, WHILE_GAME, useSettings } from '../composables/useSettings';
import { useLauncher } from '../composables/context';
import { useSite } from '../composables/useSite';
import { useUpdates } from '../composables/useUpdates';
import { memoryHint } from '../lib/memory-hint';
import { buildTitle, updateStatusText } from '../lib/update-status';

type SectionKey = 'game' | 'java' | 'launcher' | 'updates' | 'storage' | 'privacy' | 'about';

const sections: { key: SectionKey; icon: IconName; label: string }[] = [
  { key: 'game', icon: 'controller', label: ru.settings.game },
  { key: 'java', icon: 'cup-hot', label: ru.settings.java },
  { key: 'launcher', icon: 'window', label: ru.settings.launcher },
  { key: 'updates', icon: 'arrow-repeat', label: ru.settings.updates },
  { key: 'storage', icon: 'hdd', label: ru.settings.storage },
  { key: 'privacy', icon: 'shield-lock', label: ru.settings.privacy },
  { key: 'about', icon: 'info-circle', label: ru.settings.about },
];

const { state, machine, flush } = useSettings();
const system = hostSystemOf(navigator.platform);
const updates = useUpdates();
const route = useRoute();
const blockedText = { game: ru.update.blockedGame, install: ru.update.blockedInstall } as const;
const siteLinks = useSite().links;
const officialHost = computed(() => urlHost(siteLinks.value.launcher) ?? '');
const { api } = useLauncher();
const totalMb = ref<number>();
const hint = computed(() => memoryHint(totalMb.value));
const installedJava = ref<readonly number[]>();

onMounted(async () => {
  const result = await api.system.memory().catch(() => undefined);
  if (result?.ok === true) {
    totalMb.value = result.value.totalMb;
  }
});

onMounted(async () => {
  const result = await api.system.java().catch(() => undefined);
  if (result?.ok === true) {
    installedJava.value = result.value.installed;
  }
});

const autostartView = ref<AutostartView>('on');

async function readAutostart(): Promise<void> {
  const result = await api.system.autostart().catch(() => undefined);
  if (result?.ok === true) {
    autostartView.value = result.value.view;
  }
}

async function enableAutostart(): Promise<void> {
  const result = await api.system.enableAutostart().catch(() => undefined);
  if (result?.ok === true) {
    autostartView.value = result.value.view;
  }
}

function onWindowFocus(): void {
  void readAutostart();
}

onMounted(() => {
  void readAutostart();
  window.addEventListener('focus', onWindowFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus);
});

watch(
  () => state.autostart,
  () => {
    void flush().then(readAutostart);
  },
);

const autostartBlocked = computed(() => state.autostart && autostartView.value === 'blocked');

// Switched off in the Task Manager, the setting stays on in the launcher; a click on the
// unchecked switch then asks main to take the Task Manager mark off.
const autostartOn = computed({
  get: () => state.autostart && !autostartBlocked.value,
  set: (on: boolean) => {
    if (on && state.autostart) {
      void enableAutostart();
    } else {
      state.autostart = on;
    }
  },
});

const current = ref<SectionKey>('game');

function resolutionLabel(value: string): string {
  const [width = '', height = ''] = value.split('x');
  return fill(ru.settings.resolutionValue, { width, height });
}

const resolutionOptions = machine.resolutions.map((value) => ({
  value,
  label: resolutionLabel(value),
}));
const whileGameOptions = WHILE_GAME.map((value) => ({
  value,
  label:
    value === 'minimize'
      ? ru.settings.whileGameOptions.minimize[hostSystemOf(navigator.platform)]
      : ru.settings.whileGameOptions[value],
}));
const speedOptions = SPEED_LIMITS.map((value) => ({
  value,
  label: ru.settings.speedOptions[value],
}));
const channelOptions = CHANNELS.map((value) => ({
  value,
  label: ru.settings.channelOptions[value],
}));

function javaRange(entry: JavaRange): string {
  if (entry.to === null) {
    return fill(ru.settings.javaNewer, { from: entry.from ?? '' });
  }
  if (entry.from === null) {
    return fill(ru.settings.javaOlder, { to: entry.to });
  }
  return fill(ru.settings.javaRange, { from: entry.from, to: entry.to });
}

function show(key: SectionKey): void {
  current.value = key;
  document.getElementById(`settings-${key}`)?.scrollIntoView({ block: 'start' });
}

function showAsked(section: unknown): void {
  const asked = sections.find((item) => item.key === section);
  if (asked !== undefined) {
    show(asked.key);
  }
}

const SPY_OFFSET_PX = 96;
let spyFrame = 0;

function scroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.lx-main');
}

function spy(): void {
  spyFrame = 0;
  const main = scroller();
  if (main === null) {
    return;
  }
  const atBottom = main.scrollTop + main.clientHeight >= main.scrollHeight - 2;
  const lastSection = sections.at(-1);
  if (atBottom && main.scrollTop > 0 && lastSection !== undefined) {
    current.value = lastSection.key;
    return;
  }
  const line = main.getBoundingClientRect().top + SPY_OFFSET_PX;
  let active = sections[0]?.key ?? current.value;
  for (const section of sections) {
    const top = document.getElementById(`settings-${section.key}`)?.getBoundingClientRect().top;
    if (top !== undefined && top <= line) {
      active = section.key;
    }
  }
  current.value = active;
}

function onScroll(): void {
  if (spyFrame === 0) {
    spyFrame = requestAnimationFrame(spy);
  }
}

onMounted(() => {
  scroller()?.addEventListener('scroll', onScroll, { passive: true });
  showAsked(route.query.section);
});

watch(() => route.query.section, showAsked);

onBeforeUnmount(() => {
  scroller()?.removeEventListener('scroll', onScroll);
  cancelAnimationFrame(spyFrame);
});

const update = computed(() => {
  const value = updates.state.value;
  const { status } = value;
  const offered = status.kind === 'available' || status.kind === 'ready';
  return {
    title: buildTitle(value.current),
    text: updateStatusText(value),
    alert: status.kind === 'error',
    rejected: status.kind === 'error' && status.code === 'signature',
    manual:
      status.kind === 'error' &&
      (status.code === 'move' || status.code === 'readonly' || status.code === 'install'),
    canCheck: updates.canCheck.value,
    version: offered ? statusVersion(status) : null,
    notes: offered ? status.notes : null,
    percent: status.kind === 'downloading' ? status.percent : null,
    canDownload: status.kind === 'available',
    ready: status.kind === 'ready',
    skipped: updates.skipped.value,
    blocked: value.blocked === null ? null : blockedText[value.blocked],
  };
});

function restartNow(): void {
  if (update.value.blocked === null) {
    void updates.restart();
  }
}
</script>

<template>
  <div class="lx-content">
    <h1 class="lx-h1">{{ ru.settings.title }}</h1>
    <p class="lx-sub">{{ ru.settings.subtitle }}</p>

    <div class="layout">
      <nav class="subnav" :aria-label="ru.settings.sections">
        <button
          v-for="section in sections"
          :key="section.key"
          type="button"
          :class="{ 'is-active': current === section.key }"
          :aria-current="current === section.key ? 'true' : undefined"
          @click="show(section.key)"
        >
          <BiIcon :name="section.icon" />{{ section.label }}
        </button>
      </nav>

      <div>
        <section id="settings-game" class="group">
          <h2>{{ ru.settings.memory }}</h2>
          <p v-if="!state.autoMemory" data-memory="note">{{ ru.settings.memoryNote }}</p>
          <div class="lx-rows">
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.memoryAuto }}</div>
                <div class="lx-row-desc">{{ ru.settings.memoryAutoNote }}</div>
              </div>
              <UiToggle v-model="state.autoMemory" :label="ru.settings.memoryAuto" />
            </div>
            <div v-if="!state.autoMemory" class="ram" data-memory="manual">
              <div class="ram-head">
                <div>
                  <span class="ram-value">{{ state.ramGb }}</span
                  >&nbsp;<span class="lx-muted">{{ ru.units.gbShort }}</span>
                </div>
                <TagChip tone="accent" icon="stars">
                  {{ fill(ru.settings.memoryRecommended, machine.recommended) }}
                </TagChip>
              </div>
              <RamSlider
                v-model="state.ramGb"
                :min="machine.ramMinGb"
                :max="machine.ramMaxGb"
                :recommended="machine.recommended"
                :label="ru.settings.memoryValue"
              />
              <div v-if="hint !== ''" class="ram-hint lx-faint">{{ hint }}</div>
            </div>
          </div>
        </section>

        <section class="group">
          <h2>{{ ru.settings.window }}</h2>
          <div class="lx-rows">
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.fullscreen }}</div>
              </div>
              <UiToggle v-model="state.fullscreen" :label="ru.settings.fullscreen" />
            </div>
            <div v-if="!state.fullscreen" class="lx-row" data-window="size">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.resolution }}</div>
              </div>
              <UiSelect
                v-model="state.resolution"
                :options="resolutionOptions"
                :width="200"
                :label="ru.settings.resolution"
              />
            </div>
          </div>
        </section>

        <section id="settings-java" class="group">
          <h2>{{ ru.settings.java }}</h2>
          <p>{{ ru.settings.javaNote }}</p>
          <div class="lx-rows">
            <div
              v-for="entry in JAVA_RANGES"
              :key="entry.major"
              class="java"
              :data-java="entry.major"
            >
              <span class="java-name lx-num">{{
                fill(ru.settings.javaName, { major: entry.major })
              }}</span>
              <span class="lx-muted lx-num">{{ javaRange(entry) }}</span>
              <template v-if="installedJava !== undefined">
                <span v-if="installedJava.includes(entry.major)" class="installed">
                  <BiIcon name="check-circle-fill" />{{ ru.settings.javaInstalled }}
                </span>
                <span v-else class="lx-faint small">{{ ru.settings.javaOnDemand }}</span>
              </template>
            </div>
          </div>
        </section>

        <section id="settings-launcher" class="group">
          <h2>{{ ru.settings.launcher }}</h2>
          <div class="lx-rows">
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.autostart[system] }}</div>
                <div class="lx-row-desc">{{ ru.settings.autostartNote[system] }}</div>
                <div v-if="autostartBlocked" class="lx-row-desc blocked" data-autostart-blocked>
                  <BiIcon name="exclamation-circle" />{{ ru.settings.autostartBlocked }}
                </div>
              </div>
              <UiToggle v-model="autostartOn" :label="ru.settings.autostart[system]" />
            </div>
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.whileGame }}</div>
              </div>
              <UiSelect
                v-model="state.whileGame"
                :options="whileGameOptions"
                :width="200"
                :label="ru.settings.whileGame"
              />
            </div>
          </div>
          <SettingsAlerts />
        </section>

        <section id="settings-updates" class="group">
          <h2>{{ ru.settings.updates }}</h2>
          <p>{{ ru.settings.updatesNote }}</p>
          <div class="lx-rows">
            <div class="lx-row">
              <div class="lx-row-text">
                <div v-if="update.title !== null" class="lx-row-title lx-num">
                  {{ update.title }}
                </div>
                <div
                  v-if="update.alert"
                  class="lx-row-desc lx-num selectable"
                  :class="{ 'is-danger': update.rejected }"
                  role="alert"
                >
                  <BiIcon v-if="update.rejected" name="exclamation-triangle" />
                  <FillText :text="update.text">
                    <template #site>
                      <span class="lx-mono domain">{{ officialHost }}</span>
                    </template>
                  </FillText>
                </div>
                <div
                  :class="update.alert ? 'lx-visually-hidden' : 'lx-row-desc lx-num'"
                  role="status"
                >
                  {{ update.alert ? '' : update.text }}
                </div>
                <ProgressBar
                  v-if="update.percent !== null"
                  class="update-progress"
                  :value="update.percent"
                  :label="ru.settings.updateProgress"
                  thin
                />
              </div>
              <UiButton
                v-if="update.rejected || update.manual"
                size="sm"
                icon="box-arrow-up-right"
                :href="siteLinks.launcher"
              >
                {{ ru.settings.officialLink }}
              </UiButton>
              <UiButton
                size="sm"
                icon="arrow-clockwise"
                :disabled="!update.canCheck"
                @click="updates.check()"
              >
                {{ ru.settings.updateCheck }}
              </UiButton>
            </div>
            <div v-if="update.version !== null" class="lx-row" data-update="offer">
              <div class="lx-row-text">
                <div class="lx-row-title">
                  {{ fill(ru.settings.updateNotes, { version: update.version }) }}
                </div>
                <div v-if="update.notes !== null" class="lx-row-desc notes selectable">
                  {{ update.notes }}
                </div>
                <div v-if="update.ready && update.blocked !== null" class="lx-row-desc">
                  {{ update.blocked }}
                </div>
                <div v-else-if="update.ready" class="lx-row-desc">
                  {{ ru.settings.updateRestartNote }}
                </div>
              </div>
              <div class="update-actions">
                <UiButton v-if="update.skipped" size="sm" @click="updates.unskip(update.version)">
                  {{ ru.settings.updateUnskip }}
                </UiButton>
                <UiButton v-else size="sm" @click="updates.skip(update.version)">
                  {{ ru.settings.updateSkip }}
                </UiButton>
                <UiButton
                  v-if="update.canDownload && (update.skipped || !state.autoDownload)"
                  size="sm"
                  variant="primary"
                  icon="cloud-arrow-down"
                  @click="updates.download()"
                >
                  {{ ru.settings.updateDownload }}
                </UiButton>
                <UiButton
                  v-if="update.ready"
                  size="sm"
                  variant="play"
                  icon="arrow-repeat"
                  :disabled="update.blocked !== null"
                  @click="restartNow"
                >
                  {{ ru.update.restart }}
                </UiButton>
              </div>
            </div>
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.autoDownload }}</div>
                <div class="lx-row-desc">{{ ru.settings.autoDownloadNote }}</div>
              </div>
              <UiToggle v-model="state.autoDownload" :label="ru.settings.autoDownload" />
            </div>
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.channel }}</div>
                <div class="lx-row-desc">{{ ru.settings.channelNote }}</div>
              </div>
              <UiSelect
                v-model="state.channel"
                :options="channelOptions"
                :label="ru.settings.channel"
                :width="130"
              />
            </div>
          </div>
        </section>

        <section id="settings-storage" class="group">
          <h2>{{ ru.settings.storage }}</h2>
          <div class="lx-rows">
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.folder }}</div>
              </div>
              <span class="field path lx-mono selectable">{{ machine.folder }}</span>
              <UiButton size="sm">{{ ru.settings.change }}</UiButton>
            </div>
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.settings.speed }}</div>
                <div class="lx-row-desc">{{ ru.settings.speedNote }}</div>
              </div>
              <UiSelect
                v-model="state.speed"
                :options="speedOptions"
                :label="ru.settings.speed"
                :width="140"
              />
            </div>
          </div>
        </section>

        <section id="settings-privacy" class="group">
          <h2>{{ ru.settings.privacy }}</h2>
          <p>{{ ru.privacy.note }}</p>
          <SettingsPrivacy />
        </section>

        <section id="settings-about" class="group last">
          <h2>{{ ru.settings.about }}</h2>
          <SettingsAbout />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.blocked {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  color: var(--mc-warning);
}

.layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 28px;
  margin-top: 24px;
}

.subnav {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-self: start;
}

.subnav button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: transparent;
  color: var(--mc-text-muted);
  font-size: 14px;
  text-align: left;
}

.subnav button:hover {
  background: var(--mc-surface);
  color: var(--mc-text);
}

.subnav button:focus-visible {
  outline-offset: -2px;
}

.subnav button.is-active {
  background: var(--mc-surface-2);
  color: var(--mc-text);
}

.domain {
  white-space: nowrap;
}

.group {
  margin-bottom: 26px;
  scroll-margin-top: 24px;
}

.group.last {
  margin-bottom: 0;
}

.group h2 {
  margin: 0 0 4px;
  font-family: var(--mc-font-body);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}

.group > p {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.group > h2 + .lx-rows {
  margin-top: 8px;
}

.ram {
  padding: 16px;
  border-top: 1px solid var(--mc-border);
}

.ram-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.ram-value {
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.ram-hint {
  margin-top: 8px;
  font-size: 12px;
}

.field {
  display: inline-flex;
  align-items: center;
  width: 200px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg);
  border: 1px solid var(--mc-border);
  font-size: 13px;
  color: var(--mc-text-muted);
}

.field.path {
  width: auto;
}

.java {
  display: grid;
  grid-template-columns: 70px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--mc-border);
  font-size: 13px;
}

.java-name {
  font-weight: 600;
}

.installed {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--mc-accent);
}

.small {
  font-size: 13px;
}

.update-progress {
  max-width: 320px;
  margin-top: 8px;
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.notes {
  white-space: pre-line;
}

.is-danger {
  color: var(--mc-danger);
}
</style>
