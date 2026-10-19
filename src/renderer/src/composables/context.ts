import { inject, type InjectionKey } from 'vue';
import type { LauncherApi } from '@shared/ipc';
import type { Stores } from './stores';

export interface LauncherContext {
  api: LauncherApi;
  demo: boolean;
  now: () => Date;
  random: () => number;
}

export const CONTEXT_KEY: InjectionKey<LauncherContext> = Symbol('launcher-context');
export const STORES_KEY: InjectionKey<Stores> = Symbol('launcher-stores');

export function useLauncher(): LauncherContext {
  const context = inject(CONTEXT_KEY);
  if (context === undefined) {
    throw new Error('Launcher context is not provided');
  }
  return context;
}

export function useStores(): Stores {
  const stores = inject(STORES_KEY);
  if (stores === undefined) {
    throw new Error('Launcher stores are not provided');
  }
  return stores;
}
