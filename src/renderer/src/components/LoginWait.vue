<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { useLauncher } from '../composables/context';
import { countdown, remainingSeconds } from '../lib/account';

const { text, expiresAt } = defineProps<{ text: string; expiresAt: string | null }>();
const emit = defineEmits<{ cancel: []; reopen: [] }>();

const context = useLauncher();
const now = ref(context.now());
const cancel = useTemplateRef<HTMLButtonElement>('cancel');
let timer: ReturnType<typeof setInterval> | undefined;

const left = computed(() =>
  expiresAt === null
    ? null
    : fill(ru.welcome.left, { time: countdown(remainingSeconds(expiresAt, now.value)) }),
);

onMounted(() => {
  timer = setInterval(() => {
    now.value = context.now();
  }, 1000);
  // The sign-in button that had the focus is gone: keep the keyboard on this block.
  if (document.activeElement === document.body) {
    cancel.value?.focus();
  }
});

onBeforeUnmount(() => {
  clearInterval(timer);
});
</script>

<template>
  <div class="wait" data-login="wait">
    <div class="head" role="status">
      <span class="spin" aria-hidden="true"></span>
      <span>{{ left === null ? ru.welcome.exchanging : ru.welcome.waiting }}</span>
      <span v-if="left !== null" class="left" aria-hidden="true">{{ left }}</span>
    </div>
    <slot>
      <p class="text">{{ text }}</p>
      <div class="actions">
        <button ref="cancel" type="button" class="cancel" @click="emit('cancel')">
          {{ ru.welcome.cancel }}
        </button>
        <button v-if="left !== null" type="button" class="link" @click="emit('reopen')">
          {{ ru.welcome.reopen }}
        </button>
        <slot name="links" />
      </div>
    </slot>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.spin {
  flex: none;
  width: 16px;
  height: 16px;
  border: 2px solid var(--mc-text-dim);
  border-top-color: var(--mc-text);
  border-radius: 50%;
}

@media (prefers-reduced-motion: no-preference) {
  .spin {
    animation: login-spin 1s linear infinite;
  }
}

.left {
  margin-left: auto;
  font-size: 13px;
  font-weight: 400;
  color: var(--mc-text-muted);
  font-variant-numeric: tabular-nums;
}

.text {
  margin: 4px 0 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--mc-text-muted);
}

.actions {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 8px;
}

.cancel {
  flex: none;
  height: 36px;
  padding: 0 16px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-2);
  color: var(--mc-text);
  font-size: 14px;
}

.cancel:hover {
  border-color: var(--mc-border-strong);
  background: var(--mc-surface-3);
}

.link,
.actions :slotted(.link) {
  padding: 0;
  border: 0;
  background: none;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  color: var(--mc-text-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link:hover,
.actions :slotted(.link:hover) {
  color: var(--mc-text);
}

@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
