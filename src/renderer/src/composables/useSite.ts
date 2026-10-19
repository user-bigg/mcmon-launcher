import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import { SITE_LINKS } from '@shared/links';
import type { ReportReason } from '@shared/report';
import type { SiteError, SiteLinks, SitePageKey } from '@shared/site';
import type { SkinModTable } from '@shared/skin-mod';
import { reportReasons as demoReasons } from '../mock/servers';
import type { LauncherContext } from './context';
import { useStores } from './context';

export interface SiteStore {
  links: ComputedRef<Record<SitePageKey, string> & SiteLinks>;
  reportReasons: ComputedRef<ReportReason[]>;
  behaviorTelemetry: Ref<boolean>;
  skinMod: ShallowRef<SkinModTable | null>;
  load: (revalidate?: boolean) => Promise<SiteError | null>;
}

const FALLBACK: Record<SitePageKey, string> = SITE_LINKS;

export function createSite(context: LauncherContext): SiteStore {
  const loaded = shallowRef<SiteLinks>({});
  const reasons = shallowRef<ReportReason[]>(context.demo ? demoReasons : []);

  const behaviorTelemetry = ref(false);
  void context.api.telemetry
    .behavior()
    .then((on) => {
      behaviorTelemetry.value = on;
    })
    .catch(() => undefined);

  const skinMod = shallowRef<SkinModTable | null>(null);

  async function loadSkinMod(): Promise<void> {
    const result = await context.api.site.skinMod().catch(() => null);
    skinMod.value = result?.ok === true ? result.value : null;
  }

  async function load(revalidate = false): Promise<SiteError | null> {
    void loadSkinMod();
    if (context.demo) {
      return null;
    }
    const result = await context.api.site.meta(revalidate);
    if (!result.ok) {
      return result.error;
    }
    loaded.value = result.value.links;
    reasons.value = result.value.reportReasons;
    return null;
  }

  return {
    links: computed(() => ({ ...FALLBACK, ...loaded.value })),
    reportReasons: computed(() => reasons.value),
    behaviorTelemetry,
    skinMod,
    load,
  };
}

export function useSite(): SiteStore {
  return useStores().site;
}
