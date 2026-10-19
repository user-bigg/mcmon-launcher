<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  isAutomaticFix,
  type CrashAnalysis,
  type CrashError,
  type CrashFix,
  type CrashReportPreview,
} from '@shared/crash';
import { crashDetails, describeCrash } from '@shared/crash-text';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { serverIdOfFolder } from '@shared/instance';
import BiIcon from '../components/BiIcon.vue';
import UiButton from '../components/UiButton.vue';
import { useCatalog } from '../composables/useCatalog';
import { useCrashes } from '../composables/useCrashes';
import { useLaunch } from '../composables/useLaunch';
import { useLibrary } from '../composables/useLibrary';
import { usePlay } from '../composables/usePlay';
import { duration, moscowTime } from '../lib/time';
import { formatBytes } from '../lib/units';

const LOG_LINES = 200;
const RELAUNCH_FIXES: readonly CrashFix['type'][] = [
  'set-memory',
  'install-java',
  'launch-without-join',
];

const { instanceId } = defineProps<{ instanceId: string }>();

const crashes = useCrashes();
const library = useLibrary();
const catalog = useCatalog();
const launch = useLaunch();
const { playServer } = usePlay();

const message = ref<string | null>(null);
const preview = shallowRef<CrashReportPreview | null>(null);
const realLog = ref<string[]>([]);

const analysis = computed<CrashAnalysis | null>(() => crashes.find(instanceId));
const text = computed(() => (analysis.value === null ? null : describeCrash(analysis.value)));

const entry = computed(() => library.find(instanceId));
const server = computed(() => {
  const id = serverIdOfFolder(instanceId);
  return id === null ? undefined : catalog.server(id);
});
const name = computed(() => entry.value?.name ?? server.value?.name ?? ru.crash.unknownServer);
const canReplay = computed(() => server.value !== undefined);
const serverLink = computed(() =>
  server.value === undefined ? null : `/server/${String(server.value.id)}`,
);

function replay(): void {
  if (server.value !== undefined) {
    void playServer(server.value);
  }
}

const primaryIndex = computed(
  () => analysis.value?.fixes.findIndex((fix) => isAutomaticFix(fix)) ?? -1,
);

const meta = computed(() => {
  const current = analysis.value;
  if (current === null) {
    return '';
  }
  const parts = [fill(ru.crash.at, { time: moscowTime(current.at) })];
  if (current.uptimeMs !== null) {
    parts.push(fill(ru.crash.uptime, { runtime: duration(current.uptimeMs / 1000) }));
  }
  return parts.join(' · ');
});

const details = computed(() => (analysis.value === null ? null : crashDetails(analysis.value)));

const demoLog = computed(() => (analysis.value === null ? null : crashes.demoLog(analysis.value)));

onMounted(() => {
  launch.markCrashSeen();
});

// The launcher opens this screen at the game's exit, and the analysis may arrive after it.
watch(
  () => analysis.value?.id ?? null,
  async (id) => {
    if (id !== null && demoLog.value === null) {
      realLog.value = await launch.logTail(LOG_LINES);
    }
  },
  { immediate: true },
);

const fixes = computed(() => {
  const current = analysis.value;
  const described = text.value;
  if (current === null || described === null) {
    return [];
  }
  return current.fixes.map((fix, index) => ({
    index,
    fix,
    text: described.fixes[index],
    primary: index === primaryIndex.value,
  }));
});

function errorReason(error: CrashError): string {
  return ru.crash.errors[error.code];
}

async function relaunch(fix: CrashFix): Promise<void> {
  const memoryMb = fix.type === 'set-memory' ? fix.mb : undefined;
  const join = fix.type === 'launch-without-join' ? { joinServer: false } : {};
  if (server.value !== undefined) {
    await playServer(server.value, {
      ...(memoryMb === undefined ? { instanceMemory: true } : { memoryMb }),
      ...join,
    });
  }
}

async function runDemoFix(fix: CrashFix): Promise<void> {
  if (RELAUNCH_FIXES.includes(fix.type)) {
    await relaunch(fix);
  }
}

async function runFix(index: number): Promise<void> {
  const current = analysis.value;
  const fix = current?.fixes[index];
  if (current === null || fix === undefined) {
    return;
  }
  message.value = null;
  if (crashes.isDemo(current)) {
    await runDemoFix(fix);
    return;
  }
  const result = await crashes.apply(current, index);
  if (!result.ok) {
    message.value = fill(ru.crash.applyFailed, { reason: errorReason(result.error) });
    return;
  }
  preview.value = result.value.report;
  if (RELAUNCH_FIXES.includes(fix.type)) {
    await relaunch(fix);
    return;
  }
  message.value = fill(ru.crash.applied, { title: text.value?.fixes[index]?.title ?? '' });
}

function copyLog(): void {
  const lines = demoLog.value === null ? realLog.value : demoLog.value.map((line) => line.text);
  const evidence = details.value?.evidence ?? details.value?.note ?? null;
  const copied = evidence === null ? lines : [evidence, '', ...lines];
  navigator.clipboard.writeText(copied.join('\n')).catch(() => undefined);
}
</script>

<template>
  <div class="lx-content crash">
    <nav class="crumbs" :aria-label="ru.crash.breadcrumbs">
      <RouterLink to="/library">{{ ru.crash.library }}</RouterLink>
      <BiIcon name="chevron-right" />
      <RouterLink v-if="serverLink !== null" :to="serverLink">{{ name }}</RouterLink>
      <span v-else>{{ name }}</span>
      <BiIcon name="chevron-right" />
      <span class="current" aria-current="page">{{ ru.crashAnalysis.causes.closed.title }}</span>
    </nav>

    <template v-if="analysis === null || text === null">
      <h1 class="lx-h1 spaced">{{ ru.crash.notFound }}</h1>
      <p class="lx-sub">{{ ru.crash.notFoundText }}</p>
      <div class="missing-actions">
        <UiButton v-if="canReplay" size="sm" variant="play" icon="play-fill" @click="replay">
          {{ ru.crash.playAgain }}
        </UiButton>
        <UiButton size="sm" icon="collection" to="/library">{{ ru.crash.toLibrary }}</UiButton>
      </div>
    </template>

    <template v-else>
      <section class="alert" role="alert">
        <span class="alert-icon" aria-hidden="true"><BiIcon name="exclamation-triangle" /></span>
        <div class="selectable">
          <h1 class="lx-h1">{{ text.title }}</h1>
          <p>{{ text.text }}</p>
          <div class="alert-meta">
            <span class="lx-num">{{ meta }}</span>
          </div>
        </div>
      </section>

      <div class="lx-section-head">
        <h2>{{ ru.crash.fixesTitle }}</h2>
      </div>
      <ol class="lx-panel fixes">
        <li
          v-for="item in fixes"
          :key="item.index"
          class="fix"
          :class="{ 'is-best': item.primary }"
        >
          <span class="fix-num" aria-hidden="true">{{ item.index + 1 }}</span>
          <div class="fix-text">
            <div class="fix-title">{{ item.text?.title }}</div>
            <div v-if="item.text?.text" class="fix-note">{{ item.text.text }}</div>
          </div>
          <UiButton
            v-if="item.text?.action"
            size="sm"
            :variant="item.primary ? 'play' : 'ghost'"
            :icon="item.primary ? 'play-fill' : undefined"
            @click="runFix(item.index)"
          >
            {{ item.text.action }}
          </UiButton>
        </li>
      </ol>
      <p v-if="message !== null" class="message" role="status">{{ message }}</p>

      <section v-if="preview !== null" class="lx-panel report" :aria-label="ru.crash.reportTitle">
        <div class="lx-panel-head">
          <h3>{{ ru.crash.reportTitle }}</h3>
        </div>
        <div class="lx-panel-body">
          <p class="lx-muted selectable">
            {{
              fill(ru.crash.reportNote, { path: preview.path, size: formatBytes(preview.bytes) })
            }}
          </p>
          <pre class="log selectable" tabindex="0">{{
            JSON.stringify(preview.report, null, 2)
          }}</pre>
        </div>
      </section>

      <details class="details" data-details>
        <summary>
          <BiIcon name="chevron-right" />
          <h2>{{ ru.crash.details }}</h2>
        </summary>
        <div class="details-head">
          <div class="evidence-lines">
            <p v-if="details?.note != null" class="evidence selectable" data-evidence>
              {{ details.note }}
            </p>
            <p v-else class="lx-mono evidence selectable" data-evidence>{{ details?.evidence }}</p>
            <p v-if="details?.exit != null" class="lx-muted lx-num" data-exit-code>
              {{ details.exit }}
            </p>
          </div>
          <UiButton size="sm" icon="copy" @click="copyLog">{{ ru.crash.copy }}</UiButton>
        </div>
        <pre
          v-if="demoLog !== null"
          class="log selectable"
          :aria-label="ru.crash.log"
          tabindex="0"
        ><span
          v-for="(line, index) in demoLog"
          :key="index"
          class="line"
          :class="`is-${line.level}`"
        ><span class="time">[{{ moscowTime(line.at) }}]</span> {{ line.text }}
</span></pre>
        <pre
          v-else-if="realLog.length > 0"
          class="log selectable"
          :aria-label="ru.crash.log"
          tabindex="0"
          >{{ realLog.join('\n') }}</pre>
        <p v-else class="lx-muted">{{ ru.crash.logEmpty }}</p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.crash {
  max-width: 820px;
}

.spaced {
  margin-top: 16px;
}

.missing-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.crumbs a {
  color: var(--mc-text-muted);
  text-decoration: none;
}

.crumbs a:hover {
  color: var(--mc-text);
}

.crumbs .bi {
  font-size: 11px;
}

.current {
  color: var(--mc-text);
}

.alert {
  display: flex;
  gap: 14px;
  margin-top: 16px;
  padding: 16px 18px;
  border-radius: var(--mc-radius);
  border: 1px solid color-mix(in srgb, var(--mc-danger) 30%, transparent);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--mc-danger) 9%, transparent), transparent 70%),
    var(--mc-surface);
}

.alert-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: var(--mc-radius-sm);
  background: color-mix(in srgb, var(--mc-danger) 14%, transparent);
  color: var(--mc-danger);
  font-size: 20px;
}

.alert .lx-h1 {
  font-size: 19px;
}

.alert p {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--mc-text-muted);
}

.alert-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.details {
  margin-top: 28px;
}

.details summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  list-style: none;
  border-radius: var(--mc-radius-sm);
}

.details summary::-webkit-details-marker {
  display: none;
}

.details summary .bi {
  font-size: 12px;
  color: var(--mc-text-muted);
}

.details[open] summary .bi {
  transform: rotate(90deg);
}

.details summary h2 {
  margin: 0;
  font-family: var(--mc-font-body);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}

.details-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 0;
}

.evidence-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.evidence-lines p {
  margin: 0;
  font-size: 12px;
}

.evidence {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.fixes {
  margin: 0;
  padding: 0;
  list-style: none;
}

.fix {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
}

.fix + .fix {
  border-top: 1px solid var(--mc-border);
}

.fix.is-best {
  background: linear-gradient(90deg, var(--mc-accent-soft), transparent 70%);
}

.fix:first-child {
  border-radius: var(--mc-radius) var(--mc-radius) 0 0;
}

.fix-num {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--mc-surface-3);
  color: var(--mc-text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.is-best .fix-num {
  background: var(--mc-accent);
  color: var(--lx-on-accent);
}

.fix-text {
  flex: 1;
  min-width: 0;
}

.fix-title {
  font-weight: 600;
  font-size: 14px;
}

.fix-note {
  font-size: 13px;
  color: var(--mc-text-muted);
}

.message {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.report {
  margin-top: 16px;
}

.report p {
  margin: 0 0 10px;
  font-size: 13px;
}

.log {
  max-height: 320px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border);
  background: var(--lx-log-bg);
  font-family: var(--mc-font-mono);
  font-size: 12px;
  line-height: 1.7;
  color: var(--mc-text-muted);
  white-space: pre-wrap;
}

.time,
.is-trace {
  color: var(--lx-text-faint);
}

.is-warn {
  color: var(--mc-warning);
}

.is-error {
  color: var(--mc-danger);
}

.is-warn .time,
.is-error .time {
  color: var(--lx-text-faint);
}
</style>
