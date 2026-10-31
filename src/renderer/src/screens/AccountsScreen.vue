<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import { fill, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { isValidNick } from '@shared/launch';
import { microsoftErrorView } from '@shared/microsoft';
import microsoftLogo from '../assets/brand/microsoft.svg';
import BiIcon from '../components/BiIcon.vue';
import LoginLicense from '../components/LoginLicense.vue';
import LoginMc from '../components/LoginMc.vue';
import SkelBar from '../components/SkelBar.vue';
import UiButton from '../components/UiButton.vue';
import { useAccounts } from '../composables/useAccounts';
import { useFavorites } from '../composables/useFavorites';

const accounts = useAccounts();
const favorites = useFavorites();
const nickInput = useTemplateRef<HTMLInputElement>('nickInput');

const mc = computed(() => accounts.mc.value);
const currentNick = computed(() => accounts.nick.value);
const license = computed(() => accounts.license.value);
const licenseChosen = computed(() => accounts.active.value?.provider === 'microsoft');
const licenses = computed(() => accounts.licenses.value);
const microsoft = computed(() => accounts.microsoft.value);
const mcWaiting = computed(() => accounts.mcState.value.connect !== null);
const msWaiting = computed(() => microsoft.value.login !== null);
const mcIdle = computed(
  () =>
    !mcWaiting.value &&
    accounts.mcError.value === null &&
    accounts.mcState.value.encryptionAvailable,
);
const msIdle = computed(() => !msWaiting.value && accounts.msError.value === null);
const licenseShown = computed(() => microsoft.value.available || licenses.value.length > 0);
const removeError = computed(() => {
  const failure = accounts.removeError.value;
  return failure === null ? null : microsoftErrorView(failure.code).text;
});

const nick = ref(currentNick.value?.name ?? '');
const touched = ref(false);
const nickInvalid = computed(() => touched.value && !isValidNick(nick.value));
const nickSaved = computed(() => nick.value === (currentNick.value?.name ?? ''));

watch(
  () => currentNick.value?.name,
  (name) => {
    if (!touched.value) {
      nick.value = name ?? '';
    }
  },
);

function count(value: number | null): string {
  return value === null ? '—' : formatNumber(value);
}

// The field is for the first nickname only: more are added from the account list.
function saveNick(): void {
  touched.value = accounts.addNick(nick.value) === null;
}

function focusNick(): void {
  nickInput.value?.focus();
}

onMounted(() => {
  void accounts.refreshMc();
  if (accounts.active.value === null) {
    focusNick();
  }
});
</script>

<template>
  <div class="lx-content">
    <h1 class="lx-h1">{{ ru.accounts.title }}</h1>
    <p class="lx-sub">{{ ru.accounts.subtitle }}</p>

    <div class="lx-cols is-wide-gap columns">
      <div>
        <section class="group">
          <h2>{{ ru.welcome.mcTitle }}</h2>
          <p>{{ ru.welcome.mcLead }}</p>
          <div
            v-if="!accounts.settled.value"
            class="lx-rows"
            data-mc="loading"
            role="status"
            :aria-label="ru.state.loading"
          >
            <div class="lx-row">
              <div class="lx-row-text mc-skel">
                <SkelBar :w="160" :h="15" />
                <SkelBar :w="220" :h="12" />
              </div>
              <SkelBar :w="88" :h="30" />
            </div>
          </div>
          <div v-else-if="mc !== null" class="lx-rows" data-mc="signed-in">
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title selectable" data-mc="nick">{{ mc.name }}</div>
                <div
                  v-if="mc.trusted !== true && mc.trustedReason !== null"
                  class="lx-row-desc"
                  data-mc="reason"
                >
                  {{ mc.trustedReason }}
                </div>
              </div>
              <UiButton size="sm" :disabled="accounts.mcBusy.value" @click="accounts.signOut()">
                {{ ru.accounts.signOut }}
              </UiButton>
            </div>
            <dl class="stats">
              <div data-mc="votes">
                <dt>{{ ru.accounts.mcVotes }}</dt>
                <dd>{{ count(mc.votesMonth) }}</dd>
              </div>
              <div>
                <dt>{{ ru.accounts.mcFavorites }}</dt>
                <dd>
                  {{
                    count(favorites.synced.value ? favorites.ids.value.length : mc.favoritesCount)
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ ru.accounts.mcHours }}</dt>
                <dd>{{ count(mc.hoursPlayed) }}</dd>
              </div>
            </dl>
          </div>
          <div v-else class="lx-rows">
            <div v-if="mcIdle" class="lx-row" data-mc="signed-out">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.accounts.mcSignedOut }}</div>
              </div>
              <UiButton
                size="sm"
                variant="primary"
                :disabled="msWaiting || accounts.mcBusy.value"
                @click="accounts.connectMc()"
              >
                {{ ru.welcome.mcSignIn }}<BiIcon class="lx-out" name="box-arrow-up-right" />
              </UiButton>
            </div>
            <LoginMc v-else class="pad" :blocked="msWaiting" />
          </div>
        </section>

        <form
          v-if="accounts.rows.value.length === 0"
          class="group nick"
          novalidate
          @submit.prevent="saveNick"
        >
          <h2>{{ ru.accounts.nickTitle }}</h2>
          <p>{{ ru.accounts.nickNote }}</p>
          <div class="lx-rows">
            <div class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.welcome.nickLabel }}</div>
                <div v-if="nickInvalid" id="nick-error" class="lx-row-desc error" role="alert">
                  {{ ru.welcome.nickError }}
                </div>
              </div>
              <input
                ref="nickInput"
                v-model="nick"
                class="field"
                :aria-label="ru.welcome.nickLabel"
                :placeholder="ru.welcome.nickPlaceholder"
                :aria-invalid="nickInvalid"
                :aria-describedby="nickInvalid ? 'nick-error' : undefined"
                maxlength="16"
                spellcheck="false"
                autocomplete="off"
                @input="touched = false"
              />
              <UiButton size="sm" type="submit" :disabled="nickSaved">
                {{ ru.accounts.nickSave }}
              </UiButton>
            </div>
          </div>
        </form>

        <section v-if="licenseShown" class="group last" data-license>
          <h2>{{ ru.welcome.licenseTitle }}</h2>
          <p>{{ ru.welcome.licenseNote }}</p>
          <div class="lx-rows">
            <div v-if="removeError !== null" class="pad">
              <div class="lx-auth-note" role="alert">
                <b>{{ ru.accounts.licenseRemoveFailed }}</b>
                <span class="selectable">{{ removeError }}</span>
              </div>
            </div>
            <div v-for="item in licenses" :key="item.id" class="lx-row" :data-license="item.status">
              <div class="lx-row-text">
                <div class="lx-row-title selectable">{{ item.nick }}</div>
                <div v-if="item.status === 'needs-login'" class="lx-row-desc error">
                  <BiIcon name="exclamation-triangle" />
                  {{ ru.accounts.needsLogin }}
                </div>
                <div v-else class="lx-row-desc">{{ ru.accounts.licenseConnected }}</div>
              </div>
              <UiButton
                v-if="item.status === 'needs-login' && msIdle"
                size="sm"
                :disabled="mcWaiting || accounts.msBusy.value"
                @click="accounts.loginMicrosoft()"
              >
                <img class="ms" :src="microsoftLogo" alt="" />{{ ru.welcome.retry }}
              </UiButton>
              <UiButton
                size="sm"
                :disabled="accounts.msBusy.value"
                :label="fill(ru.accounts.licenseRemoveFor, { nick: item.nick })"
                @click="accounts.removeMicrosoft(item.id)"
              >
                {{ ru.accounts.licenseRemove }}
              </UiButton>
            </div>
            <div v-if="licenses.length === 0 && msIdle" class="lx-row">
              <div class="lx-row-text">
                <div class="lx-row-title">{{ ru.accounts.licenseNone }}</div>
              </div>
              <UiButton
                size="sm"
                :disabled="mcWaiting || accounts.msBusy.value"
                @click="accounts.loginMicrosoft()"
              >
                <img class="ms" :src="microsoftLogo" alt="" />{{ ru.accounts.licenseAdd
                }}<BiIcon class="lx-out" name="box-arrow-up-right" />
              </UiButton>
            </div>
            <LoginLicense
              v-if="!msIdle"
              class="pad"
              :label="ru.welcome.retry"
              note=""
              :blocked="mcWaiting"
            />
          </div>
        </section>
      </div>

      <section class="group last" data-who>
        <h2>{{ ru.accounts.whoTitle }}</h2>
        <p>{{ ru.accounts.whoNote }}</p>
        <div class="lx-rows">
          <div v-if="licenseChosen && license !== null" class="lx-row" data-who="all">
            <div class="lx-row-text">
              <div class="lx-row-title">{{ ru.accounts.whereAll }}</div>
              <div v-if="license.status === 'needs-login'" class="lx-row-desc error">
                <BiIcon name="exclamation-triangle" />{{ ru.accounts.needsLogin }}
              </div>
            </div>
            <b class="who selectable">{{ license.nick }}</b>
          </div>
          <div v-if="!licenseChosen" class="lx-row" data-who="nick">
            <div class="lx-row-text">
              <div class="lx-row-title">{{ ru.accounts.whereNick }}</div>
            </div>
            <b v-if="accounts.playNick.value !== null" class="who selectable">{{
              accounts.playNick.value
            }}</b>
            <UiButton v-else size="sm" @click="focusNick">{{ ru.accounts.nickSet }}</UiButton>
          </div>
          <div v-if="licenseShown && !licenseChosen" class="lx-row" data-who="license">
            <div class="lx-row-text">
              <div class="lx-row-title">{{ ru.accounts.whereLicense }}</div>
              <div v-if="license?.status === 'needs-login'" class="lx-row-desc error">
                <BiIcon name="exclamation-triangle" />{{ ru.accounts.needsLogin }}
              </div>
            </div>
            <b v-if="license !== null" class="who selectable">{{ license.nick }}</b>
            <span v-else class="lx-muted">{{ ru.accounts.licenseNone }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mc-skel {
  display: grid;
  gap: 8px;
}

.columns {
  margin-top: 24px;
}

.group {
  margin-bottom: 26px;
}

.group.last {
  margin-bottom: 0;
}

.group h2 {
  margin: 0 0 4px;
  font-family: var(--mc-font-body);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}

.group > p {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.pad {
  min-height: 0;
  padding: 13px 16px;
}

.lx-row + .pad,
.pad + .lx-row {
  border-top: 1px solid var(--mc-border);
}

.stats {
  display: flex;
  margin: 0;
  border-top: 1px solid var(--mc-border);
}

.stats > div {
  display: flex;
  flex: 1;
  flex-direction: column-reverse;
  padding: 12px 16px;
}

.stats > div + div {
  border-left: 1px solid var(--mc-border);
}

.stats dd {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stats dt {
  font-size: 12px;
  color: var(--mc-text-muted);
}

.field {
  width: 200px;
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

.error {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--mc-danger);
}

.who {
  font-weight: 600;
}

[data-who] .lx-row-title {
  white-space: nowrap;
}

.ms {
  width: 13px;
  height: 13px;
}
</style>
