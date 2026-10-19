<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { fill, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import {
  MAX_REPORT_NOTE_LENGTH,
  noteRequired,
  reportReady,
  type MyReport,
  type ReportError,
  type ServerReport,
} from '@shared/report';
import type { SiteError } from '@shared/site';
import { useLauncher } from '../composables/context';
import { useAccounts } from '../composables/useAccounts';
import { useSite } from '../composables/useSite';
import { limitText, noteRequiredText, reportedText, reportErrorText } from '../lib/report';
import BiIcon from './BiIcon.vue';
import FillText from './FillText.vue';
import SiteErrorState from './SiteErrorState.vue';
import StateNotice from './StateNotice.vue';
import UiButton from './UiButton.vue';

const SENT_MS = 5000;
const MAX_TIMER_MS = 2 ** 31 - 1;

const { serverId, report } = defineProps<{ serverId: number; report: ServerReport | null }>();

const launcher = useLauncher();
const accounts = useAccounts();
const site = useSite();
const id = useId();
const linkButton = useTemplateRef<HTMLButtonElement>('link');
const form = useTemplateRef<HTMLFormElement>('form');
const statusLine = useTemplateRef<HTMLElement>('status');

const guestWrap = useTemplateRef<HTMLElement>('guestWrap');
const guestHintOpen = ref(false);

const mine = ref<MyReport | null>(null);
const owned = ref(false);
const limited = ref<ReportError | null>(null);
const open = ref(false);
const loading = ref(false);
const reasonsError = ref<SiteError | null>(null);
const reason = ref('');
const note = ref('');
const sending = ref(false);
const error = ref<ReportError | null>(null);
const justSent = ref(false);
let sentTimer: ReturnType<typeof setTimeout> | undefined;
let resetTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => [serverId, report] as const,
  () => {
    mine.value = report?.mine ?? null;
    owned.value = false;
    setLimited(null);
    justSent.value = false;
    clearTimeout(sentTimer);
    reset();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearTimeout(sentTimer);
  clearTimeout(resetTimer);
  closeGuestHint();
});

function onOutsideGuestClick(event: MouseEvent): void {
  if (!guestWrap.value?.contains(event.target as Node)) {
    closeGuestHint();
  }
}

function onGuestKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeGuestHint();
  }
}

function closeGuestHint(): void {
  guestHintOpen.value = false;
  document.removeEventListener('click', onOutsideGuestClick, true);
  document.removeEventListener('keydown', onGuestKeydown, true);
}

function toggleGuestHint(): void {
  if (guestHintOpen.value) {
    closeGuestHint();
    return;
  }
  guestHintOpen.value = true;
  document.addEventListener('click', onOutsideGuestClick, true);
  document.addEventListener('keydown', onGuestKeydown, true);
}

const signedIn = computed(() => accounts.mc.value !== null);
const reasons = computed(() => site.reportReasons.value);
const visible = computed(() => report !== null && (report.allowed || mine.value !== null));
const needsNote = computed(() => noteRequired(reason.value));
const ready = computed(() => reportReady({ reason: reason.value, note: note.value }));
const statusText = computed(() => {
  if (justSent.value) {
    return ru.report.sent;
  }
  if (mine.value !== null) {
    return reportedText(mine.value.at);
  }
  if (owned.value) {
    return ru.report.errors.own_server;
  }
  return limited.value === null ? '' : limitText(limited.value, launcher.now());
});
const showLink = computed(() => !open.value && statusText.value === '');
const networkError = computed<SiteError | null>(() => {
  const code = error.value?.code;
  return code === 'offline' || code === 'timeout' ? { code } : null;
});

function setLimited(value: ReportError | null): void {
  clearTimeout(resetTimer);
  limited.value = value;
  const resetsAt = value?.resetsAt;
  if (resetsAt === undefined) {
    return;
  }
  const delay = Date.parse(resetsAt) - launcher.now().getTime();
  if (delay > 0) {
    resetTimer = setTimeout(
      () => {
        limited.value = null;
      },
      Math.min(delay, MAX_TIMER_MS),
    );
  }
}

function focusLater(target: () => HTMLElement | null | undefined): void {
  void nextTick(() => {
    target()?.focus();
  });
}

function inForm(selector: string): HTMLElement | null | undefined {
  return form.value?.querySelector<HTMLElement>(selector);
}

function focusForm(): void {
  focusLater(() => inForm('input[type="radio"]') ?? inForm('[data-report-notice] button'));
}

async function loadReasons(revalidate: boolean): Promise<void> {
  loading.value = true;
  const failure = await site.load(revalidate);
  loading.value = false;
  reasonsError.value = failure;
  open.value = true;
  focusForm();
}

function openForm(): void {
  if (loading.value) {
    return;
  }
  error.value = null;
  if (reasons.value.length === 0) {
    void loadReasons(false);
    return;
  }
  open.value = true;
  focusForm();
}

function reload(): void {
  if (!loading.value) {
    void loadReasons(true);
  }
}

function reset(): void {
  open.value = false;
  reason.value = '';
  note.value = '';
  error.value = null;
  reasonsError.value = null;
}

function close(): void {
  if (sending.value) {
    return;
  }
  reset();
  focusLater(() => linkButton.value);
}

function focusStatus(): void {
  focusLater(() => statusLine.value);
}

function settle(at: MyReport): void {
  open.value = false;
  mine.value = at;
  justSent.value = true;
  clearTimeout(sentTimer);
  sentTimer = setTimeout(() => {
    justSent.value = false;
  }, SENT_MS);
  focusStatus();
}

function refuse(failure: ReportError): void {
  if (failure.code === 'own_server') {
    open.value = false;
    owned.value = true;
    focusStatus();
    return;
  }
  if (failure.code === 'already_reported') {
    open.value = false;
    mine.value = { at: failure.reportedAt ?? launcher.now().toISOString() };
    focusStatus();
    return;
  }
  if (failure.code === 'daily_limit') {
    open.value = false;
    setLimited(failure);
    focusStatus();
    return;
  }
  error.value = failure;
  focusLater(
    () => inForm('[data-report-failure] :is(a, button)') ?? inForm('[data-report-submit]'),
  );
}

async function submit(): Promise<void> {
  if (!ready.value || sending.value) {
    return;
  }
  sending.value = true;
  const target = serverId;
  const draft = { reason: reason.value, note: note.value.trim() };
  const result = launcher.demo
    ? { ok: true as const, value: { at: launcher.now().toISOString() } }
    : await launcher.api.site.report(target, draft);
  sending.value = false;
  if (target !== serverId) {
    return;
  }
  if (result.ok) {
    settle(result.value);
  } else {
    refuse(result.error);
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  close();
}
</script>

<template>
  <div class="report" data-report>
    <div v-if="!signedIn" ref="guestWrap" class="guest-wrap">
      <div v-if="guestHintOpen" class="guest-hint" role="tooltip" data-report-guest>
        <FillText :text="ru.report.guestHint">
          <template #signIn>
            <RouterLink class="sign-in" to="/accounts" @click="closeGuestHint">{{
              ru.report.guestSignIn
            }}</RouterLink>
          </template>
        </FillText>
      </div>
      <button type="button" class="link" @click="toggleGuestHint">
        <BiIcon name="flag" />{{ ru.report.link }}
      </button>
    </div>
    <template v-else-if="visible">
      <p
        ref="status"
        class="line status"
        tabindex="-1"
        :class="{ 'is-empty': statusText === '' }"
        data-report-status
      >
        <template v-if="statusText !== ''">
          <BiIcon
            :name="justSent ? 'check-circle-fill' : 'flag-fill'"
            :class="{ sent: justSent }"
          />{{ statusText }}
        </template>
      </p>
      <button
        v-if="showLink"
        ref="link"
        type="button"
        class="link"
        :aria-busy="loading"
        @click="openForm"
      >
        <BiIcon name="flag" />{{ ru.report.link }}
      </button>
      <form
        v-if="open"
        ref="form"
        class="form"
        novalidate
        data-report-form
        @submit.prevent="submit"
        @keydown="onKeydown"
      >
        <template v-if="reasons.length > 0">
          <fieldset class="reasons" role="radiogroup" :aria-labelledby="`${id}-title`">
            <legend :id="`${id}-title`" class="title">{{ ru.report.title }}</legend>
            <label v-for="item in reasons" :key="item.code" class="reason">
              <input v-model="reason" type="radio" :name="`${id}-reason`" :value="item.code" />
              <span>{{ item.label }}</span>
            </label>
          </fieldset>
          <div class="note">
            <label :for="`${id}-note`" class="note-label">
              {{ needsNote ? noteRequiredText() : ru.report.noteOptional }}
            </label>
            <textarea
              :id="`${id}-note`"
              v-model="note"
              class="field"
              rows="3"
              :maxlength="MAX_REPORT_NOTE_LENGTH"
              :placeholder="ru.report.notePlaceholder"
              :aria-required="needsNote"
              :aria-describedby="`${id}-count`"
            />
            <span :id="`${id}-count`" class="count">
              {{
                fill(ru.report.noteCount, {
                  count: formatNumber(note.length),
                  max: formatNumber(MAX_REPORT_NOTE_LENGTH),
                })
              }}
            </span>
          </div>
        </template>
        <div v-else data-report-notice>
          <SiteErrorState v-if="reasonsError !== null" :error="reasonsError" @retry="reload" />
          <StateNotice
            v-else
            icon="info-circle"
            :title="ru.report.reasonsEmptyTitle"
            :text="ru.report.reasonsEmptyText"
            live="alert"
          >
            <UiButton size="sm" icon="arrow-clockwise" @click="reload">
              {{ ru.state.retry }}
            </UiButton>
          </StateNotice>
        </div>
        <div v-if="error !== null" data-report-failure>
          <SiteErrorState v-if="networkError !== null" :error="networkError" @retry="submit" />
          <div v-else class="error" role="alert" data-report-error>
            <span>{{ reportErrorText(error) }}</span>
            <UiButton
              v-if="error.code === 'email_unverified'"
              size="sm"
              icon="box-arrow-up-right"
              :href="site.links.value.logins"
            >
              {{ ru.report.openSite }}
            </UiButton>
          </div>
        </div>
        <div class="actions">
          <UiButton
            v-if="reasons.length > 0"
            type="submit"
            variant="primary"
            size="sm"
            :disabled="!ready || sending"
            data-report-submit
          >
            {{ ru.report.submit }}
          </UiButton>
          <UiButton size="sm" :disabled="sending" @click="close()">{{ ru.report.cancel }}</UiButton>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.report:empty {
  display: none;
}

.line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.guest-wrap {
  position: relative;
  display: inline-block;
}

.guest-hint {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 10px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-3);
  color: var(--mc-text);
  font-size: 13px;
  white-space: nowrap;
  box-shadow: var(--mc-shadow);
}

/* Two stacked triangles fake a continuous border around the pointer: */
/* a slightly larger one in the border color sits behind a smaller one in the fill color. */
.guest-hint::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 13px;
  border: 7px solid transparent;
  border-top-color: var(--mc-border-strong);
}

.guest-hint::after {
  content: '';
  position: absolute;
  top: calc(100% - 1px);
  left: 14px;
  border: 6px solid transparent;
  border-top-color: var(--mc-surface-3);
}

.line.is-empty {
  display: block;
  height: 0;
}

.status .bi {
  font-size: 13px;
}

.status .sent {
  color: var(--mc-accent);
}

.sign-in {
  color: var(--mc-accent);
  text-decoration: none;
  text-underline-offset: 4px;
}

.sign-in:hover {
  text-decoration: underline;
}

.link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: 0;
  background: none;
  font-size: 13px;
  color: var(--mc-text-muted);
  text-underline-offset: 4px;
}

.link:hover {
  color: var(--mc-text);
  text-decoration: underline;
}

.form {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-surface);
}

.reasons {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  border: 0;
}

.title {
  margin-bottom: 6px;
  padding: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--mc-text);
}

.reason {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-radius: var(--mc-radius-sm);
  font-size: 13px;
  color: var(--mc-text);
}

.reason:hover {
  background: var(--mc-surface-2);
}

.reason input {
  margin: 0;
  accent-color: var(--mc-accent);
}

.note {
  display: grid;
  gap: 6px;
}

.note-label {
  font-size: 13px;
  color: var(--mc-text-muted);
}

.field {
  width: 100%;
  min-height: 72px;
  padding: 8px 10px;
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg);
  font: inherit;
  font-size: 13px;
  color: var(--mc-text);
  resize: vertical;
}

.field::placeholder {
  color: var(--lx-text-faint);
}

.count {
  justify-self: end;
  font-size: 12px;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
}

.error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  font-size: 13px;
  color: var(--mc-danger);
}

.actions {
  display: flex;
  gap: 8px;
}
</style>
