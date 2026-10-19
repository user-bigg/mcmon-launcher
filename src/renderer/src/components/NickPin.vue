<script setup lang="ts">
import { computed, onMounted, ref, useId, useTemplateRef } from 'vue';
import { sameNickLetters, type NickError } from '@shared/account';
import { ru } from '@shared/i18n/ru';
import { isValidNick } from '@shared/launch';
import { useAccounts } from '../composables/useAccounts';
import { nickErrorText } from '../lib/account';
import UiButton from './UiButton.vue';

const {
  first,
  suggestion = '',
  current = null,
  changeFrom = null,
} = defineProps<{
  first: boolean;
  suggestion?: string;
  current?: string | null;
  changeFrom?: string | null;
}>();
const emit = defineEmits<{ done: []; cancel: [] }>();

const accounts = useAccounts();
const id = useId();
const input = useTemplateRef<HTMLInputElement>('input');
const nick = ref(suggestion);
const failure = ref<NickError | null>(null);
const saving = ref(false);
const errorText = computed(() => (failure.value === null ? null : nickErrorText(failure.value)));

async function submit(): Promise<void> {
  if (saving.value) {
    return;
  }
  if (!isValidNick(nick.value)) {
    failure.value = { code: 'invalid_nick' };
    return;
  }
  // Fixing the case of letters is not a change and is allowed at any time; a real change
  // before the date would only come back as a refusal.
  const caseOnly = current !== null && sameNickLetters(current, nick.value);
  if (changeFrom !== null && !caseOnly) {
    failure.value = { code: 'nick_change_too_soon', changeAt: changeFrom };
    return;
  }
  saving.value = true;
  failure.value = await accounts.pinNick(nick.value);
  saving.value = false;
  if (failure.value === null) {
    emit('done');
  }
}

function focus(): void {
  input.value?.focus();
}

defineExpose({ focus });
onMounted(focus);
</script>

<template>
  <form class="lx-row pin" novalidate data-nick-pin @submit.prevent="submit">
    <div class="lx-row-title">
      {{ first ? ru.accounts.nickPickTitle : ru.accounts.nickNew }}
    </div>
    <div class="controls">
      <input
        ref="input"
        v-model="nick"
        class="field"
        :aria-label="ru.welcome.nickLabel"
        :placeholder="ru.welcome.nickPlaceholder"
        :aria-invalid="errorText !== null"
        :aria-describedby="`${id}-note`"
        maxlength="16"
        spellcheck="false"
        autocomplete="off"
        @input="failure = null"
      />
      <UiButton size="sm" variant="primary" type="submit" :disabled="saving">
        {{ first ? ru.accounts.nickPick : ru.accounts.nickChange }}
      </UiButton>
      <UiButton v-if="!first" size="sm" :disabled="saving" @click="emit('cancel')">
        {{ ru.accounts.nickCancel }}
      </UiButton>
    </div>
    <div v-if="errorText !== null" :id="`${id}-note`" class="lx-row-desc error" role="alert">
      {{ errorText }}
    </div>
    <div v-else :id="`${id}-note`" class="lx-row-desc">
      {{ first ? ru.accounts.nickPickNote : ru.accounts.nickChangeNote }}
    </div>
  </form>
</template>

<style scoped>
.pin {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field {
  flex: 1;
  min-width: 0;
  max-width: 280px;
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

.field[aria-invalid='true']:focus-visible {
  outline-color: var(--mc-danger);
}

.lx-row-desc {
  min-height: calc(2 * 1.4em);
  margin: 0;
}

.error {
  color: var(--mc-danger);
}
</style>
