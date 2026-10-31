<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { GameAccount } from '@shared/player';
import { useAccounts } from '../composables/useAccounts';
import { useLaunch } from '../composables/useLaunch';
import { microsoftErrorView } from '@shared/microsoft';
import AddAccountDialog from './AddAccountDialog.vue';
import BiIcon from './BiIcon.vue';
import PlayerHead from './PlayerHead.vue';
import ProviderMark from './ProviderMark.vue';
import SkelBar from './SkelBar.vue';
import SkinFace from './SkinFace.vue';
import UiButton from './UiButton.vue';

const accounts = useAccounts();
const launch = useLaunch();
const route = useRoute();
const router = useRouter();
const root = useTemplateRef<HTMLElement>('root');
const plate = useTemplateRef<HTMLButtonElement>('plate');
const open = ref(false);
const menuFor = ref<string | null>(null);
const confirming = ref(false);
const adding = ref(false);

const account = computed(() => accounts.player.value);
const locked = computed(() => launch.busy.value);
const onAccounts = computed(() => route.meta.section === 'accounts');
const nickMissing = computed(() => accounts.pinned.value?.name === null);
const emptyLabel = computed(() => (nickMissing.value ? ru.nav.pickNick : ru.nav.noAccount));
const removeError = computed(() => {
  const error = accounts.removeError.value;
  return error === null ? null : microsoftErrorView(error.code).title;
});

function keyOf(row: GameAccount): string {
  return `${row.provider}:${row.id}`;
}

function isChosen(row: GameAccount): boolean {
  const current = account.value;
  return current !== null && keyOf(current) === keyOf(row);
}

function skinOf(row: GameAccount): string | null {
  return row.provider === 'mc-monitor' ? (accounts.mc.value?.skin?.url ?? null) : null;
}

function rowLabel(row: GameAccount): string {
  return fill(ru.switcher.select, { name: row.name, kind: ru.providers[row.provider] });
}

const plateLabel = computed(() => {
  if (!accounts.settled.value) {
    return ru.state.loading;
  }
  return account.value === null
    ? emptyLabel.value
    : fill(ru.switcher.open, { name: account.value.name });
});

async function focusIn(selector: string): Promise<void> {
  await nextTick();
  root.value?.querySelector<HTMLElement>(selector)?.focus();
}

function toggle(): void {
  if (accounts.rows.value.length === 0 && !nickMissing.value) {
    adding.value = true;
    return;
  }
  open.value = !open.value;
  closeMenu();
  if (open.value) {
    void focusIn('.switcher-row.is-selected .switcher-pick, .switcher-pick, .switcher-panel .btn');
  }
}

function closeMenu(): void {
  menuFor.value = null;
  confirming.value = false;
}

function close(returnFocus = false): void {
  open.value = false;
  closeMenu();
  if (returnFocus) {
    plate.value?.focus();
  }
}

function toggleMenu(row: GameAccount): void {
  const key = keyOf(row);
  confirming.value = false;
  menuFor.value = menuFor.value === key ? null : key;
  if (menuFor.value !== null) {
    void focusIn('.switcher-menu-item');
  }
}

function pick(row: GameAccount): void {
  if (locked.value) {
    return;
  }
  accounts.select(row);
  close(true);
}

// One more press confirms: a licence or the MC Monitor sign-in comes back only through the browser.
async function remove(row: GameAccount): Promise<void> {
  if (!confirming.value) {
    confirming.value = true;
    return;
  }
  closeMenu();
  if (row.provider === 'mc-monitor') {
    await accounts.signOut();
  } else if (row.provider === 'microsoft') {
    await accounts.removeMicrosoft(row.id);
  } else {
    accounts.removeNick(row.id);
  }
}

function startAdding(): void {
  close();
  adding.value = true;
}

function stopAdding(): void {
  adding.value = false;
  plate.value?.focus();
}

async function manage(): Promise<void> {
  close();
  await router.push('/accounts');
}

function onPointer(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (open.value && !root.value?.contains(target)) {
    close();
  } else if (menuFor.value !== null && target.closest('.switcher-row') === null) {
    closeMenu();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) {
    return;
  }
  if (menuFor.value !== null) {
    closeMenu();
    return;
  }
  close(true);
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointer);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="root" class="switcher">
    <button
      ref="plate"
      type="button"
      class="account"
      :class="{ 'is-active': open || onAccounts }"
      :aria-label="plateLabel"
      :aria-expanded="open"
      aria-controls="account-list"
      @click="toggle"
    >
      <template v-if="!accounts.settled.value">
        <SkelBar class="is-late is-raised" :w="30" :h="30" />
        <span class="account-text" data-account="loading">
          <SkelBar class="is-late is-raised" :w="96" :h="12" round />
          <SkelBar class="is-late is-raised" :w="56" :h="10" round />
        </span>
      </template>
      <template v-else-if="account !== null">
        <SkinFace v-if="skinOf(account) !== null" :skin="skinOf(account) ?? ''" />
        <PlayerHead v-else :head="account.head" />
        <span class="account-text">
          <span class="account-name">{{ account.name }}</span>
          <ProviderMark :provider="account.provider" size="sm" />
        </span>
      </template>
      <template v-else>
        <span class="account-add"><BiIcon name="person-plus" /></span>
        <span class="account-text">{{ emptyLabel }}</span>
      </template>
      <BiIcon name="chevron-expand" />
    </button>
    <section
      v-if="open"
      id="account-list"
      class="switcher-panel"
      role="dialog"
      :aria-label="ru.switcher.title"
    >
      <h2 class="switcher-title">{{ ru.switcher.title }}</h2>
      <p v-if="locked" class="switcher-locked" role="status">{{ ru.switcher.locked }}</p>
      <ul class="switcher-rows">
        <li
          v-for="row in accounts.rows.value"
          :key="keyOf(row)"
          class="switcher-row"
          :class="{ 'is-selected': isChosen(row) }"
        >
          <button
            type="button"
            class="switcher-pick"
            :disabled="locked"
            :aria-pressed="isChosen(row)"
            :aria-label="rowLabel(row)"
            @click="pick(row)"
          >
            <SkinFace v-if="skinOf(row) !== null" :skin="skinOf(row) ?? ''" />
            <PlayerHead v-else :head="row.head" />
            <span class="account-text">
              <span class="account-name">{{ row.name }}</span>
              <ProviderMark :provider="row.provider" size="sm" />
            </span>
            <BiIcon v-if="isChosen(row)" name="check-lg" class="switcher-check" />
          </button>
          <button
            type="button"
            class="switcher-more"
            :aria-label="fill(ru.switcher.more, { name: row.name })"
            :aria-expanded="menuFor === keyOf(row)"
            aria-haspopup="menu"
            :disabled="locked"
            @click="toggleMenu(row)"
          >
            <BiIcon name="three-dots" />
          </button>
          <div v-if="menuFor === keyOf(row)" class="switcher-menu" role="menu">
            <button type="button" role="menuitem" class="switcher-menu-item" @click="remove(row)">
              <BiIcon :name="row.provider === 'mc-monitor' ? 'box-arrow-right' : 'trash'" />
              <template v-if="confirming">
                {{
                  fill(
                    row.provider === 'mc-monitor'
                      ? ru.switcher.signOutSure
                      : ru.switcher.removeSure,
                    {
                      name: row.name,
                    },
                  )
                }}
              </template>
              <template v-else>
                {{ row.provider === 'mc-monitor' ? ru.switcher.signOut : ru.switcher.remove }}
              </template>
            </button>
          </div>
        </li>
      </ul>
      <p v-if="removeError !== null" class="switcher-error" role="alert">{{ removeError }}</p>
      <UiButton variant="primary" icon="plus-lg" block :disabled="locked" @click="startAdding">
        {{ ru.switcher.add }}
      </UiButton>
      <button type="button" class="switcher-manage" @click="manage">
        {{ ru.switcher.manage }}
      </button>
    </section>
    <AddAccountDialog v-if="adding" @close="stopAdding" />
  </div>
</template>

<style scoped>
.switcher {
  position: relative;
}

.account {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 46px;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: none;
  color: var(--mc-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.account-add {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface-2);
  color: var(--mc-text-muted);
  font-size: 16px;
}

.account:hover,
.account.is-active {
  background: var(--mc-surface-2);
}

.account-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.account-name {
  overflow: hidden;
  font-weight: 600;
  font-size: 13px;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account > [data-icon='chevron-expand'] {
  margin-left: auto;
  color: var(--lx-text-faint);
}

.switcher-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 40;
  padding: 12px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-surface);
  box-shadow: var(--mc-shadow);
}

.switcher-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.switcher-locked {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--mc-text-muted);
}

.switcher-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 250px;
  margin: 0 0 8px;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.switcher-row {
  position: relative;
  display: flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: var(--mc-radius-sm);
}

.switcher-row.is-selected {
  border-color: var(--mc-accent);
  background: var(--mc-surface-2);
}

.switcher-pick {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  background: none;
  color: var(--mc-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.switcher-pick:disabled,
.switcher-more:disabled {
  cursor: default;
  opacity: 0.6;
}

.switcher-check {
  margin-left: auto;
  color: var(--mc-accent);
}

.switcher-more {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: 4px;
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: none;
  color: var(--mc-text-muted);
  cursor: pointer;
}

.switcher-more:hover:not(:disabled),
.switcher-pick:hover:not(:disabled) {
  background: var(--mc-surface-2);
}

.switcher-menu {
  position: absolute;
  top: calc(100% - 4px);
  right: 4px;
  z-index: 1;
  padding: 4px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface);
  box-shadow: var(--mc-shadow);
}

.switcher-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: none;
  color: var(--mc-danger);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.switcher-menu-item:hover {
  background: var(--mc-surface-2);
}

.switcher-panel :deep(.btn.is-block) {
  width: 100%;
}

.switcher-error {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--mc-danger);
}

.switcher-manage {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 6px;
  border: 0;
  background: none;
  color: var(--mc-text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.switcher-manage:hover {
  color: var(--mc-text);
}
</style>
