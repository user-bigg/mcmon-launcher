<script setup lang="ts">
import { ru } from '@shared/i18n/ru';
import microsoftLogo from '../assets/brand/microsoft.svg';
import mcMonitorLogo from '../assets/logo.svg';
import type { AccountProvider } from '@shared/player';
import BiIcon from './BiIcon.vue';

const {
  provider,
  size = 'md',
  text,
} = defineProps<{
  provider: AccountProvider;
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}>();

const logos: Partial<Record<AccountProvider, string>> = {
  microsoft: microsoftLogo,
  'mc-monitor': mcMonitorLogo,
};
</script>

<template>
  <span class="provider" :class="`is-${size}`">
    <img v-if="logos[provider]" class="logo" :src="logos[provider]" alt="" />
    <BiIcon v-else name="person-badge" />
    <span v-if="size !== 'lg'">{{ text ?? ru.providers[provider] }}</span>
  </span>
</template>

<style scoped>
.provider {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--mc-text-muted);
  white-space: nowrap;
}

.provider.is-sm {
  gap: 4px;
  font-size: 11px;
}

.logo {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

.is-lg .logo {
  width: 18px;
  height: 18px;
}

.is-lg .bi {
  font-size: 18px;
}
</style>
