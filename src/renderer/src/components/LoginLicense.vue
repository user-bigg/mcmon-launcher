<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue';
import { ru } from '@shared/i18n/ru';
import { microsoftErrorView, type MicrosoftErrorCode } from '@shared/microsoft';
import microsoftLogo from '../assets/brand/microsoft.svg';
import { useAccounts } from '../composables/useAccounts';
import BiIcon from './BiIcon.vue';
import LoginWait from './LoginWait.vue';

const { label, note, blocked } = defineProps<{
  label: string | null;
  note: string;
  blocked?: boolean;
}>();

const OTHER_ACCOUNT: readonly MicrosoftErrorCode[] = ['not_owned', 'xbox_region'];

const accounts = useAccounts();
const button = useTemplateRef<HTMLButtonElement>('button');

const login = computed(() => accounts.microsoft.value.login);
const failure = computed(() => accounts.msError.value);
const error = computed(() =>
  failure.value === null ? null : microsoftErrorView(failure.value.code),
);
const action = computed(() => {
  if (failure.value === null) {
    return label;
  }
  return OTHER_ACCOUNT.includes(failure.value.code) ? ru.welcome.retryOther : ru.welcome.retry;
});

watch(login, async (now, before) => {
  if (now !== null || before === null) {
    return;
  }
  await nextTick();
  if (document.activeElement === document.body) {
    button.value?.focus();
  }
});
</script>

<template>
  <div class="lx-auth-slot">
    <LoginWait
      v-if="login !== null"
      :text="ru.welcome.waitingMicrosoft"
      :expires-at="login.phase === 'waiting' ? login.expiresAt : null"
      @cancel="accounts.cancelMicrosoft()"
      @reopen="accounts.reopenMicrosoft()"
    />
    <template v-else>
      <div v-if="error !== null" class="lx-auth-note" role="alert">
        <b>{{ error.title }}</b>
        <span class="selectable">{{ error.text }}</span>
      </div>
      <p v-else-if="note !== ''" class="lx-auth-lead">{{ note }}</p>
      <button
        v-if="action !== null"
        ref="button"
        type="button"
        class="lx-auth-btn is-main"
        :disabled="blocked || accounts.msBusy.value"
        @click="accounts.loginMicrosoft()"
      >
        <img :src="microsoftLogo" alt="" />
        {{ action }}
        <BiIcon class="lx-out" name="box-arrow-up-right" />
      </button>
    </template>
  </div>
</template>
