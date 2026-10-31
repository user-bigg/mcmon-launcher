<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import { ru } from '@shared/i18n/ru';
import type { NickError } from '@shared/account';
import { isValidNick } from '@shared/launch';
import { useAccounts } from '../composables/useAccounts';
import BiIcon from './BiIcon.vue';
import ProviderMark from './ProviderMark.vue';
import UiButton from './UiButton.vue';

const emit = defineEmits<{ close: [] }>();
const accounts = useAccounts();
const router = useRouter();
const card = useTemplateRef<HTMLElement>('card');
const nick = ref('');
const touched = ref(false);
const taken = ref(false);
const claimFailure = ref<NickError | null>(null);
const checking = ref(false);
const nickInvalid = computed(() => touched.value && !isValidNick(nick.value.trim()));
const nickError = computed(() => {
  if (nickInvalid.value) {
    return ru.switcher.nickInvalid;
  }
  if (taken.value) {
    return ru.welcome.nickTaken;
  }
  const failure = claimFailure.value;
  if (failure === null) {
    return null;
  }
  return failure.code === 'nick_limit' ? ru.switcher.nickLimit : ru.switcher.nickFailed;
});
// A nickname pinned to someone else's account would be refused at every launch.
async function addNick(): Promise<void> {
  touched.value = true;
  const typed = nick.value.trim();
  if (!isValidNick(typed) || checking.value) {
    return;
  }
  checking.value = true;
  const check = await accounts.checkNick(typed);
  checking.value = false;
  if (check.kind === 'nick_taken') {
    taken.value = true;
    return;
  }
  checking.value = true;
  const failure = await accounts.claimNick(typed);
  checking.value = false;
  if (failure !== null) {
    taken.value = failure.code === 'nick_taken';
    claimFailure.value = failure.code === 'nick_taken' ? null : failure;
    return;
  }
  if (accounts.addNick(typed) !== null) {
    emit('close');
  }
}

// The sign-in finishes in the browser; its progress and errors live on the accounts screen.
async function signIn(): Promise<void> {
  emit('close');
  await router.push('/accounts');
  await accounts.loginMicrosoft();
}

const FOCUSABLE = 'button:not(:disabled), input, [href]';

// Tab stays inside the dialog: the window behind it is dimmed and not for the keyboard.
function keepFocus(event: KeyboardEvent): void {
  const items = [...(card.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined) {
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close');
  } else if (event.key === 'Tab') {
    keepFocus(event);
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  card.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="add-account" role="presentation" @click.self="emit('close')">
      <section
        ref="card"
        class="add-account-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-account-title"
      >
        <header class="add-account-head">
          <h2 id="add-account-title">{{ ru.switcher.dialogTitle }}</h2>
          <UiButton icon="x-lg" icon-only :label="ru.switcher.close" @click="emit('close')" />
        </header>
        <div class="add-account-options">
          <form class="option" novalidate @submit.prevent="addNick">
            <BiIcon name="person-plus" class="option-icon" />
            <h3>{{ ru.switcher.nickTitle }}</h3>
            <p>{{ ru.switcher.nickText }}</p>
            <input
              v-model="nick"
              data-autofocus
              class="field"
              :aria-label="ru.switcher.nickLabel"
              :placeholder="ru.welcome.nickPlaceholder"
              :aria-invalid="nickError !== null"
              :aria-describedby="nickError === null ? undefined : 'add-nick-error'"
              maxlength="16"
              spellcheck="false"
              autocomplete="off"
              @input="
                touched = false;
                taken = false;
                claimFailure = null;
              "
            />
            <p v-if="nickError !== null" id="add-nick-error" class="error" role="alert">
              {{ nickError }}
            </p>
            <UiButton type="submit" block :disabled="checking">{{
              ru.switcher.nickAction
            }}</UiButton>
          </form>
          <article class="option">
            <ProviderMark provider="microsoft" size="lg" />
            <h3>{{ ru.switcher.licenseTitle }}</h3>
            <p>{{ ru.switcher.licenseText }}</p>
            <UiButton block :disabled="!accounts.microsoft.value.available" @click="signIn">
              {{ ru.switcher.licenseAction }}
            </UiButton>
          </article>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.add-account {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--lx-shade);
}

.add-account-card {
  width: min(560px, 100%);
  padding: 20px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-surface);
  box-shadow: var(--mc-shadow);
}

.add-account-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.add-account-head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.add-account-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.option {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-surface-2);
}

.option h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.option p {
  flex: 1;
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--mc-text-muted);
}

.option :deep(.btn.is-block) {
  flex: none;
  width: 100%;
}

.option-icon {
  font-size: 18px;
  color: var(--mc-text-muted);
}

.field {
  height: 32px;
  padding: 0 12px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg);
  border: 1px solid var(--mc-border);
  font-size: 13px;
  color: var(--mc-text);
}

.field[aria-invalid='true'] {
  border-color: var(--mc-danger);
}

.option .error {
  flex: none;
  color: var(--mc-danger);
}
</style>
