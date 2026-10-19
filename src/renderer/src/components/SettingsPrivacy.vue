<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import type { TelemetryPreview } from '@shared/site';
import { windowReportsEnabled } from '@shared/window-failure';
import { hostSystemOf } from '@shared/host-system';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { useLauncher } from '../composables/context';
import { useSite } from '../composables/useSite';
import { behaviorLines, telemetryLines, type TelemetryLine } from '../lib/telemetry';
import UiButton from './UiButton.vue';

interface PrivacyRow {
  key: string;
  title: string;
  what: string;
  why: string;
  off: string;
}

const telemetryRow: PrivacyRow = {
  key: 'telemetry',
  title: ru.privacy.telemetry,
  what: ru.privacy.telemetryWhat,
  why: ru.privacy.telemetryWhy,
  off: ru.privacy.telemetryOff,
};

const behaviorRow: PrivacyRow = {
  key: 'behavior',
  title: ru.privacy.behavior,
  what: ru.privacy.behaviorWhat,
  why: ru.privacy.behaviorWhy,
  off: ru.privacy.behaviorOff,
};

const windowFailureRow: PrivacyRow = {
  key: 'window-failure',
  title: ru.privacy.windowFailure,
  what: ru.privacy.windowFailureWhat,
  why: ru.privacy.windowFailureWhy,
  off: ru.privacy.windowFailureOff,
};

const otherRows: PrivacyRow[] = [
  {
    key: 'install',
    title: ru.privacy.install,
    what: ru.privacy.installWhat[hostSystemOf(navigator.platform)],
    why: ru.privacy.installWhy,
    off: ru.privacy.installOff,
  },
  {
    key: 'device',
    title: ru.privacy.device,
    what: ru.privacy.deviceWhat[hostSystemOf(navigator.platform)],
    why: ru.privacy.deviceWhy,
    off: ru.privacy.deviceOff,
  },
  {
    key: 'hardware',
    title: ru.privacy.hardware,
    what: ru.privacy.hardwareWhat[hostSystemOf(navigator.platform)],
    why: ru.privacy.hardwareWhy,
    off: ru.privacy.hardwareOff,
  },
  {
    key: 'crash',
    title: ru.privacy.crash,
    what: ru.privacy.crashWhat,
    why: ru.privacy.crashWhy,
    off: ru.privacy.crashOff,
  },
  {
    key: 'skins',
    title: ru.privacy.skins,
    what: ru.privacy.skinsWhat,
    why: ru.privacy.skinsWhy,
    off: ru.privacy.skinsOff,
  },
  {
    key: 'account',
    title: ru.privacy.account,
    what: ru.privacy.accountWhat[hostSystemOf(navigator.platform)],
    why: ru.privacy.accountWhy,
    off: ru.privacy.accountOff,
  },
  {
    key: 'play-session',
    title: ru.privacy.playSession,
    what: ru.privacy.playSessionWhat,
    why: ru.privacy.playSessionWhy,
    off: ru.privacy.playSessionOff,
  },
  {
    key: 'site-port',
    title: ru.privacy.sitePort,
    what: ru.privacy.sitePortWhat,
    why: ru.privacy.sitePortWhy,
    off: ru.privacy.sitePortOff[hostSystemOf(navigator.platform)],
  },
];

const { api } = useLauncher();
const behavior = useSite().behaviorTelemetry;
const rows = computed(() => [
  telemetryRow,
  ...(behavior.value ? [behaviorRow] : []),
  ...(windowReportsEnabled() ? [windowFailureRow] : []),
  ...otherRows,
]);
const lines = computed<Partial<Record<string, TelemetryLine[]>>>(() => ({
  telemetry: telemetryLines(behavior.value),
  behavior: behaviorLines(),
}));
const packet = shallowRef<TelemetryPreview | null>(null);
const packetFailed = ref(false);

async function togglePacket(): Promise<void> {
  if (packet.value !== null) {
    packet.value = null;
    return;
  }
  const result = await api.site.telemetryPreview();
  packetFailed.value = !result.ok;
  packet.value = result.ok ? result.value : null;
}
</script>

<template>
  <div class="privacy">
    <table class="table" :aria-label="ru.privacy.label">
      <thead>
        <tr>
          <th scope="col">{{ ru.privacy.what }}</th>
          <th scope="col">{{ ru.privacy.why }}</th>
          <th scope="col">{{ ru.privacy.off }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.key">
          <tr :data-privacy="row.key">
            <th scope="row" :data-label="ru.privacy.what">
              <div class="title">{{ row.title }}</div>
              <div class="text">{{ row.what }}</div>
              <ul v-if="lines[row.key]" class="telemetry">
                <li v-for="line in lines[row.key]" :key="line.type">
                  <strong>{{ line.label }}:</strong> {{ line.fields }}
                </li>
              </ul>
              <template v-if="row.key === 'telemetry'">
                <div class="packet-action">
                  <UiButton size="sm" :aria-expanded="packet !== null" @click="togglePacket()">
                    {{ packet === null ? ru.privacy.packetShow : ru.privacy.packetHide }}
                  </UiButton>
                  <span v-if="packet !== null" class="text lx-num">
                    {{ fill(ru.privacy.packetNote, { count: packet.queued }) }}
                  </span>
                  <span v-else-if="packetFailed" class="text" role="alert">
                    {{ ru.privacy.packetError }}
                  </span>
                </div>
              </template>
            </th>
            <td :data-label="ru.privacy.why" class="text">{{ row.why }}</td>
            <td :data-label="ru.privacy.off" class="off">
              <span class="text">{{ row.off }}</span>
            </td>
          </tr>
          <tr v-if="row.key === 'telemetry' && packet !== null" class="packet-row">
            <td colspan="3">
              <pre
                class="packet lx-mono selectable"
                tabindex="0"
                :aria-label="ru.privacy.packetLabel"
                >{{ JSON.stringify(packet.packet, null, 2) }}</pre>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p class="retention" data-privacy="retention">
      <strong>{{ ru.privacy.retention }}:</strong> {{ ru.privacy.retentionText }}
    </p>
  </div>
</template>

<style scoped>
.privacy {
  container-type: inline-size;
}

.table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  font-size: 13px;
}

thead th {
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  color: var(--mc-text-muted);
  border-bottom: 1px solid var(--mc-border);
}

td,
tbody th {
  padding: 13px 16px;
  font-weight: 400;
  text-align: left;
  vertical-align: top;
}

tbody tr + tr > * {
  border-top: 1px solid var(--mc-border);
}

thead th:nth-child(1) {
  width: 42%;
}

thead th:nth-child(3) {
  width: 22%;
}

.title {
  font-size: 14px;
  font-weight: 600;
}

.title + .text {
  margin-top: 2px;
}

.text {
  color: var(--mc-text-muted);
}

.off .text {
  color: var(--mc-text);
}

.telemetry {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.telemetry strong {
  font-weight: 600;
  color: var(--mc-text);
}

.packet-action {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 10px;
  font-size: 12px;
}

.packet-row td {
  padding: 0;
}

.packet {
  max-height: 280px;
  margin: 0;
  padding: 12px 16px;
  overflow: auto;
  font-size: 12px;
  color: var(--mc-text-muted);
  background: var(--mc-bg);
  white-space: pre;
}

.packet:focus-visible {
  outline: 2px solid var(--mc-accent);
  outline-offset: -2px;
}

.retention {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.retention strong {
  font-weight: 600;
  color: var(--mc-text);
}

@container (max-width: 480px) {
  .table,
  .table tbody,
  .table tr,
  .table tbody th,
  .table td {
    display: block;
    width: auto;
  }

  .table {
    background: transparent;
    border: 0;
  }

  .table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .table tbody tr {
    margin-bottom: 10px;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: var(--mc-radius);
  }

  .table tbody tr + tr > * {
    border-top: 0;
  }

  .table tbody th,
  .table td {
    padding: 10px 16px 0;
  }

  .table td:last-child {
    padding-bottom: 12px;
  }

  .table tbody tr > * + td::before {
    content: attr(data-label) / '';
    display: block;
    margin-bottom: 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--mc-text-muted);
  }

  .table .packet-row td {
    padding: 0;
  }
}
</style>
