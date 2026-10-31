<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import type { ServerRow } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { catalogServerRuntime } from '@shared/instance';
import { instanceIdOf, LAST_VERSION_WITHOUT_CORE_PROFILE } from '@shared/launch';
import type { SiteError } from '@shared/site';
import { decideClientMod, type SkinsAuth, type SkinsStatus } from '@shared/skin-mod';
import BiIcon from '../components/BiIcon.vue';
import type { IconName } from '../components/icons';
import LaunchAction from '../components/LaunchAction.vue';
import PixelLandscape from '../components/PixelLandscape.vue';
import ProgressBar from '../components/ProgressBar.vue';
import ServerIcon from '../components/ServerIcon.vue';
import SiteErrorState from '../components/SiteErrorState.vue';
import SkelBar from '../components/SkelBar.vue';
import UiButton from '../components/UiButton.vue';
import ModStepProblem from '../components/ModStepProblem.vue';
import TagChip from '../components/TagChip.vue';
import UiToggle from '../components/UiToggle.vue';
import { useCatalog } from '../composables/useCatalog';
import { useLaunch } from '../composables/useLaunch';
import { useLibrary } from '../composables/useLibrary';
import { useServerMods } from '../composables/useMods';
import { useScenes } from '../composables/useScenes';
import { useServerMemory } from '../composables/useServerMemory';
import { usePlay, type PlayOptions } from '../composables/usePlay';
import { useSettings } from '../composables/useSettings';
import { useSite } from '../composables/useSite';
import { useVisibleInterval } from '../composables/useVisibleInterval';
import { useWithoutMods } from '../composables/useWithoutMods';
import { banExpired, banView } from '../lib/ban';
import { BUILTIN_SCENE } from '../lib/builtin-scene';
import { pixelScale } from '../lib/landscape';
import { errorView, idleSteps, statusIcons, stepView, type ErrorAction } from '../lib/launch-view';
import { shownAddress } from '../lib/minecraft';
import {
  blocksLaunch,
  inOrder,
  modLines,
  modStepGroups,
  type StepItem,
  type StepLine,
} from '../lib/mod-steps';
import { serverModRows, sideModState } from '../lib/mods';
import { pendingUpdate, updateText } from '../lib/server-fact';
import {
  clientModGoes,
  fabricFileHosts,
  fabricPurpose,
  serverModpack,
  serverSkinsFlag,
  skinsPreview,
} from '../lib/skins';
import { licenseOnly } from '../lib/tags';
import { duration } from '../lib/time';
import { formatBytes, formatMemoryMb, formatSpeed } from '../lib/units';

const MOJANG_HOST = 'mojang.com';
const LOG_LINES = 200;
const WAITING_ROWS = 56;
const SKELETON_STEPS = 6;

const { serverId } = defineProps<{ serverId: number }>();

const router = useRouter();
const catalog = useCatalog();
const library = useLibrary();
const launch = useLaunch();
const settings = useSettings();
const site = useSite();
const { playServer } = usePlay();
const scenes = useScenes();
const BUILTIN_WAITING = { scene: BUILTIN_SCENE, time: 'day' as const, holiday: false };
const waitingPick = computed(() => scenes.sceneFor('waiting'));
// The layers of the scene come from the site on its first show: until they do, the built-in
// landscape stands in, so the frame above the title is never an empty box.
const waiting = computed(() => {
  const pick = waitingPick.value;
  return pick !== undefined && scenes.ready(pick) ? pick : BUILTIN_WAITING;
});
watch(
  waitingPick,
  (pick) => {
    scenes.prefetch(pick);
  },
  { immediate: true },
);

// The place of the landscape is held from the first frame, whether its picture has arrived or
// not: otherwise the title jumps down when it does.
const waitingSlot = useTemplateRef<HTMLElement>('waitingSlot');
const waitingWidth = ref(0);
const waitingHeight = computed(() => WAITING_ROWS * pixelScale(waitingWidth.value));
let slotObserver: ResizeObserver | null = null;

watch(waitingSlot, (slot) => {
  slotObserver?.disconnect();
  if (slot === null || typeof ResizeObserver === 'undefined') {
    return;
  }
  slotObserver = new ResizeObserver(() => {
    waitingWidth.value = slot.clientWidth;
  });
  slotObserver.observe(slot);
});

onMounted(() => {
  waitingWidth.value = waitingSlot.value?.clientWidth ?? 0;
});

onBeforeUnmount(() => {
  slotObserver?.disconnect();
});

const log = ref<string[] | null>(null);
const logPanel = useTemplateRef<HTMLElement>('logPanel');

type CardStatus = 'idle' | 'loading' | 'missing' | 'error';

const cardStatus = ref<CardStatus>('idle');
const cardError = ref<SiteError | null>(null);

async function loadServer(id: number): Promise<void> {
  cardStatus.value = 'loading';
  const loaded = await catalog.loadCard(id);
  if (loaded.status === 'error') {
    cardError.value = loaded.error;
    cardStatus.value = 'error';
    return;
  }
  cardError.value = null;
  cardStatus.value = loaded.status === 'missing' ? 'missing' : 'idle';
}

watch(
  () => serverId,
  (id) => {
    if (catalog.server(id) === undefined) {
      void loadServer(id);
    }
  },
  { immediate: true },
);

type Subject =
  | { kind: 'server'; server: ServerRow }
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'missing' };

const subject = computed<Subject>(() => {
  const server = catalog.server(serverId);
  if (server !== undefined) {
    return { kind: 'server', server };
  }
  if (cardStatus.value === 'error') {
    return { kind: 'offline' };
  }
  return cardStatus.value === 'missing' ? { kind: 'missing' } : { kind: 'loading' };
});

const view = computed(() => {
  const current = subject.value;
  if (current.kind === 'server') {
    const { server } = current;
    const minecraft = server.launch.kind === 'direct' ? server.launch.minecraft : '';
    return {
      name: server.name,
      icon: server.icon_url,
      minecraft,
      host: shownAddress(server),
      back: `/server/${String(server.id)}`,
      backLabel: server.name,
      instanceId: instanceIdOf({
        kind: 'server',
        serverId: server.id,
        minecraft,
        address: server.address.host,
      }),
    };
  }
  return null;
});

const mine = computed(
  () => view.value !== null && launch.job.value?.instanceId === view.value.instanceId,
);
const busyOther = computed(() => launch.busy.value && !mine.value);
const progress = computed(() => (mine.value ? launch.progress.value : null));
// A ban whose term has passed is no longer a ban: 'Play' comes back and the site is asked anew.
const error = computed(() => {
  const current = mine.value ? launch.error.value : null;
  return current?.code === 'banned' && banExpired(current) ? null : current;
});
const ban = computed(() =>
  error.value?.code === 'banned' && view.value !== null
    ? banView(error.value, view.value.name)
    : null,
);

// A ban the player has seen does not stay: once they leave this server's launch screen, the
// next visit shows 'Play' and the site is asked anew. A ban of another server is not touched.
function forgetBan(instanceId: string | undefined): void {
  const shown = instanceId !== undefined && launch.job.value?.instanceId === instanceId;
  if (shown && launch.error.value?.code === 'banned') {
    launch.dismiss();
  }
}

watch(
  () => view.value?.instanceId,
  (_next, previous) => {
    forgetBan(previous);
  },
);

onBeforeUnmount(() => {
  forgetBan(view.value?.instanceId);
});
const errorAny = computed(() =>
  error.value === null || ban.value !== null ? null : errorView(error.value),
);
const errorText = computed(() => (modsRefused.value ? null : errorAny.value));
const crashed = computed(
  () => view.value !== null && launch.crashed.value === view.value.instanceId,
);
const phase = computed(() => (mine.value ? launch.phase.value : 'idle'));
const percent = computed(() => progress.value?.percent ?? 0);

const gameStarted = computed(() => phase.value === 'running');
const windowOpen = computed(() => gameStarted.value && launch.windowReady.value);
const startingGame = computed(() => gameStarted.value && !launch.windowReady.value);
const gameDialog = computed(() => startingGame.value && launch.windowDialog.value);
const slowStart = computed(
  () => startingGame.value && launch.windowSlow.value && !gameDialog.value,
);

const concealOnStart = computed({
  get: () => settings.state.whileGame !== 'keep',
  set: (value: boolean) => {
    settings.state.whileGame = value ? 'tray' : 'keep';
  },
});

const hostParts = computed(() =>
  (view.value?.host ?? '').split(/(?<=[.:])/).filter((part) => part !== ''),
);
const launcherOnly = computed(() => view.value !== null && view.value.host === null);
const serverMemory = useServerMemory();
const memory = computed(() => {
  const session = mine.value ? launch.session.value : null;
  if (session !== null) {
    return formatMemoryMb(session.memoryMb);
  }
  const chosen = subject.value.kind === 'server' ? serverMemory.mb.value : settings.memoryMb.value;
  return chosen === undefined ? ru.install.memoryAuto : formatMemoryMb(chosen);
});

const loader = computed(() => catalogServerRuntime(view.value?.minecraft ?? '').loader);

const mods = useWithoutMods(() => view.value?.instanceId ?? null);

const skinsAuth = computed<SkinsAuth>(() => {
  const current = subject.value;
  return current.kind === 'server' && licenseOnly(current.server.access) ? 'license' : 'nick';
});

const skinsPlanned = computed<SkinsStatus | null>(() => {
  const current = subject.value;
  if (view.value === null || view.value.minecraft === '') {
    return null;
  }
  return skinsPreview({
    auth: skinsAuth.value,
    serverSkins: current.kind === 'server' ? serverSkinsFlag(current.server) : undefined,
    modpack: current.kind === 'server' && serverModpack(current.server),
    withoutMods: mods.off.value,
    loader: loader.value,
    minecraft: view.value.minecraft,
    table: site.skinMod.value,
  });
});

const skins = computed<SkinsStatus | null>(() =>
  mine.value && phase.value !== 'idle' && launch.skins.value !== null
    ? launch.skins.value
    : skinsPlanned.value,
);

const clientMod = computed(() => {
  if (view.value === null || view.value.minecraft === '') {
    return false;
  }
  const current = subject.value;
  const question = {
    auth: skinsAuth.value,
    modpack: current.kind === 'server' && serverModpack(current.server),
    loader: loader.value,
    minecraft: view.value.minecraft,
    table: site.skinMod.value,
  };
  return clientModGoes(
    decideClientMod(question),
    view.value.minecraft,
    launch.blockedClientMods.value,
  );
});

const fabric = computed(() => fabricPurpose(skins.value, clientMod.value));

const canSwitchMods = computed(() => skinsPlanned.value === 'on' || skinsPlanned.value === 'user');

// The loader step reads the choice once: from then on this launch goes with what it read.
const modsLocked = computed(
  () => gameStarted.value || (phase.value === 'preparing' && launch.skins.value !== null),
);

// The address goes into the command line when the launch step begins.
const joinLocked = computed(() => {
  const step = progress.value?.steps.find((item) => item.id === 'launch');
  return gameStarted.value || (phase.value === 'preparing' && step?.status === 'active');
});

let joinPutBack: boolean | null = null;

async function passJoinChoice(join: boolean): Promise<void> {
  if (join === joinPutBack) {
    joinPutBack = null;
    return;
  }
  if (phase.value !== 'preparing' || (await launch.setJoinServer(join))) {
    return;
  }
  joinPutBack = !join;
  settings.state.joinServer = !join;
}

watch(
  () => settings.state.joinServer,
  (join) => {
    void passJoinChoice(join);
  },
);

const skinHosts = computed(() =>
  view.value === null
    ? []
    : fabricFileHosts(site.skinMod.value, view.value.minecraft, fabric.value),
);

const update = computed(() => {
  const current = subject.value;
  if (current.kind !== 'server') {
    return null;
  }
  const pending = pendingUpdate(current.server, library.installed(current.server.id));
  return pending === null ? null : updateText(pending);
});

const STEP_CLOCK_MS = 1000;
const nowMs = ref(Date.now());
// The clock of the step stops while the game waits in its own error dialog.
useVisibleInterval(() => {
  if (phase.value !== 'idle' && !gameDialog.value) {
    nowMs.value = Date.now();
  }
}, STEP_CLOCK_MS);

const serverMods = useServerMods(() => {
  const current = subject.value;
  return current.kind === 'server' && current.server.launch.kind === 'direct'
    ? { serverId: current.server.id, minecraft: current.server.launch.minecraft }
    : null;
});
const serverModList = computed(() =>
  serverMods.view.value?.installs === true ? serverModRows(serverMods.view.value) : [],
);
const modGroups = computed(() => modStepGroups(progress.value?.mods));
const modsPlanned = computed(
  () =>
    modGroups.value.length > 0 ||
    (serverMods.view.value?.installs === true &&
      serverMods.view.value.mods.some((mod) => mod.state === 'on')),
);
const modsFromCatalog = computed(
  () => modGroups.value.length > 0 || serverModList.value.length > 0,
);
const modsRefused = computed(
  () => error.value?.code === 'mods-required-failed' && blocksLaunch(modGroups.value),
);
const modsWaiting = computed(() => (mine.value ? launch.modsWaiting.value : null));

const steps = computed(() => {
  const current = view.value;
  if (current === null) {
    return [];
  }
  const context = {
    minecraft: current.minecraft,
    host: current.host,
    memory: memory.value,
    update: update.value,
    skins: skins.value,
    fabric: fabric.value,
    mods: modsPlanned.value,
    nowMs: nowMs.value,
  };
  const idleLoader = fabric.value === null && !modsPlanned.value ? loader.value : 'fabric';
  return (progress.value?.steps ?? idleSteps(idleLoader)).map((step) => stepView(step, context));
});

const currentStep = computed(() => steps.value.find((step) => step.status === 'active'));

// A required mod that did not come stops the launch in its own step: the loader was not reached
// and must not read as failed.
function baseLine(step: (typeof steps.value)[number]): StepLine {
  const status = modsRefused.value && step.status === 'failed' ? 'wait' : step.status;
  return {
    kind: 'step',
    key: step.id,
    status,
    icon: statusIcons[status] ?? step.icon,
    title: step.title,
    note: step.note,
    statusText: ru.install.stepStatus[status],
    right: step.right ?? (progress.value === null ? '' : ru.install.stepStatus[status]),
    bar: step.bar,
    beta: false,
    problem: null,
    mod: false,
    groupLabel: null,
  };
}

const stepItems = computed<StepItem[]>(() =>
  inOrder(
    steps.value.flatMap((step) =>
      step.id === 'loader' ? [...modLines(modGroups.value), baseLine(step)] : [baseLine(step)],
    ),
  ),
);

const firstOptionalProblem = computed(
  () =>
    stepItems.value.find(
      (item): item is StepLine => item.kind === 'step' && item.problem === 'optional',
    )?.key ?? null,
);

const cancelled = computed(() => error.value?.code === 'cancelled');

interface Eyebrow {
  text: string;
  icon: IconName;
  tone: 'violet' | 'danger' | 'muted';
}

const eyebrow = computed<Eyebrow>(() => {
  if (modsWaiting.value !== null) {
    return { text: ru.mods.eyebrowWaiting, icon: 'pause-circle', tone: 'muted' };
  }
  if (cancelled.value || modsRefused.value) {
    return { text: ru.install.eyebrowCancelled, icon: 'pause-circle', tone: 'muted' };
  }
  if (ban.value !== null) {
    return { text: ru.ban.eyebrow, icon: 'door-closed', tone: 'muted' };
  }
  if (errorText.value !== null) {
    return { text: errorText.value.eyebrow, icon: 'exclamation-triangle', tone: 'danger' };
  }
  if (phase.value === 'preparing') {
    return { text: ru.install.eyebrowPreparing, icon: 'download', tone: 'violet' };
  }
  if (startingGame.value) {
    return { text: ru.install.eyebrowStarting, icon: 'hourglass-split', tone: 'violet' };
  }
  return {
    text: windowOpen.value ? ru.install.eyebrowRunning : ru.install.eyebrowIdle,
    icon: 'play-circle',
    tone: 'violet',
  };
});

const title = computed(() => {
  const name = view.value?.name ?? '';
  if (phase.value === 'preparing') {
    return fill(ru.install.titleIdle, { name });
  }
  if (gameDialog.value) {
    return fill(ru.install.titleDialog, { name });
  }
  if (startingGame.value) {
    return fill(ru.install.titleStarting, { name });
  }
  return fill(windowOpen.value ? ru.install.titleRunning : ru.install.titleIdle, { name });
});

const liveStatus = computed(() =>
  currentStep.value === undefined
    ? ru.install.statusIdle
    : fill(ru.install.status, {
        step: currentStep.value.title,
        percent: Math.floor(percent.value / 10) * 10,
      }),
);

const bytes = computed(() => {
  const value = progress.value;
  if (value === null || value.bytesTotal <= 0) {
    return null;
  }
  return fill(ru.install.bytes, {
    done: formatBytes(value.bytesDone),
    total: formatBytes(value.bytesTotal),
  });
});

const speed = computed(() => {
  const value = progress.value;
  if (value === null || value.bytesPerSecond <= 0) {
    return null;
  }
  const remaining =
    value.remainingSeconds === null
      ? null
      : fill(ru.install.remaining, { time: duration(value.remainingSeconds) });
  return { rate: formatSpeed(value.bytesPerSecond), remaining };
});

const canCancel = computed(
  () =>
    phase.value === 'preparing' || (startingGame.value && !slowStart.value && !gameDialog.value),
);
const canKill = computed(() => windowOpen.value);

function start(options: PlayOptions = {}): void {
  const current = subject.value;
  if (current.kind === 'server') {
    void playServer(current.server, options);
  }
}

async function toggleLog(): Promise<void> {
  log.value = log.value === null ? await launch.logTail(LOG_LINES) : null;
  if (log.value !== null) {
    await nextTick();
    logPanel.value?.scrollIntoView({ block: 'nearest' });
  }
}

// After an old video card the catalog opens on the servers this computer can run.
function serversRoute(): string {
  return error.value?.code === 'gpu-unsupported'
    ? `/servers?version=${LAST_VERSION_WITHOUT_CORE_PROFILE}`
    : '/servers';
}

const errorHandlers: Record<ErrorAction, () => void> = {
  retry: () => {
    start();
  },
  'retry-without-join': () => {
    start({ joinServer: false });
  },
  settings: () => void router.push('/settings'),
  accounts: () => void router.push('/accounts'),
  servers: () => void router.push(serversTarget),
  back: () => void router.push(view.value?.back ?? '/'),
  log: () => void toggleLog(),
  dismiss: () => {
    launch.dismiss();
  },
};

let serversTarget = '/servers';

function onErrorAction(kind: ErrorAction): void {
  serversTarget = serversRoute();
  launch.dismiss();
  errorHandlers[kind]();
}
</script>

<template>
  <div
    v-if="subject.kind === 'loading'"
    class="launch"
    data-loading
    role="status"
    :aria-label="ru.state.loading"
  >
    <div class="stage">
      <div class="toolbar">
        <SkelBar :w="140" :h="30" />
        <SkelBar :w="96" :h="30" />
      </div>
      <div class="content">
        <div class="title-row">
          <SkelBar :w="48" :h="48" />
          <div class="title skel-lines">
            <SkelBar :w="140" :h="12" />
            <SkelBar :w="280" :h="26" />
          </div>
        </div>
        <ol class="steps" aria-hidden="true">
          <li v-for="index in SKELETON_STEPS" :key="index" class="step">
            <SkelBar :w="26" :h="26" round />
            <div class="skel-lines">
              <SkelBar :w="180" :h="14" />
              <SkelBar :w="260" :h="12" />
            </div>
          </li>
        </ol>
      </div>
    </div>
    <aside class="side">
      <SkelBar :w="160" :h="16" />
      <SkelBar class="spaced" w="100%" :h="160" />
    </aside>
  </div>
  <div v-else-if="subject.kind === 'offline'" class="launch">
    <div class="stage">
      <div class="toolbar">
        <RouterLink class="lx-glass" :to="`/server/${String(serverId)}`">
          <BiIcon name="arrow-left" />{{ ru.serverPage.back }}
        </RouterLink>
      </div>
      <div class="content">
        <SiteErrorState :error="cardError" @retry="loadServer(serverId)" />
      </div>
    </div>
  </div>
  <div v-else-if="view === null" class="lx-content">
    <h1 class="lx-h1">{{ ru.install.notFound }}</h1>
    <p class="lx-sub">{{ ru.serverPage.notFoundText }}</p>
    <UiButton class="spaced" size="sm" icon="arrow-left" to="/servers">
      {{ ru.install.toServers }}
    </UiButton>
  </div>
  <div v-else class="launch">
    <div class="stage">
      <div class="toolbar">
        <RouterLink class="lx-glass" :to="view.back">
          <BiIcon name="arrow-left" />{{ view.backLabel }}
        </RouterLink>
        <button type="button" class="lx-glass" :aria-pressed="log !== null" @click="toggleLog">
          <BiIcon name="terminal" />{{ ru.install.log }}
        </button>
      </div>

      <div class="content">
        <div ref="waitingSlot" class="waiting" :style="{ height: `${String(waitingHeight)}px` }">
          <PixelLandscape
            v-if="waiting !== undefined"
            :scene="waiting.scene"
            :base="scenes.base"
            :time="waiting.time"
            height="100%"
          />
        </div>
        <div class="title-row">
          <ServerIcon :src="view.icon" size="md" />
          <div class="title">
            <div class="lx-eyebrow" :class="`is-${eyebrow.tone}`" :data-eyebrow="eyebrow.tone">
              <BiIcon :name="eyebrow.icon" />{{ eyebrow.text }}
            </div>
            <h1 class="lx-h1">{{ title }}</h1>
          </div>
          <div v-if="phase === 'preparing'" class="percent" aria-hidden="true">
            {{ percent }}<span>{{ ru.units.percentSign }}</span>
          </div>
        </div>

        <div class="lx-visually-hidden" aria-live="polite" role="status">{{ liveStatus }}</div>

        <template v-if="subject.kind === 'server' && subject.server.launch.kind === 'own_launcher'">
          <section class="notice">
            <h2>{{ ru.install.ownTitle }}</h2>
            <p>{{ ru.install.ownText }}</p>
            <LaunchAction :server="subject.server" size="md" />
          </section>
        </template>
        <template v-else-if="subject.kind === 'server' && subject.server.launch.kind === 'none'">
          <section class="notice">
            <h2>{{ ru.install.noneTitle }}</h2>
            <p>{{ ru.install.noneText }}</p>
            <LaunchAction :server="subject.server" size="md" />
          </section>
        </template>
        <template v-else>
          <section v-if="busyOther" class="notice" role="status">
            <p>{{ fill(ru.install.busyOther, { name: launch.job.value?.name ?? '' }) }}</p>
          </section>

          <section
            v-if="errorText !== null"
            class="notice"
            :class="cancelled ? 'is-cancelled' : 'is-error'"
            :role="cancelled ? 'status' : 'alert'"
          >
            <h2>
              <BiIcon :name="cancelled ? 'pause-circle' : 'exclamation-triangle'" />{{
                errorText.title
              }}
            </h2>
            <p class="selectable">{{ errorText.text }}</p>
            <UiButton size="sm" variant="primary" @click="onErrorAction(errorText.kind)">
              {{ errorText.action }}
            </UiButton>
          </section>

          <section v-if="ban !== null" class="notice" role="alert" data-ban>
            <h2>{{ ban.title }}</h2>
            <p v-if="ban.term !== null" class="ban-term selectable">{{ ban.term }}</p>
            <p>{{ ban.note }}</p>
            <UiButton size="sm" @click="onErrorAction('servers')">{{ ban.action }}</UiButton>
          </section>

          <section v-if="crashed" class="notice is-error" role="alert">
            <h2><BiIcon name="exclamation-triangle" />{{ ru.install.crashedTitle }}</h2>
            <p>{{ ru.install.crashedText }}</p>
            <UiButton size="sm" variant="primary" :to="`/crash/${view.instanceId}`">
              {{ ru.install.crashedAction }}
            </UiButton>
          </section>

          <section v-if="gameDialog" class="notice is-error" role="alert" data-game-dialog>
            <h2><BiIcon name="exclamation-triangle" />{{ ru.install.dialogTitle }}</h2>
            <p>{{ ru.install.dialogText }}</p>
            <div class="notice-actions">
              <UiButton size="sm" @click="launch.cancel()">
                {{ ru.install.slowStop }}
              </UiButton>
            </div>
          </section>

          <section v-if="slowStart" class="notice" role="status" data-slow-start>
            <h2><BiIcon name="hourglass-split" />{{ ru.install.slowTitle }}</h2>
            <p>{{ ru.install.slowText }}</p>
            <div class="notice-actions">
              <UiButton size="sm" variant="primary" @click="launch.keepWaiting()">
                {{ ru.install.slowWait }}
              </UiButton>
              <UiButton size="sm" @click="launch.cancel()">
                {{ ru.install.slowStop }}
              </UiButton>
            </div>
          </section>

          <ProgressBar
            v-if="phase === 'preparing'"
            class="overall"
            :value="percent"
            :label="fill(ru.install.progress, { name: view.name, percent })"
          />
          <div v-if="errorAny === null && (bytes !== null || speed !== null)" class="numbers">
            <span>{{ bytes }}</span>
            <span v-if="speed !== null">
              <strong>{{ speed.rate }}</strong>
              <template v-if="speed.remaining !== null">&nbsp;· {{ speed.remaining }}</template>
            </span>
          </div>

          <ol v-if="ban === null" class="steps" :aria-label="ru.install.steps">
            <template v-for="step in stepItems" :key="step.key">
              <li v-if="step.kind === 'group'" class="step-group" aria-hidden="true" data-mod-group>
                {{ step.label }}
              </li>
              <li v-else class="step" :class="`is-${step.status}`" :data-step="step.key">
                <span class="step-dot" aria-hidden="true">
                  <BiIcon :name="step.icon" />
                </span>
                <div class="step-body">
                  <div class="step-title">
                    <span v-if="step.groupLabel !== null" class="lx-visually-hidden"
                      >{{ step.groupLabel }}.
                    </span>
                    {{ step.title }}
                    <span class="lx-visually-hidden">{{ step.statusText }}</span>
                  </div>
                  <div v-if="step.note !== '' || step.beta" class="step-note">
                    {{ step.note }}
                    <TagChip v-if="step.beta" small class="beta">{{ ru.mods.beta }}</TagChip>
                  </div>
                  <ProgressBar
                    v-if="step.bar !== null"
                    class="step-bar"
                    thin
                    :value="step.bar"
                    :label="step.title"
                  />
                  <ModStepProblem
                    v-if="step.problem !== null"
                    :kind="step.problem"
                    :refused="modsRefused && step.problem === 'required'"
                    :waiting="
                      step.problem === 'optional' &&
                      step.key === firstOptionalProblem &&
                      modsWaiting !== null
                        ? modsWaiting.length
                        : 0
                    "
                    @retry="onErrorAction('retry')"
                    @cancel="launch.dismiss()"
                    @answer="launch.answerMods($event)"
                  />
                </div>
                <span class="step-right">{{ step.right }}</span>
              </li>
            </template>
          </ol>

          <div class="actions">
            <UiButton v-if="canCancel" size="sm" icon="stop-circle" @click="launch.cancel()">
              {{ ru.install.cancel }}
            </UiButton>
            <UiButton v-else-if="canKill" size="sm" icon="x-lg" @click="launch.kill()">
              {{ ru.install.kill }}
            </UiButton>
            <UiButton
              v-else-if="
                !slowStart && !gameDialog && !busyOther && errorAny === null && ban === null
              "
              size="sm"
              variant="play"
              icon="play-fill"
              @click="start()"
            >
              {{ ru.install.start }}
            </UiButton>
          </div>
        </template>

        <section
          v-if="log !== null"
          ref="logPanel"
          class="log-panel"
          :aria-label="ru.install.logTitle"
        >
          <div class="log-head">
            <h2>{{ ru.install.logTitle }}</h2>
            <UiButton size="sm" @click="log = null">{{ ru.install.logClose }}</UiButton>
          </div>
          <pre v-if="log.length > 0" class="log selectable" tabindex="0">{{ log.join('\n') }}</pre>
          <p v-else class="lx-muted">{{ ru.install.logEmpty }}</p>
        </section>
      </div>
    </div>

    <aside class="side">
      <h2>{{ ru.install.after }}</h2>
      <div class="lx-rows">
        <div class="lx-row compact" data-auto-join>
          <div class="lx-row-text">
            <div class="lx-row-title">{{ ru.install.autoJoin }}</div>
            <div v-if="joinLocked" class="lx-row-desc one-line" data-locked-note>
              {{ ru.install.lockedNote }}
            </div>
            <div v-else class="lx-row-desc one-line">{{ ru.install.autoJoinNote }}</div>
          </div>
          <UiToggle
            v-model="settings.state.joinServer"
            :label="ru.install.autoJoin"
            :disabled="joinLocked"
          />
        </div>
        <div v-if="canSwitchMods" class="lx-row compact" data-without-mods>
          <div class="lx-row-text">
            <div class="lx-row-title">{{ ru.install.withoutMods }}</div>
            <div v-if="modsLocked" class="lx-row-desc one-line" data-locked-note>
              {{ ru.install.lockedNote }}
            </div>
            <div v-else class="lx-row-desc one-line">{{ ru.install.withoutModsNote }}</div>
          </div>
          <UiToggle
            :model-value="mods.off.value"
            :label="ru.install.withoutMods"
            :disabled="modsLocked"
            @update:model-value="mods.set"
          />
        </div>
        <div v-else-if="skinsPlanned === 'server'" class="lx-row compact" data-no-mods>
          <div class="lx-row-text">
            <div class="lx-row-title">{{ ru.install.noMods }}</div>
            <div class="lx-row-desc">{{ ru.install.noModsNote }}</div>
          </div>
        </div>
        <div class="lx-row compact" data-conceal>
          <div class="lx-row-text">
            <div class="lx-row-title">{{ ru.install.minimize }}</div>
            <div class="lx-row-desc one-line">
              {{ windowOpen ? ru.install.nextLaunchNote : ru.install.minimizeNote }}
            </div>
          </div>
          <UiToggle v-model="concealOnStart" :label="ru.install.minimize" />
        </div>
        <div class="lx-row compact" data-memory>
          <div class="lx-row-text">
            <div class="lx-row-title">{{ ru.install.memory }}</div>
            <RouterLink class="lx-row-desc settings-link" to="/settings">
              {{ ru.install.memoryNote }}
            </RouterLink>
          </div>
          <span class="lx-num">{{ memory }}</span>
        </div>
      </div>

      <template v-if="serverModList.length > 0">
        <h2 class="spaced">{{ ru.mods.serverList }}</h2>
        <ul class="lx-rows side-mods" data-side-mods>
          <li v-for="mod in serverModList" :key="mod.slug" class="side-mod">
            <span class="side-mod-name">{{ mod.title }}</span>
            <span class="side-mod-state">
              <BiIcon
                v-if="sideModState(mod.kind).icon !== null"
                :name="sideModState(mod.kind).icon ?? 'lock-fill'"
              />{{ sideModState(mod.kind).text }}
            </span>
          </li>
        </ul>
      </template>

      <h2 class="spaced">{{ ru.install.sources }}</h2>
      <dl class="lx-rows sources">
        <div class="source">
          <dt>{{ ru.install.sourceFiles }}</dt>
          <dd class="lx-mono selectable">{{ MOJANG_HOST }}</dd>
        </div>
        <div v-if="fabric !== null && skinHosts.length > 0" class="source" data-skin-sources>
          <dt>{{ ru.install.sourceFabric[fabric] }}</dt>
          <dd class="lx-mono selectable">
            <template v-for="(host, index) in skinHosts" :key="host"
              ><br v-if="index > 0" />{{ host }}</template
            >
          </dd>
        </div>
        <div v-if="modsFromCatalog" class="source" data-mod-sources>
          <dt>{{ ru.mods.source }}</dt>
          <dd>
            <span class="lx-mono selectable">{{ ru.mods.sourceHost }}</span>
            <span class="source-note">{{ ru.mods.sourceNote }}</span>
          </dd>
        </div>
        <div class="source">
          <dt>{{ ru.install.sourceAddress }}</dt>
          <dd v-if="launcherOnly" class="source-quiet" data-launcher-only>
            {{ ru.server.launcherOnly }}
          </dd>
          <dd v-else>
            <span class="lx-mono selectable source-host"
              ><template v-for="(part, index) in hostParts" :key="index"
                >{{ part }}<wbr
              /></template>
            </span>
            <span class="source-note">{{ ru.install.sourceCatalog }}</span>
          </dd>
        </div>
      </dl>

      <div class="lx-tip spaced">
        <BiIcon name="lightbulb" />
        <div>
          <strong>{{ ru.install.tipTitle }}</strong>
          {{ ru.install.tipText }}
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.settings-link {
  display: block;
  color: var(--mc-text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.settings-link:hover {
  color: var(--mc-text);
}

.spaced {
  margin-top: 16px;
}

.launch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  height: 100%;
}

.stage {
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 32px 0;
}

.waiting {
  overflow: hidden;
  margin-bottom: 18px;
  background: var(--mc-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.content {
  padding: 14px 32px 24px;
}

.title-row {
  display: flex;
  align-items: flex-end;
  gap: 16px;
}

.title {
  flex: 1;
  min-width: 0;
}

.title .lx-h1 {
  margin-top: 4px;
  font-size: 24px;
}

.percent {
  font-size: 40px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.percent span {
  font-size: 22px;
  color: var(--lx-text-faint);
}

.notice {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: var(--mc-radius);
  border: 1px solid var(--mc-border);
  background: var(--mc-surface);
}

.notice.is-error {
  border-color: color-mix(in srgb, var(--mc-danger) 40%, transparent);
}

.notice h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: var(--mc-font-body);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
}

.notice.is-error h2 .bi {
  color: var(--mc-danger);
}

.notice.is-cancelled h2 .bi {
  color: var(--mc-text-muted);
}

.lx-eyebrow.is-danger {
  color: var(--mc-danger);
}

.lx-eyebrow.is-muted {
  color: var(--mc-text-muted);
}

.skel-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.source-note {
  display: block;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.notice p {
  margin: 6px 0 12px;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.notice p {
  text-wrap: pretty;
}

.notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.notice p:last-child {
  margin-bottom: 0;
}

.notice .ban-term {
  overflow-wrap: anywhere;
  margin-bottom: 4px;
  color: var(--mc-text);
}

.overall {
  margin-top: 16px;
}

.numbers {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: var(--mc-text-muted);
  font-variant-numeric: tabular-nums;
}

.numbers strong {
  font-weight: 400;
  color: var(--mc-text);
}

.steps {
  display: flex;
  flex-direction: column;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.step {
  position: relative;
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 12px;
  align-items: start;
  padding: 5px 0;
}

.step::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 30px;
  bottom: -6px;
  width: 2px;
  background: var(--mc-border);
}

.step-group::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--mc-border);
}

.step.is-done + .step-group::before {
  background: color-mix(in srgb, var(--mc-accent) 45%, transparent);
}

.step:last-child::before {
  display: none;
}

.step.is-done::before {
  background: color-mix(in srgb, var(--mc-accent) 45%, transparent);
}

.step-dot {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 13px;
  background: var(--mc-surface-3);
  color: var(--mc-text-muted);
  border: 1px solid var(--mc-border);
}

.is-done .step-dot {
  background: var(--mc-accent-soft);
  color: var(--mc-accent);
  border-color: color-mix(in srgb, var(--mc-accent) 40%, transparent);
}

.is-active .step-dot {
  background: var(--mc-violet);
  color: var(--lx-on-accent);
  border-color: var(--mc-violet);
  box-shadow: 0 0 0 5px var(--mc-violet-soft);
}

.is-failed .step-dot {
  background: var(--lx-danger-soft);
  color: var(--mc-danger);
  border-color: color-mix(in srgb, var(--mc-danger) 40%, transparent);
}

.step-title {
  font-weight: 600;
  font-size: 14px;
}

.is-wait .step-title,
.is-skipped .step-title {
  font-weight: 400;
  color: var(--mc-text-muted);
}

.step-note {
  margin-top: 2px;
  font-size: 12px;
  color: var(--lx-text-faint);
}

.step-bar {
  max-width: 360px;
  margin-top: 8px;
}

.step-group {
  position: relative;
  padding: 10px 0 4px 38px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lx-text-faint);
}

.step-note .beta {
  margin-left: 6px;
  vertical-align: 1px;
}

.side-mods {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}

.side-mod {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 14px;
  font-size: 13px;
  white-space: nowrap;
}

.side-mod-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.side-mod-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--mc-text-muted);
}

.side-mod-state .bi {
  font-size: 11px;
}

.step-right {
  padding-top: 4px;
  font-size: 12px;
  color: var(--lx-text-faint);
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.log-panel {
  margin-top: 20px;
}

.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.log-head h2 {
  margin: 0;
  font-family: var(--mc-font-body);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.log {
  max-height: 240px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border);
  background: var(--lx-log-bg);
  font-family: var(--mc-font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--mc-text-muted);
  white-space: pre-wrap;
}

.side {
  overflow-y: auto;
  padding: 20px;
  border-left: 1px solid var(--mc-border);
  background: var(--mc-surface);
}

.side h2 {
  margin: 0 0 8px;
  font-family: var(--mc-font-body);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.side .spaced {
  margin-top: 24px;
}

.compact {
  padding: 11px 14px;
}

.compact .lx-row-title {
  font-size: 13px;
}

.one-line {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.compact .settings-link {
  white-space: nowrap;
}

.sources {
  margin: 0;
}

.source {
  padding: 10px 14px;
}

.source + .source {
  border-top: 1px solid var(--mc-border);
}

.source dt {
  font-size: 12px;
  color: var(--mc-text-muted);
}

.source dd {
  margin: 2px 0 0;
  font-size: 12px;
}

.source dd.source-quiet {
  color: var(--mc-text-muted);
}

.source-host {
  display: block;
  overflow-wrap: anywhere;
}

@media (max-width: 1099px) {
  .launch {
    grid-template-columns: minmax(0, 1fr) 268px;
  }

  .side {
    padding: 20px 16px;
  }

  .compact {
    gap: 12px;
    padding: 11px 12px;
  }

  .toolbar,
  .content {
    padding-left: 24px;
    padding-right: 24px;
  }
}
</style>
