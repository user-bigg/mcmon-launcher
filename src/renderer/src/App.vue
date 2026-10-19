<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import DeepLinkPrompt from './components/DeepLinkPrompt.vue';
import ScreenBoundary from './components/ScreenBoundary.vue';
import SideNav from './components/SideNav.vue';
import TitleBar from './components/TitleBar.vue';
import { useAppNavigate } from './composables/useAppNavigate';
import { useDeepLink } from './composables/useDeepLink';
import { useSitePlay } from './composables/useSitePlay';

const route = useRoute();
const deepLink = useDeepLink();
const idle = computed(() => route.meta.idle === true);
const bare = computed(() => route.meta.bare === true);
const blocked = computed(() => (deepLink.pending.value === null ? undefined : true));
const main = useTemplateRef<HTMLElement>('main');

useAppNavigate();
useSitePlay();

watch(
  () => route.path,
  () => {
    main.value?.scrollTo({ top: 0 });
  },
);
</script>

<template>
  <template v-if="!idle">
    <TitleBar :bare="bare" :inert="blocked" />
    <div class="lx-body" :class="{ 'is-bare': bare }" :inert="blocked">
      <SideNav v-if="!bare" />
      <main ref="main" class="lx-main" tabindex="-1">
        <ScreenBoundary>
          <RouterView />
        </ScreenBoundary>
      </main>
    </div>
    <DeepLinkPrompt />
  </template>
</template>
