<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useRouter } from 'vue-router';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { isValidNick } from '@shared/launch';
import FillText from '../components/FillText.vue';
import LoginLicense from '../components/LoginLicense.vue';
import LoginMc from '../components/LoginMc.vue';
import PixelLandscape from '../components/PixelLandscape.vue';
import { useAccounts } from '../composables/useAccounts';
import { accountTitle } from '../lib/account';
import { useExternal } from '../composables/useExternal';
import { useScenes } from '../composables/useScenes';
import { useSite } from '../composables/useSite';

const router = useRouter();
const accounts = useAccounts();
const external = useExternal();
const scenes = useScenes();
const siteLinks = useSite().links;
const id = useId();

const pick = computed(() => scenes.sceneFor('pulse') ?? scenes.sceneFor('welcome'));

const mc = computed(() => accounts.mc.value);
const license = computed(() => accounts.license.value);
const mcWaiting = computed(() => accounts.mcState.value.connect !== null);
const msWaiting = computed(() => accounts.microsoft.value.login !== null);
const PROFILE_WAIT_MS = 3000;
const finishing = ref(false);
const waiting = computed(() => mcWaiting.value || msWaiting.value || finishing.value);
const licenseShown = computed(() => accounts.microsoft.value.available || license.value !== null);

const nick = ref('');
const touched = ref(false);
const taken = ref(false);
const checking = ref(false);
const nickInvalid = computed(() => touched.value && !isValidNick(nick.value));
const nickError = computed(() => {
  if (taken.value) {
    return ru.welcome.nickTaken;
  }
  return nickInvalid.value ? ru.welcome.nickError : null;
});

function finish(): void {
  const mustPick = accounts.pinned.value?.name === null;
  const nobody = accounts.playNick.value === null && accounts.license.value === null;
  void router.replace(mustPick || nobody ? '/accounts' : '/');
}

// The profile says whether a nickname is pinned; a slow site must not keep the player here,
// the account screen shows the pick step whenever the answer arrives.
async function finishSignedIn(): Promise<void> {
  finishing.value = true;
  const late = new Promise<void>((resolve) => {
    setTimeout(resolve, PROFILE_WAIT_MS);
  });
  await Promise.race([accounts.refreshMc().catch(() => undefined), late]);
  finishing.value = false;
  finish();
}

function editNick(): void {
  touched.value = false;
  taken.value = false;
}

async function submitNick(): Promise<void> {
  touched.value = true;
  if (!isValidNick(nick.value) || checking.value) {
    return;
  }
  const typed = nick.value;
  checking.value = true;
  const check = await accounts.checkNick(typed);
  checking.value = false;
  if (typed !== nick.value) {
    return;
  }
  if (check.kind === 'nick_taken') {
    taken.value = true;
    return;
  }
  if (accounts.addNick(typed) !== null) {
    finish();
  }
}

function open(url: string): void {
  void external.open(url);
}

let unsubscribe: () => void = () => undefined;

onMounted(() => {
  const offMc = accounts.onMcEvent((event) => {
    if (event.change === 'signed-in') {
      void finishSignedIn();
    }
  });
  const offMs = accounts.onMsEvent((event) => {
    if (event.change === 'signed-in') {
      finish();
    }
  });
  unsubscribe = (): void => {
    offMc();
    offMs();
  };
});

onBeforeUnmount(() => {
  unsubscribe();
});
</script>

<template>
  <div class="login">
    <div class="panel">
      <section :aria-labelledby="`${id}-mc`">
        <h1 :id="`${id}-mc`" class="h1">{{ ru.welcome.mcTitle }}</h1>
        <div v-if="mc !== null" class="lx-auth-slot" data-mc="signed-in">
          <p v-if="finishing" class="lx-auth-lead is-main" role="status" data-mc="finishing">
            {{ ru.welcome.exchanging }}
          </p>
          <p v-else class="lx-auth-lead is-main selectable">{{ accountTitle(mc) }}</p>
        </div>
        <LoginMc v-else lead :blocked="msWaiting" />
      </section>

      <section v-if="licenseShown" class="next" :aria-labelledby="`${id}-ms`" data-license>
        <h2 :id="`${id}-ms`" class="title">{{ ru.welcome.licenseTitle }}</h2>
        <LoginLicense
          :label="license === null ? ru.welcome.licenseAdd : null"
          :note="
            license === null
              ? ru.welcome.licenseNote
              : fill(ru.welcome.licenseConnected, { nick: license.nick })
          "
          :blocked="mcWaiting"
        />
      </section>

      <form
        class="next nick"
        :aria-labelledby="`${id}-nick`"
        novalidate
        @submit.prevent="submitNick"
      >
        <h2 :id="`${id}-nick`" class="title">{{ ru.welcome.guestTitle }}</h2>
        <p class="lx-auth-lead">{{ ru.welcome.guestNote }}</p>
        <div class="row">
          <label class="lx-auth-field" :class="{ 'is-invalid': nickError !== null }">
            <input
              v-model="nick"
              :aria-label="ru.welcome.nickLabel"
              :placeholder="ru.welcome.nickPlaceholder"
              :aria-invalid="nickError !== null"
              :aria-describedby="nickError !== null ? 'nick-error' : undefined"
              :disabled="waiting"
              maxlength="16"
              spellcheck="false"
              autocomplete="off"
              @input="editNick"
            />
          </label>
          <button
            type="submit"
            class="lx-auth-btn nick-submit"
            :disabled="waiting || checking || taken"
          >
            {{ ru.welcome.continue }}
          </button>
        </div>
        <p v-if="nickError !== null" id="nick-error" class="nick-error" role="alert">
          {{ nickError }}
        </p>
      </form>

      <p class="terms">
        <FillText :text="ru.welcome.terms">
          <template #terms>
            <a :href="siteLinks.terms" @click.prevent="open(siteLinks.terms)">{{
              ru.welcome.termsLink
            }}</a>
          </template>
          <template #privacy>
            <a :href="siteLinks.privacy" @click.prevent="open(siteLinks.privacy)">{{
              ru.welcome.privacyLink
            }}</a>
          </template>
        </FillText>
      </p>
    </div>

    <div class="scene" :class="{ 'is-empty': pick === undefined }">
      <PixelLandscape
        v-if="pick !== undefined"
        class="art"
        :scene="pick.scene"
        :base="scenes.base"
        :time="pick.time"
        cover
        :data-holiday="pick.holiday ? '' : undefined"
      />
    </div>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: clamp(496px, 36vw, 560px) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 56px 40px 32px;
  overflow-y: auto;
  scrollbar-width: thin;
  background: var(--mc-surface);
  border-right: 1px solid var(--mc-border);
  font-size: 14px;
  line-height: 20px;
}

.panel > * {
  flex: none;
}

.scene {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--mc-bg);
}

.scene.is-empty {
  background: linear-gradient(180deg, var(--mc-bg), var(--mc-surface-2) 72%, var(--mc-surface-3));
}

.scene:not(.is-empty)::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--mc-surface) 32%, transparent),
      transparent 48px
    ),
    color-mix(in srgb, var(--mc-surface) 24%, transparent);
  pointer-events: none;
}

.login .art {
  height: 100%;
  background-color: var(--mc-bg);
}

.h1 {
  margin: 0 0 8px;
  font-family: var(--mc-font-display);
  font-size: 24px;
  font-weight: 700;
  line-height: 32px;
  letter-spacing: -0.01em;
}

.title {
  margin: 0 0 4px;
  font-family: var(--mc-font-body);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  letter-spacing: 0;
}

.next {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--mc-border);
}

.row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.nick-submit {
  height: 44px;
}

.nick-error {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--mc-danger);
}

.terms {
  margin: auto 0 0;
  padding-top: 16px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.terms a {
  color: var(--mc-text-muted);
}

.terms a:hover {
  color: var(--mc-text);
}
</style>
