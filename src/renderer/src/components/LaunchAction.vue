<script setup lang="ts">
import { computed } from 'vue';
import type { ServerRow } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { isHttpsUrl } from '@shared/links';
import type { PlaySource } from '@shared/telemetry';
import { usePlay } from '../composables/usePlay';
import { useTrack } from '../composables/useTrack';
import UiButton from './UiButton.vue';

const {
  server,
  size = 'sm',
  solid,
  needsInstall,
  compact,
  narrow,
  source = 'other',
} = defineProps<{
  server: ServerRow;
  size?: 'sm' | 'md' | 'lg';
  solid?: boolean;
  needsInstall?: boolean;
  compact?: boolean;
  // In a catalog row the tag next to the name already says whose launcher it is, so the button names the action.
  narrow?: boolean;
  source?: PlaySource | undefined;
}>();

const { playServer } = usePlay();
const track = useTrack();

const own = computed(() => {
  const launch = server.launch;
  if (launch.kind !== 'own_launcher') {
    return null;
  }
  return {
    url: isHttpsUrl(launch.url) ? launch.url : undefined,
    text: narrow ? ru.launch.ownLauncherRow : compact ? ru.launch.ownLauncherShort : launch.label,
    label: fill(ru.launch.ownLauncherOn, { label: launch.label, name: server.name }),
  };
});

function play(): void {
  void playServer(server, { source });
}

function openOwnLauncher(): void {
  track({ type: 'action', name: 'own_launcher_open', server_id: server.id });
}
</script>

<template>
  <UiButton
    v-if="server.launch.kind === 'direct'"
    :variant="solid ? 'play' : 'play-soft'"
    :size="size"
    :icon="needsInstall ? 'download' : 'play-fill'"
    :label="fill(ru.launch.playOn, { name: server.name })"
    data-launch="direct"
    @click="play"
  >
    {{ needsInstall ? ru.launch.installAndPlay : ru.launch.play }}
  </UiButton>
  <UiButton
    v-else-if="own !== null && own.url !== undefined"
    variant="ghost"
    :size="size"
    :icon="compact ? 'download' : 'box-arrow-up-right'"
    :href="own.url"
    :label="own.label"
    data-launch="own_launcher"
    @click="openOwnLauncher"
  >
    {{ own.text }}
  </UiButton>
  <UiButton
    v-else-if="own !== null"
    variant="ghost"
    :size="size"
    icon="box-arrow-up-right"
    disabled
    :label="ru.serverPage.ownInvalid"
    data-launch="own_launcher"
  >
    {{ own.text }}
  </UiButton>
  <UiButton
    v-else
    variant="ghost"
    :size="size"
    icon="info-circle"
    :to="`/server/${String(server.id)}?join=1`"
    :label="fill(ru.launch.howToJoinOn, { name: server.name })"
    data-launch="none"
  >
    {{ ru.launch.howToJoin }}
  </UiButton>
</template>
