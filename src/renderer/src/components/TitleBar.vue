<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { countOf, fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import logoUrl from '../assets/logo.svg';
import { useLauncher } from '../composables/context';
import { useAlerts } from '../composables/useAlerts';
import { useLaunch } from '../composables/useLaunch';
import { useUpdates } from '../composables/useUpdates';
import { isCommandLetter, isSlash, isTextField, modalOpen } from '../lib/keyboard';
import AlertsPanel from './AlertsPanel.vue';
import BiIcon from './BiIcon.vue';

defineProps<{ bare: boolean }>();

const { api } = useLauncher();
const launch = useLaunch();
const alerts = useAlerts();
const updates = useUpdates();
const blockedText = { game: ru.update.blockedGame, install: ru.update.blockedInstall } as const;
const route = useRoute();
const router = useRouter();
const maximized = ref(false);
const query = ref('');
const searchFocused = ref(false);
const searchInput = useTemplateRef<HTMLInputElement>('searchField');

const historyState = ref(router.options.history.state);
const canGoBack = computed(() => historyState.value.back !== null);
const canGoForward = computed(() => historyState.value.forward !== null);

watch(
  () => route.fullPath,
  () => {
    historyState.value = { ...router.options.history.state };
    closeAlerts(false);
  },
);

const alertsOpen = ref(false);
const alertsWrap = useTemplateRef<HTMLElement>('alertsWrap');
const alertsButton = useTemplateRef<HTMLButtonElement>('alertsButton');
const alertsPanel = useTemplateRef<HTMLElement>('alertsPanel');

function insideAlerts(target: EventTarget | null): boolean {
  return target instanceof Node && alertsWrap.value?.contains(target) === true;
}

function onAlertsOutside(event: Event): void {
  if (!insideAlerts(event.target)) {
    closeAlerts(false);
  }
}

function onAlertsKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !modalOpen(document)) {
    event.preventDefault();
    event.stopPropagation();
    closeAlerts(true);
  }
}

function onAlertsFocusOut(event: FocusEvent): void {
  if (event.relatedTarget !== null && !insideAlerts(event.relatedTarget)) {
    closeAlerts(false);
  }
}

function closeAlerts(refocus: boolean): void {
  if (!alertsOpen.value) {
    return;
  }
  alertsOpen.value = false;
  document.removeEventListener('pointerdown', onAlertsOutside, true);
  document.removeEventListener('keydown', onAlertsKeydown, true);
  if (refocus) {
    alertsButton.value?.focus();
  }
}

function keepAlertsFocus(): void {
  if (alertsOpen.value && !insideAlerts(document.activeElement)) {
    alertsPanel.value?.focus();
  }
}

async function toggleAlerts(): Promise<void> {
  if (alertsOpen.value) {
    closeAlerts(true);
    return;
  }
  alertsOpen.value = true;
  document.addEventListener('pointerdown', onAlertsOutside, true);
  document.addEventListener('keydown', onAlertsKeydown, true);
  void alerts.open();
  await nextTick();
  alertsPanel.value?.focus();
}

const install = computed(() => {
  const job = launch.job.value;
  if (!launch.installing.value || job === null) {
    return null;
  }
  const percent = launch.progress.value?.percent ?? 0;
  const to = `/launch/${String(job.serverId)}`;
  if (route.path === to) {
    return null;
  }
  return {
    to,
    name: job.name,
    percent,
    label: fill(ru.titlebar.activityLabel, { name: job.name, percent }),
  };
});

const update = computed(() => {
  const banner = updates.banner.value;
  if (banner?.kind === 'error' && banner.code === 'signature') {
    return { kind: 'rejected' as const };
  }
  if (banner?.kind === 'error') {
    return {
      kind: 'manual' as const,
      text:
        banner.version === null
          ? ru.update.manualAny
          : fill(ru.update.manual, { version: banner.version }),
    };
  }
  if (banner?.kind !== 'ready') {
    return null;
  }
  const blocked = updates.state.value.blocked;
  return {
    kind: 'ready' as const,
    text: fill(ru.update.ready, { version: banner.version }),
    short: fill(ru.update.readyShort, { version: banner.version }),
    blocked: blocked === null ? null : blockedText[blocked],
  };
});

function restartForUpdate(): void {
  if (update.value?.kind === 'ready' && update.value.blocked === null) {
    void updates.restart();
  }
}

const maximizeLabel = computed(() => (maximized.value ? ru.window.restore : ru.window.maximize));
const notificationsLabel = computed(() =>
  alerts.unread.value > 0
    ? fill(ru.titlebar.notificationsNew, { count: countOf(alerts.unread.value, ru.plural.fresh) })
    : ru.titlebar.notifications,
);

let unsubscribe: (() => void) | undefined;

function onHotkey(event: KeyboardEvent): void {
  if (modalOpen(document)) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const findKey = isCommandLetter(event, 'f');
  const slash = isSlash(event) && !isTextField(target);
  if (!findKey && !slash) {
    return;
  }
  event.preventDefault();
  searchInput.value?.focus();
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || modalOpen(document)) {
    return;
  }
  event.preventDefault();
  if (query.value !== '') {
    query.value = '';
    return;
  }
  searchInput.value?.blur();
}

onMounted(() => {
  unsubscribe = api.window.onMaximizedChanged((value) => {
    maximized.value = value;
  });
  void api.window.isMaximized().then((value) => {
    maximized.value = value;
  });
  window.addEventListener('keydown', onHotkey);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  closeAlerts(false);
  window.removeEventListener('keydown', onHotkey);
});

function search(): void {
  const q = query.value.trim();
  void router.push(q === '' ? '/servers' : { path: '/servers', query: { q } });
}
</script>

<template>
  <header class="titlebar">
    <div class="brand">
      <img class="logo" :src="logoUrl" alt="" />
      {{ ru.app.name }} <small>{{ ru.app.kind }}</small>
    </div>

    <div v-if="!bare" class="history">
      <button
        type="button"
        class="iconbtn"
        :aria-label="ru.titlebar.back"
        :title="ru.titlebar.back"
        :disabled="!canGoBack"
        @click="router.back()"
      >
        <BiIcon name="chevron-left" />
      </button>
      <button
        type="button"
        class="iconbtn"
        :aria-label="ru.titlebar.forward"
        :title="ru.titlebar.forward"
        :disabled="!canGoForward"
        @click="router.forward()"
      >
        <BiIcon name="chevron-right" />
      </button>
    </div>

    <div class="middle">
      <form v-if="!bare" class="search" role="search" @submit.prevent="search">
        <BiIcon name="search" />
        <input
          ref="searchField"
          v-model="query"
          type="search"
          :placeholder="ru.titlebar.search"
          :aria-label="ru.titlebar.search"
          aria-keyshortcuts="/ Control+F Meta+F"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
          @keydown="onSearchKeydown"
        />
        <kbd v-if="!searchFocused && query === ''" aria-hidden="true">{{
          ru.titlebar.searchHotkey
        }}</kbd>
      </form>
    </div>

    <div class="right">
      <template v-if="!bare">
        <div v-if="update?.kind === 'ready'" class="update" role="status">
          <BiIcon name="arrow-repeat" />
          <span class="update-text">{{ update.text }}</span>
          <span class="update-short" aria-hidden="true">{{ update.short }}</span>
          <button
            type="button"
            class="update-action"
            :aria-disabled="update.blocked === null ? undefined : 'true'"
            :aria-describedby="update.blocked === null ? undefined : 'titlebar-update-blocked'"
            :title="update.blocked ?? undefined"
            @click="restartForUpdate"
          >
            {{ ru.update.restart }}
          </button>
          <span
            v-if="update.blocked !== null"
            id="titlebar-update-blocked"
            class="lx-visually-hidden"
          >
            {{ update.blocked }}
          </span>
        </div>
        <RouterLink
          v-else-if="update?.kind === 'rejected'"
          class="update is-danger"
          :to="{ path: '/settings', query: { section: 'updates' } }"
          :aria-label="`${ru.update.rejected}. ${ru.update.openSettings}`"
        >
          <BiIcon name="exclamation-triangle" />
          <span class="update-text">{{ ru.update.rejected }}</span>
        </RouterLink>
        <RouterLink
          v-else-if="update?.kind === 'manual'"
          class="update"
          :to="{ path: '/settings', query: { section: 'updates' } }"
          :aria-label="`${update.text}. ${ru.update.openSettings}`"
        >
          <BiIcon name="arrow-down-circle" />
          <span class="update-text">{{ update.text }}</span>
        </RouterLink>
        <RouterLink
          v-if="install !== null"
          class="activity"
          :to="install.to"
          :aria-label="install.label"
          :title="install.label"
        >
          <BiIcon name="arrow-down-circle" />
          <span class="activity-name">{{ install.name }}</span>
          <span class="lx-num">{{ fill(ru.units.percent, { value: install.percent }) }}</span>
          <span class="mini-bar" aria-hidden="true">
            <i :style="{ transform: `scaleX(${String(install.percent / 100)})` }" />
          </span>
        </RouterLink>
        <div ref="alertsWrap" class="alerts" @focusout="onAlertsFocusOut">
          <button
            ref="alertsButton"
            type="button"
            class="iconbtn"
            :class="{ 'has-dot': alerts.unread.value > 0, 'is-open': alertsOpen }"
            :aria-label="notificationsLabel"
            :title="alertsOpen ? undefined : notificationsLabel"
            aria-haspopup="dialog"
            :aria-expanded="alertsOpen"
            aria-controls="titlebar-alerts"
            data-alerts-button
            @click="toggleAlerts"
          >
            <BiIcon name="bell" />
          </button>
          <div
            v-if="alertsOpen"
            id="titlebar-alerts"
            ref="alertsPanel"
            class="alerts-panel"
            role="dialog"
            tabindex="-1"
            :aria-label="ru.alerts.title"
          >
            <AlertsPanel @close="closeAlerts(true)" @acted="keepAlertsFocus" />
          </div>
        </div>
      </template>

      <div class="winctl" role="group" :aria-label="ru.window.controls">
        <button
          type="button"
          class="is-minimize"
          :aria-label="ru.window.minimize"
          :title="ru.window.minimize"
          @click="api.window.minimize()"
        >
          <BiIcon name="dash-lg" />
        </button>
        <button
          type="button"
          class="is-maximize"
          :aria-label="maximizeLabel"
          :title="maximizeLabel"
          @click="api.window.toggleMaximize()"
        >
          <BiIcon :name="maximized ? 'window-stack' : 'square'" />
        </button>
        <button
          type="button"
          class="is-close"
          :aria-label="ru.window.close"
          :title="ru.window.close"
          @click="api.window.close()"
        >
          <BiIcon name="x-lg" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--lx-title-h);
  background: var(--mc-surface);
  border-bottom: 1px solid var(--mc-border);
  user-select: none;
  -webkit-app-region: drag;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  width: calc(var(--lx-side-w) - 10px);
  flex-shrink: 0;
  padding-left: 16px;
  font-family: var(--mc-font-display);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
  color: var(--mc-text);
}

.brand small {
  font-family: var(--mc-font-body);
  font-weight: 400;
  font-size: 11px;
  letter-spacing: 0;
  color: var(--lx-text-faint);
}

.logo {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  image-rendering: pixelated;
}

.history {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}

.iconbtn {
  position: relative;
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: transparent;
  color: var(--mc-text-muted);
  font-size: 15px;
  -webkit-app-region: no-drag;
}

.iconbtn:hover:not(:disabled) {
  background: var(--mc-surface-3);
  color: var(--mc-text);
}

.iconbtn:disabled {
  color: var(--mc-text-dim);
  opacity: 0.5;
}

.iconbtn.is-open {
  background: var(--mc-surface-3);
  color: var(--mc-text);
}

.alerts {
  position: relative;
  display: flex;
  -webkit-app-region: no-drag;
}

.alerts-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 360px;
  max-width: calc(100vw - 24px);
  max-height: min(480px, calc(100vh - var(--lx-title-h) - 24px));
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius);
  background: var(--mc-surface-2);
  box-shadow: var(--mc-shadow);
  user-select: none;
  outline: 0;
}

.has-dot::after {
  content: '';
  position: absolute;
  top: 6px;
  right: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mc-accent);
  box-shadow: 0 0 0 2px var(--mc-surface);
}

.middle {
  display: flex;
  flex: 1;
  justify-content: center;
  min-width: 0;
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 300px;
  min-width: 160px;
  height: 28px;
  margin: 0;
  padding: 0 6px 0 11px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg);
  border: 1px solid var(--mc-border);
  color: var(--lx-text-faint);
  font-size: 13px;
  -webkit-app-region: no-drag;
}

.search:focus-within {
  border-color: color-mix(in srgb, var(--mc-accent) 50%, transparent);
  box-shadow: 0 0 0 3px var(--mc-accent-soft);
}

.search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--mc-text);
  font: inherit;
}

.search input::placeholder {
  color: var(--lx-text-faint);
}

.search input::-webkit-search-cancel-button {
  display: none;
}

kbd {
  font-family: var(--mc-font-mono);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: calc(var(--mc-radius-sm) / 2);
  background: var(--mc-surface-2);
  border: 1px solid var(--mc-border);
  color: var(--mc-text-muted);
}

.right {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  height: 100%;
}

.titlebar a {
  cursor: default;
}

.activity {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 10px;
  margin-right: 4px;
  border-radius: 999px;
  background: var(--mc-violet-soft);
  color: var(--mc-violet);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  text-decoration: none;
  -webkit-app-region: no-drag;
}

.update {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 4px 0 10px;
  margin-right: 4px;
  border-radius: 999px;
  background: var(--mc-violet-soft);
  color: var(--mc-violet);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  text-decoration: none;
  -webkit-app-region: no-drag;
}

.update.is-danger {
  padding-right: 10px;
  background: color-mix(in srgb, var(--mc-danger) 14%, transparent);
  color: var(--mc-danger);
}

.update-short {
  display: none;
}

.update-action {
  height: 20px;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  background: var(--mc-violet);
  color: var(--mc-bg);
  font: inherit;
  cursor: default;
}

.update-action[aria-disabled='true'] {
  background: var(--mc-surface-3);
  color: var(--mc-text-muted);
}

.update-action:focus-visible {
  outline: 2px solid var(--mc-violet);
  outline-offset: 2px;
}

.mini-bar {
  width: 54px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mc-violet) 20%, transparent);
  overflow: hidden;
}

.mini-bar i {
  display: block;
  height: 100%;
  background: var(--mc-violet);
  transform-origin: left center;
}

.winctl {
  display: flex;
  height: 100%;
  margin-left: 6px;
  border-left: 1px solid var(--mc-border);
  -webkit-app-region: no-drag;
}

.winctl button {
  width: 46px;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mc-text-muted);
  font-size: 14px;
  cursor: default;
}

.winctl .is-maximize {
  font-size: 11px;
}

.winctl button:hover {
  background: var(--mc-surface-3);
  color: var(--mc-text);
}

.winctl .is-close:hover {
  background: var(--mc-danger);
  color: var(--mc-bg);
}

@media (max-width: 1099px) {
  .activity-name,
  .update-text,
  kbd {
    display: none;
  }

  .update-short {
    display: inline;
  }

  .update.is-danger .update-text {
    display: inline;
  }
}
</style>
