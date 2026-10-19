import { watch } from 'vue';
import { useRouter } from 'vue-router';
import type { DeepLink } from '@shared/deep-link';
import { useCatalog } from './useCatalog';
import { useDeepLink } from './useDeepLink';
import { useLaunch } from './useLaunch';
import { usePlay } from './usePlay';

// A play request of the MC Monitor site: the server screen opens and the launch starts without
// the question a link gets. A server that cannot be launched directly just stays open.
export function useSitePlay(): void {
  const deepLink = useDeepLink();
  const catalog = useCatalog();
  const launch = useLaunch();
  const router = useRouter();
  const { playServer } = usePlay();

  async function start(link: DeepLink): Promise<void> {
    await router.push(`/server/${String(link.serverId)}`);
    if (link.stale === true) {
      return;
    }
    const loaded = await catalog.loadCard(link.serverId);
    if (loaded.status !== 'ready' || loaded.card.launch.kind !== 'direct' || launch.busy.value) {
      return;
    }
    await playServer(loaded.card, {
      source: link.source ?? 'other',
      ...(link.launchId === undefined ? {} : { launchId: link.launchId }),
    });
  }

  watch(
    deepLink.direct,
    () => {
      const link = deepLink.takeDirect();
      if (link !== null) {
        void start(link).catch(() => undefined);
      }
    },
    { immediate: true },
  );
}
