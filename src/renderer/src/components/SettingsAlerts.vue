<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PLAYER_ALERT_KINDS, type AlertSettings, type PlayerAlertKind } from '@shared/alerts';
import { ru } from '@shared/i18n/ru';
import { useLauncher } from '../composables/context';
import { useAccounts } from '../composables/useAccounts';
import { useSiteChange } from '../composables/useSiteChange';
import UiButton from './UiButton.vue';
import UiToggle from './UiToggle.vue';

type Status = 'guest' | 'loading' | 'ready' | 'error' | 'hidden';

const ALL_ON: AlertSettings = { favorite_wipe: true, watched_up: true, server_removed: true };
const ALL_OFF: AlertSettings = { favorite_wipe: false, watched_up: false, server_removed: false };

const launcher = useLauncher();
const accounts = useAccounts();

const status = ref<Status>('guest');
const shown = ref<AlertSettings>(ALL_OFF);
const saveFailed = ref(false);
let saved: AlertSettings = ALL_OFF;
let request = 0;
let saving = false;

const note = computed(() => {
  if (status.value === 'guest') {
    return ru.alerts.settings.guest;
  }
  return status.value === 'error' ? ru.alerts.settings.failed : null;
});

function same(a: AlertSettings, b: AlertSettings): boolean {
  return PLAYER_ALERT_KINDS.every((kind) => a[kind] === b[kind]);
}

function adopt(value: AlertSettings): void {
  saved = value;
  shown.value = value;
  status.value = 'ready';
}

useSiteChange((change) => {
  if (change.topic === 'alert-settings' && status.value === 'ready' && !saving) {
    void load(true);
  }
});

async function load(quiet = false): Promise<void> {
  request += 1;
  const started = request;
  saving = false;
  saveFailed.value = false;
  if (accounts.mc.value === null) {
    status.value = 'guest';
    shown.value = ALL_OFF;
    return;
  }
  if (launcher.demo) {
    adopt(ALL_ON);
    return;
  }
  if (!quiet) {
    status.value = 'loading';
  }
  const result = await launcher.api.site.alertSettings();
  if (started !== request) {
    return;
  }
  if (result.ok) {
    adopt(result.value);
    return;
  }
  status.value = result.error.code === 'unavailable' ? 'hidden' : 'error';
  shown.value = ALL_OFF;
}

async function save(): Promise<void> {
  const started = request;
  saving = true;
  let sent = shown.value;
  let result = await launcher.api.site.setAlertSettings(sent);
  while (started === request && result.ok && !same(sent, shown.value)) {
    saved = result.value;
    sent = shown.value;
    result = await launcher.api.site.setAlertSettings(sent);
  }
  if (started !== request) {
    return;
  }
  saving = false;
  if (result.ok) {
    adopt(result.value);
  } else {
    shown.value = saved;
    saveFailed.value = true;
  }
}

function change(kind: PlayerAlertKind, value: boolean): void {
  if (status.value !== 'ready') {
    return;
  }
  shown.value = { ...shown.value, [kind]: value };
  saveFailed.value = false;
  if (launcher.demo) {
    saved = shown.value;
  } else if (!saving) {
    void save();
  }
}

watch(
  () => accounts.mc.value?.id ?? null,
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <template v-if="status !== 'hidden'">
    <h3 id="settings-alerts-title">{{ ru.alerts.settings.title }}</h3>
    <p v-if="note !== null" id="settings-alerts-note" class="alerts-note" data-alerts-note>
      {{ note }}
    </p>
    <UiButton
      v-if="status === 'error'"
      class="retry"
      size="sm"
      icon="arrow-clockwise"
      data-alerts-retry
      @click="load()"
    >
      {{ ru.state.retry }}
    </UiButton>
    <div class="lx-rows" role="group" aria-labelledby="settings-alerts-title" data-alert-settings>
      <div v-for="kind in PLAYER_ALERT_KINDS" :key="kind" class="lx-row">
        <div class="lx-row-text">
          <div class="lx-row-title">{{ ru.alerts.settings.kinds[kind].title }}</div>
          <div class="lx-row-desc">{{ ru.alerts.settings.kinds[kind].note }}</div>
        </div>
        <UiToggle
          :model-value="shown[kind]"
          :label="ru.alerts.settings.kinds[kind].title"
          :disabled="status !== 'ready'"
          :aria-describedby="note === null ? undefined : 'settings-alerts-note'"
          :data-alert-kind="kind"
          @update:model-value="change(kind, $event)"
        />
      </div>
    </div>
    <p v-if="saveFailed" class="alerts-note is-danger" role="alert">
      {{ ru.alerts.settings.saveFailed }}
    </p>
  </template>
</template>

<style scoped>
h3 {
  margin: 26px 0 4px;
  font-family: var(--mc-font-body);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}

.alerts-note {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.retry {
  margin: 4px 0;
}

.lx-rows {
  margin-top: 8px;
}

.alerts-note.is-danger {
  margin: 8px 0 0;
  color: var(--mc-danger);
}
</style>
