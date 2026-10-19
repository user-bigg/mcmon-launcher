<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import { ru } from '@shared/i18n/ru';
import { useAccounts } from '../composables/useAccounts';
import { codeErrorText, connectErrorView } from '../lib/account';
import BiIcon from './BiIcon.vue';
import LoginWait from './LoginWait.vue';

const { blocked, lead } = defineProps<{ blocked?: boolean; lead?: boolean }>();

const accounts = useAccounts();
const id = useId();
const button = useTemplateRef<HTMLButtonElement>('button');
const manual = ref(false);
const code = ref('');

const connect = computed(() => accounts.mcState.value.connect);
const error = computed(() => {
  const failure = accounts.mcError.value;
  return failure === null || connect.value !== null ? null : connectErrorView(failure);
});
const codeError = computed(() => {
  const failure = accounts.mcError.value;
  return failure === null || connect.value === null ? null : codeErrorText(failure);
});
const encrypted = computed(() => accounts.mcState.value.encryptionAvailable);

async function openManual(): Promise<void> {
  manual.value = true;
  await nextTick();
  document.getElementById(`${id}-code`)?.focus();
}

function closeManual(): void {
  manual.value = false;
  code.value = '';
}

async function submitCode(): Promise<void> {
  if (await accounts.submitMcCode(code.value)) {
    closeManual();
  }
}

async function cancel(): Promise<void> {
  closeManual();
  await accounts.cancelMc();
}

watch(connect, async (now, before) => {
  if (now !== null || before === null) {
    return;
  }
  closeManual();
  await nextTick();
  if (document.activeElement === document.body) {
    button.value?.focus();
  }
});
</script>

<template>
  <div class="lx-auth-slot" data-mc="signed-out">
    <LoginWait
      v-if="connect !== null"
      :text="ru.welcome.waitingMc"
      :expires-at="connect.phase === 'waiting' ? connect.expiresAt : null"
      @cancel="cancel"
      @reopen="accounts.reopenMc()"
    >
      <template v-if="manual" #default>
        <p
          :id="`${id}-note`"
          class="lx-auth-lead note"
          :class="{ 'is-error': codeError !== null, selectable: codeError !== null }"
          :role="codeError === null ? undefined : 'alert'"
        >
          {{ codeError ?? ru.welcome.manualNote }}
        </p>
        <form class="code" novalidate @submit.prevent="submitCode">
          <label class="lx-auth-field is-compact">
            <input
              :id="`${id}-code`"
              v-model="code"
              class="lx-mono"
              maxlength="16"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="characters"
              :aria-label="ru.welcome.manualLabel"
              :placeholder="ru.welcome.manualPlaceholder"
              :aria-describedby="`${id}-note`"
              :aria-invalid="codeError !== null"
            />
          </label>
          <button type="submit" class="lx-auth-btn" :disabled="accounts.mcBusy.value">
            {{ ru.welcome.manualSubmit }}
          </button>
          <button type="button" class="lx-auth-btn" @click="cancel">
            {{ ru.welcome.cancel }}
          </button>
        </form>
      </template>
      <template v-else #links>
        <button type="button" class="link" data-manual @click="openManual">
          {{ ru.welcome.manual }}
        </button>
      </template>
    </LoginWait>
    <template v-else>
      <div v-if="error !== null" class="lx-auth-note" role="alert">
        <b>{{ error.title }}</b>
        <span>{{ error.text }}</span>
      </div>
      <p v-else-if="!encrypted" class="lx-auth-lead" role="alert">
        {{ ru.account.noEncryption }}
      </p>
      <p v-else class="lx-auth-lead" :class="{ 'is-main': lead }">{{ ru.welcome.mcLead }}</p>
      <button
        ref="button"
        type="button"
        class="lx-auth-btn is-main is-primary"
        :disabled="blocked || accounts.mcBusy.value || !encrypted"
        @click="accounts.connectMc()"
      >
        {{ error === null ? ru.welcome.mcSignIn : ru.welcome.retry }}
        <BiIcon class="lx-out" name="box-arrow-up-right" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.note {
  margin-top: 4px;
}

.code {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.code input {
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.code input::placeholder {
  letter-spacing: 0;
}
</style>
