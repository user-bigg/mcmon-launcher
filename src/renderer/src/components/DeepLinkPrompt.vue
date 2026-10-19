<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { useCatalog } from '../composables/useCatalog';
import { useDeepLink } from '../composables/useDeepLink';
import { useLaunch } from '../composables/useLaunch';
import { usePlay } from '../composables/usePlay';
import { addressLabel } from '../lib/minecraft';
import UiButton from './UiButton.vue';

const deepLink = useDeepLink();
const catalog = useCatalog();
const launch = useLaunch();
const router = useRouter();
const { playServer } = usePlay();
const card = useTemplateRef<HTMLElement>('card');

const server = computed(() => {
  const link = deepLink.pending.value;
  return link === null ? undefined : catalog.server(link.serverId);
});

const loading = computed(() => server.value === undefined && catalog.status.value === 'loading');

const title = computed(() => {
  const link = deepLink.pending.value;
  if (link === null) {
    return '';
  }
  const current = server.value;
  if (current !== undefined) {
    return fill(ru.deepLink.title, { name: current.name });
  }
  return fill(loading.value ? ru.deepLink.loading : ru.deepLink.unknown, { id: link.serverId });
});

const address = computed(() =>
  server.value === undefined ? null : addressLabel(server.value.address),
);

const playable = computed(() => server.value?.launch.kind === 'direct');
const busyText = computed(() =>
  launch.busy.value
    ? fill(ru.deepLink.busy, { name: launch.job.value?.name ?? ru.deepLink.busyFallback })
    : null,
);
const canConfirm = computed(() => deepLink.armed.value && !launch.busy.value);

watch(
  () => deepLink.pending.value,
  async (link) => {
    if (link === null) {
      return;
    }
    await router.push(`/server/${String(link.serverId)}`);
    await nextTick();
    card.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  },
);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && deepLink.pending.value !== null) {
    event.preventDefault();
    deepLink.dismiss();
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});

async function confirm(): Promise<void> {
  const current = server.value;
  const link = deepLink.pending.value;
  if (current === undefined || link === null || !canConfirm.value) {
    return;
  }
  deepLink.dismiss();
  await playServer(current, {
    source: link.source ?? 'deeplink',
    ...(link.launchId === undefined ? {} : { launchId: link.launchId }),
  });
}
</script>

<template>
  <div v-if="deepLink.pending.value !== null" class="deep-link" role="presentation">
    <section
      ref="card"
      class="deep-link-card"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="deep-link-title"
      aria-describedby="deep-link-text"
      tabindex="-1"
    >
      <h2 id="deep-link-title" :aria-busy="loading">{{ title }}</h2>
      <p v-if="address !== null" class="deep-link-address lx-mono selectable">{{ address }}</p>
      <p id="deep-link-text">{{ ru.deepLink.text }}</p>
      <p v-if="playable && busyText !== null" class="deep-link-busy" role="status">
        {{ busyText }}
      </p>
      <div class="deep-link-actions">
        <UiButton data-autofocus @click="deepLink.dismiss()">{{ ru.deepLink.cancel }}</UiButton>
        <UiButton v-if="playable" variant="play" :disabled="!canConfirm" @click="confirm()">
          {{ ru.deepLink.confirm }}
        </UiButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.deep-link {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--lx-shade);
}

.deep-link-card {
  max-width: 440px;
  padding: 24px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-surface);
  box-shadow: var(--mc-shadow);
}

.deep-link-card h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}

.deep-link-card p {
  margin: 0 0 20px;
  color: var(--mc-text-muted);
}

.deep-link-card .deep-link-address {
  margin: -4px 0 12px;
  color: var(--mc-text);
  overflow-wrap: anywhere;
}

.deep-link-card .deep-link-busy {
  margin-top: -12px;
  color: var(--mc-text);
}

.deep-link-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
