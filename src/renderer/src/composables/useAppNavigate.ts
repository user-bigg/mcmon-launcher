import { onBeforeUnmount } from 'vue';
import { useRouter, type Router } from 'vue-router';
import type { AppNavigation } from '@shared/ipc';
import { useLauncher } from './context';
import { useSettings } from './useSettings';

export const IDLE_ROUTE = '/idle';
const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function appNavigator(
  router: Router,
  reloadSettings: () => Promise<void> = () => Promise.resolve(),
): (navigation: AppNavigation) => Promise<void> {
  let saved: string | null = null;
  const isIdle = (): boolean => router.currentRoute.value.path === IDLE_ROUTE;

  return async (navigation) => {
    if (navigation.kind === 'idle') {
      if (!isIdle()) {
        saved = router.currentRoute.value.fullPath;
        await router.replace(IDLE_ROUTE);
      }
      return;
    }
    if (navigation.kind === 'restore') {
      if (isIdle()) {
        const back = saved ?? '/';
        saved = null;
        await router.replace(back);
      }
      return;
    }
    if (navigation.kind === 'settings-changed') {
      await reloadSettings();
      return;
    }
    if (navigation.kind === 'settings') {
      saved = null;
      const { section } = navigation;
      await router.push({ path: '/settings', query: section === null ? {} : { section } });
      return;
    }
    if (!INSTANCE_ID.test(navigation.instanceId)) {
      return;
    }
    const crash = `/crash/${navigation.instanceId}`;
    saved = null;
    await (isIdle() ? router.replace(crash) : router.push(crash));
  };
}

export function useAppNavigate(): void {
  const { api } = useLauncher();
  const settings = useSettings();
  const navigate = appNavigator(useRouter(), () => settings.reload());
  const unsubscribe = api.onNavigate((navigation) => {
    void navigate(navigation);
  });
  onBeforeUnmount(unsubscribe);
}
