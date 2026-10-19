<script setup lang="ts">
import { computed } from 'vue';
import type { ServerCard } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { useCatalog } from '../composables/useCatalog';
import { useLaunch } from '../composables/useLaunch';
import { useLibrary } from '../composables/useLibrary';
import { useServerMemory } from '../composables/useServerMemory';
import { useSite } from '../composables/useSite';
import { useWithoutMods } from '../composables/useWithoutMods';
import { pendingUpdate, updateText } from '../lib/server-fact';
import {
  fabricNote,
  fabricPurpose,
  serverClientModPreview,
  serverSkinsPreview,
  versionLabel,
} from '../lib/skins';
import { formatBytes } from '../lib/units';
import BiIcon from './BiIcon.vue';
import LaunchAction from './LaunchAction.vue';
import TagChip from './TagChip.vue';

const { card } = defineProps<{ card: ServerCard }>();

const catalog = useCatalog();
const library = useLibrary();
const site = useSite();

const installed = computed(() => library.hasServer(card.id));
const estimate = computed(() => (installed.value ? undefined : catalog.estimate(card.id)));
const minecraft = computed(() =>
  card.launch.kind === 'direct' ? card.launch.minecraft : (card.versions?.to ?? ''),
);
const mods = useWithoutMods(() => `server-${String(card.id)}`);
const skins = computed(() => serverSkinsPreview(card, site.skinMod.value, mods.off.value));
const launch = useLaunch();
const fabric = computed(() =>
  fabricPurpose(
    skins.value,
    serverClientModPreview(card, site.skinMod.value, launch.blockedClientMods.value),
  ),
);
const { text: memory } = useServerMemory();
const update = computed(() => pendingUpdate(card, library.installed(card.id)));
const sizeNote = computed(() => {
  if (update.value !== null) {
    return updateText(update.value);
  }
  if (installed.value) {
    return ru.serverPage.installedSize;
  }
  return estimate.value === undefined ? null : formatBytes(estimate.value.downloadBytes);
});
</script>

<template>
  <section class="lx-panel is-launch">
    <div class="lx-panel-head">
      <h3><BiIcon name="box-seam" />{{ ru.serverPage.install }}</h3>
      <span v-if="sizeNote !== null" class="lx-faint small lx-num" data-size-note>{{
        sizeNote
      }}</span>
    </div>
    <div class="lx-panel-body">
      <dl class="kv">
        <div>
          <dt><BiIcon name="boxes" />{{ ru.serverPage.installMinecraft }}</dt>
          <dd class="version">
            <TagChip v-if="skins === 'server'" small data-no-mods>{{ ru.install.noMods }}</TagChip>
            {{ versionLabel(minecraft, fabric) }}
          </dd>
        </div>
        <div>
          <dt><BiIcon name="cup-hot" />{{ ru.serverPage.installJava }}</dt>
          <dd>{{ ru.serverPage.installJavaValue }}</dd>
        </div>
        <div>
          <dt><BiIcon name="memory" />{{ ru.serverPage.installMemory }}</dt>
          <dd data-memory>{{ memory }}</dd>
        </div>
        <div v-if="estimate">
          <dt><BiIcon name="download" />{{ ru.serverPage.installSize }}</dt>
          <dd>{{ formatBytes(estimate.downloadBytes) }}</dd>
        </div>
      </dl>
      <div class="lx-divider" />
      <ul class="trust">
        <li><BiIcon name="shield-check" />{{ ru.serverPage.trustHashes }}</li>
        <li><BiIcon name="layers" />{{ ru.serverPage.trustFolder }}</li>
        <li v-if="fabric !== null" data-skins-note>
          <BiIcon name="plug" />{{ ru.serverPage.trustFabric[fabricNote(fabric)] }}
        </li>
        <li v-if="estimate">
          <BiIcon name="hdd" />{{
            fill(ru.serverPage.trustCache, { size: formatBytes(estimate.cachedBytes) })
          }}
        </li>
      </ul>
      <LaunchAction
        class="panel-action"
        :server="card"
        size="md"
        source="server_page"
        :needs-install="!installed"
      />
    </div>
  </section>
</template>

<style scoped>
.is-launch {
  border-color: color-mix(in srgb, var(--mc-violet) 35%, transparent);
}

.is-launch .lx-panel-head .bi {
  color: var(--mc-violet);
}

.small {
  font-size: 12px;
}

.kv {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  font-size: 13px;
}

.kv > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.kv dt {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kv dt .bi {
  width: 14px;
  font-size: 14px;
  color: var(--mc-text-muted);
}

.kv dd {
  margin: 0;
  font-size: 13px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.kv dd.version {
  display: flex;
  align-items: center;
  gap: 8px;
}

.trust {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: var(--mc-text-muted);
}

.trust li {
  display: flex;
  gap: 8px;
}

.trust .bi {
  margin-top: 2px;
  color: var(--mc-accent);
}

.panel-action {
  width: 100%;
  margin-top: 14px;
}
</style>
