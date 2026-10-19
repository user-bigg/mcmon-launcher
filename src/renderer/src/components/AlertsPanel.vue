<script setup lang="ts">
import { computed, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import type { AlertItem } from '@shared/alerts';
import { ru } from '@shared/i18n/ru';
import { useLauncher } from '../composables/context';
import { useAlerts } from '../composables/useAlerts';
import { useCatalog } from '../composables/useCatalog';
import { moscowDayTime } from '../lib/time';
import BiIcon from './BiIcon.vue';
import ServerIcon from './ServerIcon.vue';
import SkelBar from './SkelBar.vue';
import UiButton from './UiButton.vue';

const emit = defineEmits<{ close: []; acted: [] }>();

const launcher = useLauncher();
const alerts = useAlerts();
const catalog = useCatalog();
const router = useRouter();

const GHOST_WIDTHS = [210, 168, 190] as const;

const rows = computed(() =>
  alerts.items.value.map((item) => ({
    item,
    known: item.server === null ? undefined : catalog.server(item.server.id),
    time: moscowDayTime(item.at, launcher.now()),
  })),
);
const hasUnread = computed(
  () => alerts.unread.value > 0 || alerts.items.value.some((item) => !item.read),
);
const showList = computed(() => alerts.status.value === 'ready' && rows.value.length > 0);

async function act(run: () => Promise<void>): Promise<void> {
  await run();
  await nextTick();
  emit('acted');
}

function openServer(item: AlertItem): void {
  alerts.markRead(item.id);
  if (item.server === null) {
    return;
  }
  void router.push(`/server/${String(item.server.id)}`);
  emit('close');
}
</script>

<template>
  <div class="panel-head">
    <h2>{{ ru.alerts.title }}</h2>
    <div v-if="alerts.signedIn.value && showList" class="actions">
      <button
        v-if="hasUnread"
        type="button"
        class="action"
        data-alerts-read
        :disabled="alerts.busy.value"
        @click="act(alerts.markAllRead)"
      >
        {{ ru.alerts.markRead }}
      </button>
      <button
        type="button"
        class="action"
        data-alerts-clear
        :disabled="alerts.busy.value"
        @click="act(alerts.clear)"
      >
        {{ ru.alerts.clear }}
      </button>
    </div>
  </div>

  <div v-if="!alerts.signedIn.value" class="note" data-alerts-guest>
    <p>{{ ru.alerts.guest }}</p>
    <UiButton size="sm" variant="primary" to="/accounts">{{ ru.alerts.signIn }}</UiButton>
  </div>
  <div v-else-if="alerts.status.value === 'error'" class="note" role="status" data-alerts-error>
    <p>{{ ru.alerts.failed }}</p>
    <UiButton size="sm" icon="arrow-clockwise" @click="alerts.open()">
      {{ ru.state.retry }}
    </UiButton>
  </div>
  <ul
    v-else-if="alerts.status.value !== 'ready'"
    class="ghosts"
    role="status"
    :aria-label="ru.state.loading"
    data-alerts-loading
  >
    <li v-for="width in GHOST_WIDTHS" :key="width">
      <SkelBar class="is-late" :w="28" :h="28" />
      <span>
        <SkelBar class="is-late" :w="width" :h="13" />
        <SkelBar class="is-late" :w="72" :h="10" />
      </span>
    </li>
  </ul>
  <p v-else-if="rows.length === 0" class="note" data-alerts-empty>{{ ru.alerts.empty }}</p>
  <template v-else>
    <p v-if="alerts.actionFailed.value" class="failed" role="alert">
      {{ ru.alerts.actionFailed }}
    </p>
    <ul class="list">
      <li v-for="row in rows" :key="row.item.id" :class="{ 'is-unread': !row.item.read }">
        <component
          :is="row.item.server === null ? 'div' : 'button'"
          :type="row.item.server === null ? undefined : 'button'"
          class="item"
          data-alert
          @click="openServer(row.item)"
        >
          <ServerIcon v-if="row.known !== undefined" :src="row.known.icon_url" size="xs" />
          <span v-else class="plain-icon"><BiIcon name="bell" /></span>
          <span class="text">
            <span v-if="row.item.server !== null" class="name">{{ row.item.server.name }}</span>
            <span class="title">{{ row.item.title }}</span>
            <time v-if="row.time !== ''" class="time lx-num" :datetime="row.item.at">{{
              row.time
            }}</time>
          </span>
          <span v-if="!row.item.read" class="mark">
            <span class="mark-dot" aria-hidden="true" />
            <span class="lx-visually-hidden">{{ ru.alerts.unread }}</span>
          </span>
        </component>
      </li>
    </ul>
    <button
      v-if="alerts.hasMore.value"
      type="button"
      class="more"
      data-alerts-more
      :disabled="alerts.busy.value"
      @click="alerts.more()"
    >
      {{ ru.alerts.more }}
    </button>
  </template>
</template>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 8px 8px 8px 14px;
  border-bottom: 1px solid var(--mc-border);
}

h2 {
  margin: 0;
  font-family: var(--mc-font-body);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.actions {
  display: flex;
  gap: 2px;
}

.action,
.more {
  padding: 5px 8px;
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: transparent;
  color: var(--mc-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.action:hover:not(:disabled),
.more:hover:not(:disabled) {
  background: var(--mc-surface-3);
  color: var(--mc-text);
}

.action:disabled,
.more:disabled {
  opacity: 0.5;
}

.note {
  margin: 0;
  padding: 18px 14px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--mc-text-muted);
  text-wrap: pretty;
}

.ghosts {
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 16px 14px;
  list-style: none;
}

.ghosts li {
  display: flex;
  gap: 10px;
}

.ghosts span {
  display: grid;
  gap: 7px;
}

.note p {
  margin: 0 0 12px;
}

.failed {
  margin: 0;
  padding: 8px 14px;
  border-bottom: 1px solid var(--mc-border);
  font-size: 12px;
  color: var(--mc-danger);
}

.list {
  margin: 0;
  padding: 4px;
  list-style: none;
  overflow-y: auto;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: transparent;
  color: var(--mc-text);
  font: inherit;
  text-align: left;
}

button.item:hover {
  background: var(--mc-surface-3);
}

.plain-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-3);
  color: var(--mc-text-muted);
  font-size: 13px;
}

.text {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 400;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.is-unread .name {
  font-weight: 600;
}

.title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mc-text-muted);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.is-unread .title {
  color: var(--mc-text);
}

.time {
  font-size: 12px;
  color: var(--lx-text-faint);
}

.mark {
  flex-shrink: 0;
  padding-top: 6px;
}

.mark-dot {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mc-accent);
}

.more {
  margin: 0 4px 4px;
}
</style>
