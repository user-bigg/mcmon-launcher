import type { RouteLocationNormalized, Router } from 'vue-router';
import type { TelemetryScreen, TrackedEvent } from '@shared/telemetry';
import type { LauncherContext } from './context';
import { useLauncher } from './context';

export type Track = (event: TrackedEvent) => void;

const ROUTE_SCREENS: Partial<Record<string, TelemetryScreen>> = {
  home: 'home',
  servers: 'servers',
  server: 'server',
  launch: 'launch',
  library: 'library',
  'my-servers': 'my_servers',
  accounts: 'accounts',
  settings: 'settings',
  welcome: 'welcome',
  crash: 'crash',
};

export function createTrack(context: LauncherContext): Track {
  if (context.demo) {
    return () => undefined;
  }
  return (event) => {
    try {
      context.api.telemetry.track(event);
    } catch {
      return;
    }
  };
}

export function useTrack(): Track {
  return createTrack(useLauncher());
}

export function newLaunchId(): string {
  return globalThis.crypto.randomUUID();
}

function viewedServer(route: RouteLocationNormalized): number | null {
  const id = Number(route.params.id);
  return route.name === 'server' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function screenOf(route: RouteLocationNormalized): TrackedEvent {
  const screen = ROUTE_SCREENS[String(route.name)] ?? 'other';
  return { type: 'screen.viewed', screen, server_id: viewedServer(route) };
}

export function trackScreens(router: Router, track: Track): void {
  let last: string | null = null;
  router.afterEach((to, _from, failure) => {
    if (failure !== undefined) {
      return;
    }
    // The blank screen behind a running game is not a view; coming back from it is a new one.
    if (to.meta.idle === true) {
      last = null;
      return;
    }
    const event = screenOf(to);
    const key = JSON.stringify(event);
    if (key !== last) {
      last = key;
      track(event);
    }
  });
}
