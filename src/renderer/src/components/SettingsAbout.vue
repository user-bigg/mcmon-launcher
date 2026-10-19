<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { RouterLink } from 'vue-router';
import { isHttpsUrl, urlHost } from '@shared/links';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import logoUrl from '../assets/logo.svg';
import { useLauncher } from '../composables/context';
import { useExternal } from '../composables/useExternal';
import { useMods } from '../composables/useMods';
import { useScenes } from '../composables/useScenes';
import { useSite } from '../composables/useSite';
import { useUpdates } from '../composables/useUpdates';
import { pixelScale } from '../lib/landscape';
import { modCredits } from '../lib/mods';
import { clientModCredit, skinModCredit, unbroken } from '../lib/skins';
import { moscowYear } from '../lib/time';
import { buildReport, updateStatusText } from '../lib/update-status';
import BiIcon from './BiIcon.vue';
import FillText from './FillText.vue';
import PixelLandscape from './PixelLandscape.vue';
import UiButton from './UiButton.vue';

interface AboutLink {
  key: string;
  label: string;
  href?: string;
  to?: string;
}

const BAND_ROWS = 42;
const COPIED_MS = 2000;

const updates = useUpdates();
const scenes = useScenes();
const external = useExternal();
const site = useSite();
const mods = useMods();
const catalogMods = computed(() => modCredits(mods.view.value));
const siteLinks = site.links;
const pick = computed(() => scenes.sceneFor('pulse'));
const build = computed(() => updates.state.value.current);
const { now } = useLauncher();
const footer = computed(() => {
  const year = moscowYear(build.value.builtAt, now());
  return fill(ru.settings.aboutFooter, { year: String(year) });
});
const status = computed(() => updateStatusText(updates.state.value));
const siteHost = computed(() => urlHost(siteLinks.value.launcher) ?? '');
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

function siteHome(url: string): string {
  return URL.parse(url)?.origin ?? url;
}

function externalLink(key: string, label: string, url: string | undefined): AboutLink[] {
  return url !== undefined && isHttpsUrl(url) ? [{ key, label, href: url }] : [];
}

const links = computed<AboutLink[]>(() => [
  ...externalLink('site', ru.settings.aboutSite, siteHome(siteLinks.value.launcher)),
  ...externalLink('source', ru.settings.aboutSource, siteLinks.value.source),
  { key: 'licenses', label: ru.settings.licensesLink, to: '/licenses' },
  ...externalLink('issues', ru.settings.aboutIssues, siteLinks.value.issues),
  ...externalLink('privacy', ru.settings.aboutPrivacy, siteLinks.value.privacy),
]);

const skinMod = computed(() => skinModCredit(site.skinMod.value));
const clientMod = computed(() => clientModCredit(site.skinMod.value));
const skinModLinks = computed<AboutLink[]>(() => [
  ...externalLink(
    'skin-mod-source',
    ru.settings.aboutSkinModSource,
    skinMod.value?.sourceUrl ?? undefined,
  ),
  ...externalLink(
    'skin-mod-license',
    ru.settings.aboutSkinModLicenseLink,
    skinMod.value?.licenseUrl ?? undefined,
  ),
]);
const clientModLinks = computed<AboutLink[]>(() => [
  ...externalLink(
    'client-mod-source',
    ru.settings.aboutClientModSource,
    clientMod.value?.sourceUrl ?? undefined,
  ),
  ...externalLink(
    'client-mod-license',
    ru.settings.aboutClientModLicenseLink,
    clientMod.value?.licenseUrl ?? undefined,
  ),
]);

function open(event: MouseEvent, url: string): void {
  event.preventDefault();
  void external.open(url);
}

async function copyVersion(): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildReport(build.value));
  } catch {
    return;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, COPIED_MS);
}

const card = useTemplateRef<HTMLElement>('card');
const cardWidth = ref(0);
const bandHeight = computed(() => `${String(BAND_ROWS * pixelScale(cardWidth.value))}px`);
let resizeObserver: ResizeObserver | undefined;

function measureCard(): void {
  cardWidth.value = card.value?.clientWidth ?? 0;
}

onMounted(() => {
  measureCard();
  if (card.value !== null && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measureCard);
    resizeObserver.observe(card.value);
  }
});

onBeforeUnmount(() => {
  clearTimeout(copiedTimer);
  resizeObserver?.disconnect();
});
</script>

<template>
  <div class="about">
    <div ref="card" class="card">
      <PixelLandscape
        v-if="pick !== undefined"
        class="band"
        :scene="pick.scene"
        :base="scenes.base"
        :time="pick.time"
        :height="BAND_ROWS"
        :parallax="false"
      />
      <div
        v-else
        class="band is-empty"
        aria-hidden="true"
        data-about="band-empty"
        :style="{ height: bandHeight }"
      ></div>

      <div class="body">
        <div class="head">
          <img class="logo" :src="logoUrl" alt="" />
          <div class="name-block">
            <div class="name">{{ ru.settings.product }}</div>
            <p class="pitch">{{ ru.settings.pitch }}</p>
          </div>
          <UiButton
            size="sm"
            icon="arrow-clockwise"
            :disabled="!updates.canCheck.value"
            @click="updates.check()"
          >
            {{ ru.settings.aboutCheck }}
          </UiButton>
        </div>

        <div class="meta">
          <button
            v-if="build.version !== ''"
            type="button"
            class="version lx-num"
            :class="{ 'is-copied': copied }"
            :title="ru.settings.versionCopy"
            data-about="version"
            @click="copyVersion()"
          >
            <span>{{
              copied
                ? ru.settings.versionCopied
                : fill(ru.settings.versionLine, { version: build.version })
            }}</span>
            <BiIcon :name="copied ? 'check-lg' : 'copy'" />
          </button>
          <span class="lx-visually-hidden" role="status">{{
            copied ? ru.settings.versionCopied : ''
          }}</span>
          <span class="status lx-num">
            <FillText :text="status">
              <template #site>
                <span class="lx-mono domain selectable">{{ siteHost }}</span>
              </template>
            </FillText>
          </span>
        </div>

        <nav class="links" :aria-label="ru.settings.aboutLinks">
          <ul>
            <li v-for="link in links" :key="link.key" :data-about-link="link.key">
              <RouterLink v-if="link.to !== undefined" :to="link.to">{{ link.label }}</RouterLink>
              <a
                v-else-if="link.href !== undefined"
                :href="link.href"
                rel="noopener noreferrer"
                @click="open($event, link.href)"
                >{{ link.label }}</a
              >
            </li>
          </ul>
        </nav>

        <div
          v-if="skinMod !== null || clientMod !== null"
          class="links skin-mod"
          data-about="skin-mod"
        >
          <template v-if="skinMod !== null">
            <p>
              {{ fill(ru.settings.aboutSkinMod, { version: skinMod.version }) }}
              <template v-if="skinMod.license !== null">
                {{ fill(ru.settings.aboutSkinModLicense, { license: unbroken(skinMod.license) }) }}
              </template>
            </p>
            <ul>
              <li v-for="link in skinModLinks" :key="link.key" :data-about-link="link.key">
                <a
                  v-if="link.href !== undefined"
                  :href="link.href"
                  rel="noopener noreferrer"
                  @click="open($event, link.href)"
                  >{{ link.label }}</a
                >
              </li>
            </ul>
          </template>
          <p v-if="clientMod !== null" class="client-mod" data-about-client-mod>
            {{ fill(ru.settings.aboutClientMod, { version: clientMod.version }) }}
            <template v-if="clientMod.license !== null">
              {{ fill(ru.settings.aboutSkinModLicense, { license: unbroken(clientMod.license) }) }}
            </template>
          </p>
          <ul v-if="clientMod !== null && clientModLinks.length > 0">
            <li v-for="link in clientModLinks" :key="link.key" :data-about-link="link.key">
              <a
                v-if="link.href !== undefined"
                :href="link.href"
                rel="noopener noreferrer"
                @click="open($event, link.href)"
                >{{ link.label }}</a
              >
            </li>
          </ul>
        </div>
        <div v-if="catalogMods.length > 0" class="links skin-mod" data-about="mods">
          <p>{{ ru.mods.aboutMods }}</p>
          <ul class="mod-credits">
            <li v-for="mod in catalogMods" :key="mod.slug" :data-about-mod="mod.slug">
              <a :href="mod.url" rel="noopener noreferrer" @click="open($event, mod.url)">{{
                fill(ru.mods.aboutMod, { title: mod.name, license: unbroken(mod.license) })
              }}</a>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <p class="footer">
      <span>{{ footer }}</span>
      <span class="motto">{{ ru.settings.aboutMotto }}</span>
    </p>
  </div>
</template>

<style scoped>
.card {
  overflow: hidden;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.band {
  display: block;
  border-bottom: 1px solid var(--mc-border);
}

.band.is-empty {
  background: var(--mc-surface);
}

.body {
  padding: 16px;
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.logo {
  flex: none;
  width: 40px;
  height: 40px;
  image-rendering: pixelated;
}

.name-block {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 16px;
  font-weight: 600;
}

.pitch {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-top: 14px;
  padding-left: 54px;
  font-size: 12px;
}

.version {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--mc-border);
  border-radius: 999px;
  background: var(--mc-surface-2);
  color: var(--mc-text);
  font-size: 12px;
}

.version:hover {
  background: var(--mc-surface-3);
}

.version.is-copied {
  color: var(--mc-accent);
}

.version:focus-visible {
  outline: 2px solid var(--mc-accent);
  outline-offset: 2px;
}

.status {
  color: var(--mc-text-muted);
}

.domain {
  white-space: nowrap;
}

.links {
  margin-top: 14px;
  padding-top: 12px;
  padding-left: 54px;
  border-top: 1px solid var(--mc-border);
  font-size: 13px;
}

.skin-mod p {
  margin: 0 0 4px;
  color: var(--mc-text-muted);
}

.skin-mod ul + .client-mod {
  margin-top: 8px;
}

.skin-mod a {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.links ul {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.links li {
  white-space: nowrap;
}

.links ul.mod-credits {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
}

.links .mod-credits li + li::before {
  content: none;
}

.links .mod-credits li {
  white-space: normal;
}

.links li + li::before {
  content: '\00b7';
  margin: 0 8px;
  color: var(--mc-text-dim);
}

.links a {
  color: var(--mc-text-muted);
  text-decoration: none;
}

.links a:hover {
  color: var(--mc-text);
  text-decoration: underline;
}

.links a:focus-visible {
  outline: 2px solid var(--mc-accent);
  outline-offset: 2px;
  border-radius: var(--mc-radius-sm);
}

.footer {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.motto::before {
  content: '\00b7';
  margin: 0 6px;
}
</style>
