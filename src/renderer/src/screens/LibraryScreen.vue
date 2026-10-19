<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef } from 'vue';
import { RouterLink } from 'vue-router';
import { countOf, fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { LibraryEntry } from '@shared/player';
import type { Scene } from '@shared/scenes';
import PixelLandscape from '../components/PixelLandscape.vue';
import ProgressBar from '../components/ProgressBar.vue';
import ServerIcon from '../components/ServerIcon.vue';
import SkelBar from '../components/SkelBar.vue';
import StateNotice from '../components/StateNotice.vue';
import TagChip from '../components/TagChip.vue';
import UiButton from '../components/UiButton.vue';
import UiSegmented from '../components/UiSegmented.vue';
import { useLauncher } from '../composables/context';
import { useCatalog } from '../composables/useCatalog';
import { useLaunch } from '../composables/useLaunch';
import { useLibrary } from '../composables/useLibrary';
import { usePlay } from '../composables/usePlay';
import { useScenes } from '../composables/useScenes';
import { errorView } from '../lib/launch-view';
import { capitalize, duration, relativeDay } from '../lib/time';
import { formatBytes } from '../lib/units';

type Sort = 'recent' | 'name' | 'size';

const { now } = useLauncher();
const library = useLibrary();
const catalog = useCatalog();
const launch = useLaunch();
const { playServer } = usePlay();
const scenes = useScenes();

const sort = ref<Sort>('recent');
const confirming = ref<string | null>(null);
const removing = reactive(new Set<string>());
const root = useTemplateRef<HTMLElement>('root');

const entries = library.entries;

const sorts = [
  { value: 'recent' as const, label: ru.library.sortRecent },
  { value: 'name' as const, label: ru.library.sortName },
  { value: 'size' as const, label: ru.library.sortSize },
];

function coverScene(entry: LibraryEntry): Scene | undefined {
  return entry.cover === null ? undefined : scenes.scene(entry.cover.scene);
}

function playedAt(entry: LibraryEntry): number {
  return entry.lastPlayedAt === null ? 0 : Date.parse(entry.lastPlayedAt);
}

const sorters: Record<Sort, (a: LibraryEntry, b: LibraryEntry) => number> = {
  recent: (a, b) => playedAt(b) - playedAt(a),
  name: (a, b) => a.name.localeCompare(b.name, 'ru'),
  size: (a, b) => b.sizeBytes - a.sizeBytes,
};

const cards = computed(() =>
  entries.value.toSorted(sorters[sort.value]).map((entry) => ({ entry, scene: coverScene(entry) })),
);
const recentId = computed(() => entries.value.toSorted(sorters.recent)[0]?.id);
const totalBytes = computed(
  () => entries.value.reduce((sum, entry) => sum + entry.sizeBytes, 0) + library.sharedBytes.value,
);

const disk = computed(() => {
  const storage = library.storage.value;
  if (storage === null || storage.usedBytes <= 0) {
    return null;
  }
  const share = (bytes: number): string => `${String((bytes / storage.usedBytes) * 100)}%`;
  return {
    storage,
    parts: [
      { key: 'servers', width: share(storage.serversBytes), tone: 'violet' },
      { key: 'shared', width: share(storage.sharedBytes), tone: 'shared' },
    ],
  };
});

const actionError = computed(() => {
  const error = library.error.value;
  if (error === null) {
    return null;
  }
  const view = errorView(error);
  return fill(ru.library.actionFailed, { reason: view.title, text: view.text });
});

function installing(entry: LibraryEntry): boolean {
  return launch.installing.value && launch.job.value?.instanceId === entry.id;
}

function busy(entry: LibraryEntry): boolean {
  return removing.has(entry.id) || (launch.busy.value && launch.job.value?.instanceId === entry.id);
}

const unavailableText = { gone: ru.library.gone, offline: ru.library.offline } as const;

function unavailable(entry: LibraryEntry): string | null {
  const presence = library.presence(entry.serverId);
  return presence === 'gone' || presence === 'offline' ? unavailableText[presence] : null;
}

function playable(entry: LibraryEntry): boolean {
  return library.presence(entry.serverId) === 'listed' && !removing.has(entry.id);
}

function play(entry: LibraryEntry): void {
  const server = catalog.server(entry.serverId);
  if (server !== undefined) {
    void playServer(server, { source: 'other' });
  }
}

function lastPlayed(entry: LibraryEntry): string {
  return entry.lastPlayedAt === null
    ? ru.library.neverPlayed
    : capitalize(relativeDay(entry.lastPlayedAt, now()));
}

function focusIn(entry: LibraryEntry, selector: string): void {
  root.value?.querySelector<HTMLElement>(`[data-entry="${entry.id}"] ${selector}`)?.focus();
}

async function askRemove(entry: LibraryEntry): Promise<void> {
  confirming.value = entry.id;
  await nextTick();
  focusIn(entry, '[data-remove-no]');
}

async function keep(entry: LibraryEntry): Promise<void> {
  confirming.value = null;
  await nextTick();
  focusIn(entry, '[data-remove]');
}

async function remove(entry: LibraryEntry): Promise<void> {
  removing.add(entry.id);
  try {
    await library.remove(entry);
  } finally {
    removing.delete(entry.id);
    confirming.value = null;
  }
}
</script>

<template>
  <div ref="root" class="lx-content">
    <div class="lx-head-row">
      <div>
        <h1 class="lx-h1">{{ ru.library.title }}</h1>
        <p v-if="entries.length > 0" class="lx-sub lx-num" data-library-summary>
          {{
            fill(ru.library.summary, {
              servers: countOf(entries.length, ru.plural.servers),
              size: formatBytes(totalBytes),
            })
          }}
        </p>
      </div>
      <UiSegmented
        v-if="entries.length > 1"
        v-model="sort"
        :options="sorts"
        :label="ru.library.sort"
      />
    </div>

    <p v-if="actionError !== null" class="action-error selectable" role="alert">
      {{ actionError }}
    </p>

    <ul
      v-if="library.status.value === 'loading'"
      data-loading
      class="lx-grid-3 grid"
      role="status"
      :aria-label="ru.state.loading"
    >
      <li v-for="index in 3" :key="index" class="inst">
        <span class="lx-skel cover skel-cover" />
        <div class="body skel-body">
          <SkelBar w="60%" :h="16" />
          <div class="meta">
            <SkelBar :w="56" :h="22" />
            <SkelBar :w="64" :h="22" />
          </div>
          <SkelBar :w="110" :h="12" />
          <div class="foot">
            <SkelBar class="skel-play" :w="92" :h="30" />
          </div>
        </div>
      </li>
    </ul>
    <StateNotice
      v-else-if="cards.length === 0"
      class="empty"
      icon="collection"
      :title="ru.library.empty"
      :text="ru.library.emptyText"
      data-library-empty
    >
      <UiButton size="sm" variant="primary" icon="compass" to="/servers">
        {{ ru.library.emptyFind }}
      </UiButton>
    </StateNotice>
    <ul v-else class="lx-grid-3 grid">
      <li v-for="{ entry, scene } in cards" :key="entry.id" class="inst" :data-entry="entry.id">
        <div class="cover">
          <PixelLandscape
            v-if="scene"
            :scene="scene"
            :base="scenes.base"
            :time="entry.cover?.time ?? 'auto'"
            still
          />
          <ServerIcon :src="entry.iconUrl" size="sm" class="inst-icon" />
        </div>
        <div class="body">
          <div class="title-row">
            <h3>
              <RouterLink class="stretched" :to="`/server/${String(entry.serverId)}`">
                {{ entry.name }}
              </RouterLink>
            </h3>
            <TagChip v-if="installing(entry)" tone="violet" icon="arrow-down-circle" small>
              {{ ru.library.installing }}
            </TagChip>
          </div>
          <div class="meta">
            <TagChip v-if="entry.minecraft !== ''" tone="version">{{ entry.minecraft }}</TagChip>
            <TagChip icon="hdd">
              <span class="lx-num">{{ formatBytes(entry.sizeBytes) }}</span>
              <span class="lx-visually-hidden">{{ ru.library.onDisk }}</span>
            </TagChip>
          </div>
          <p v-if="unavailable(entry) !== null" class="played" data-unavailable>
            {{ unavailable(entry) }}
          </p>
          <p v-else-if="!installing(entry)" class="played">
            {{ lastPlayed(entry) }}
          </p>
          <div v-if="installing(entry)" class="progress">
            <ProgressBar
              thin
              :value="launch.progress.value?.percent ?? 0"
              :label="
                fill(ru.install.progress, {
                  name: entry.name,
                  percent: launch.progress.value?.percent ?? 0,
                })
              "
            />
            <div class="progress-numbers">
              <span>
                {{
                  fill(ru.library.installProgress, {
                    done: formatBytes(launch.progress.value?.bytesDone ?? 0),
                    total: formatBytes(launch.progress.value?.bytesTotal ?? 0),
                  })
                }}
              </span>
              <span v-if="launch.progress.value?.remainingSeconds">{{
                fill(ru.library.installRemaining, {
                  time: duration(launch.progress.value.remainingSeconds),
                })
              }}</span>
            </div>
          </div>
          <div v-else class="foot">
            <UiButton
              class="tool"
              size="sm"
              icon-only
              icon="trash"
              :label="fill(ru.library.removeLabel, { name: entry.name })"
              :disabled="busy(entry)"
              data-remove
              @click="askRemove(entry)"
            />
            <UiButton
              class="play"
              size="sm"
              :variant="entry.id === recentId ? 'play' : 'play-soft'"
              icon="play-fill"
              :label="fill(ru.launch.playOn, { name: entry.name })"
              :disabled="!playable(entry)"
              @click="play(entry)"
            >
              {{ ru.launch.play }}
            </UiButton>
          </div>
        </div>
        <div
          v-if="confirming === entry.id"
          class="confirm"
          role="alertdialog"
          aria-modal="false"
          :aria-labelledby="`confirm-${entry.id}`"
          data-confirm
          @keydown.esc="keep(entry)"
        >
          <p :id="`confirm-${entry.id}`" class="confirm-text">
            {{ fill(ru.library.removeConfirm, { name: entry.name }) }}
          </p>
          <div class="confirm-actions">
            <UiButton
              size="sm"
              variant="danger"
              :disabled="removing.has(entry.id)"
              data-remove-yes
              @click="remove(entry)"
            >
              {{ ru.library.removeYes }}
            </UiButton>
            <UiButton size="sm" data-remove-no @click="keep(entry)">
              {{ ru.library.removeNo }}
            </UiButton>
          </div>
        </div>
      </li>
    </ul>

    <section v-if="disk !== null && cards.length > 0" class="lx-panel disk">
      <div class="lx-panel-body">
        <div class="disk-head">
          <span>
            {{ ru.library.disk }}
            <span class="lx-mono lx-muted selectable">{{ disk.storage.path }}</span>
          </span>
          <span class="lx-muted lx-num">
            {{
              fill(ru.library.diskSummary, {
                used: formatBytes(disk.storage.usedBytes),
                free: formatBytes(disk.storage.freeBytes),
              })
            }}
          </span>
        </div>
        <div class="disk-bar" aria-hidden="true">
          <span
            v-for="part in disk.parts"
            :key="part.key"
            :class="`is-${part.tone}`"
            :style="{ width: part.width }"
          />
        </div>
        <ul class="legend lx-num">
          <li>
            <i class="is-violet" />{{
              fill(ru.library.diskServers, { size: formatBytes(disk.storage.serversBytes) })
            }}
          </li>
          <li>
            <i class="is-shared" />{{
              fill(ru.library.diskShared, {
                size: formatBytes(disk.storage.sharedBytes),
                saved: formatBytes(disk.storage.savedBytes),
              })
            }}
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.action-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--mc-danger);
}

.grid {
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.inst {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--mc-radius);
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
}

.inst:hover {
  border-color: var(--mc-border-strong);
}

.inst:has(.stretched:focus-visible) {
  outline: 2px solid var(--mc-accent);
  outline-offset: 2px;
}

.cover {
  position: relative;
  height: 84px;
  background: var(--mc-surface-2);
}

.cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    0deg,
    color-mix(in srgb, var(--mc-surface) 55%, transparent),
    transparent 45%
  );
}

.inst-icon {
  position: absolute;
  left: 14px;
  bottom: -18px;
  z-index: 2;
  width: 42px;
  height: 42px;
  box-shadow: 0 0 0 3px var(--mc-surface);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
}

.title-row > .tag {
  flex-shrink: 0;
}

.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  padding: 24px 14px 14px;
}

h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.stretched {
  color: var(--mc-text);
  text-decoration: none;
}

.stretched:focus-visible {
  outline: none;
}

.stretched::after {
  content: '';
  position: absolute;
  inset: 0;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.confirm {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 14px 14px;
  border-radius: inherit;
  background: var(--mc-surface);
}

.confirm-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--mc-text);
}

.confirm-actions {
  display: flex;
  gap: 8px;
}

.played {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.tool,
.play {
  position: relative;
}

.play {
  margin-left: auto;
}

.skel-cover {
  border-radius: 0;
}

.skel-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skel-play {
  margin-left: auto;
}

.empty {
  margin-top: 16px;
}

.progress {
  margin-top: 10px;
}

.progress-numbers {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
}

.disk {
  margin-top: 16px;
}

.disk-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.disk-bar {
  display: flex;
  gap: 2px;
  height: 8px;
  margin-top: 8px;
  border-radius: 999px;
  overflow: hidden;
}

.is-violet {
  background: var(--mc-violet);
}

.is-shared {
  background: var(--mc-text-dim);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend i {
  width: 8px;
  height: 8px;
  border-radius: calc(var(--mc-radius-sm) / 4);
}
</style>
