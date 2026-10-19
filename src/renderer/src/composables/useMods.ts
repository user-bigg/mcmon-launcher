import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue';
import type {
  ModsCatalogView,
  ModsService,
  ServerModsQuery,
  ServerModsView,
  ShaderChoice,
} from '@shared/mods';
import type { SiteError } from '@shared/site';
import {
  DEFAULT_SHADERS,
  enabledAfter,
  enabledModsCount,
  type ShaderPick,
  withoutShaderNeeds,
  withShaders,
  withToggled,
} from '../lib/mods';
import { demoModsService } from '../mock/mods';
import type { LauncherContext } from './context';
import { useStores } from './context';

export type ModsStatus = 'loading' | 'ready' | 'error';

export interface ModsStore {
  view: ShallowRef<ModsCatalogView | null>;
  status: Ref<ModsStatus>;
  error: ShallowRef<SiteError | null>;
  saveFailed: Ref<boolean>;
  lastShaders: Ref<ShaderPick>;
  enabledCount: ComputedRef<number | null>;
  load: () => Promise<void>;
  setEnabled: (slug: string, on: boolean) => Promise<boolean>;
  setShaders: (choice: ShaderChoice) => Promise<boolean>;
  serverPlan: (query: ServerModsQuery) => Promise<ServerModsView | null>;
  setServerOptional: (serverId: number, slug: string, on: boolean) => Promise<boolean>;
  changes: Ref<number>;
}

type Saving = () => Promise<{ ok: boolean }>;

export function createMods(context: LauncherContext): ModsStore {
  const service: ModsService = context.demo ? demoModsService() : context.api.mods;
  const view = shallowRef<ModsCatalogView | null>(null);
  const status = ref<ModsStatus>('loading');
  const error = shallowRef<SiteError | null>(null);
  const saveFailed = ref(false);
  const lastShaders = ref<ShaderPick>(DEFAULT_SHADERS);
  const changes = ref(0);
  let run = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;

  function remember(next: ModsCatalogView): void {
    const choice = next.shaders?.choice ?? 'off';
    if (choice !== 'off') {
      lastShaders.value = choice;
    }
  }

  async function load(): Promise<void> {
    run += 1;
    const mine = run;
    if (view.value === null) {
      status.value = 'loading';
    }
    const result = await service.catalog().catch(() => null);
    if (mine !== run || pending > 0) {
      return;
    }
    if (result?.ok === true) {
      view.value = result.value;
      remember(result.value);
      error.value = null;
      status.value = 'ready';
      return;
    }
    error.value = result?.ok === false ? result.error : null;
    status.value = view.value === null ? 'error' : 'ready';
  }

  // Saves go one after another, each on top of what the previous one wrote; the window shows
  // the change at once and puts it back if main did not keep it.
  function saved(save: Saving, undo: () => void): Promise<boolean> {
    pending += 1;
    const done = queue.then(async () => {
      const result = await save().catch(() => null);
      const kept = result?.ok === true;
      if (!kept) {
        undo();
      }
      saveFailed.value = !kept;
      return kept;
    });
    queue = done.then(async () => {
      pending -= 1;
      changes.value += 1;
      if (pending === 0) {
        await load();
      }
    });
    return done;
  }

  function setEnabled(slug: string, on: boolean): Promise<boolean> {
    const current = view.value;
    if (current === null) {
      return Promise.resolve(false);
    }
    view.value = withToggled(current, slug, on);
    return saved(
      async () => {
        const choices = await service.choices();
        return choices.ok
          ? service.setChoices({ enabled: enabledAfter(choices.value.enabled, slug, on) })
          : choices;
      },
      () => {
        if (view.value !== null) {
          view.value = withToggled(view.value, slug, !on);
        }
      },
    );
  }

  function setShaders(choice: ShaderChoice): Promise<boolean> {
    const current = view.value;
    if (current === null) {
      return Promise.resolve(false);
    }
    const before = current.shaders?.choice ?? 'off';
    if (choice !== 'off') {
      lastShaders.value = choice;
    }
    view.value = withShaders(current, choice);
    return saved(
      async () => {
        const choices = await service.choices();
        if (!choices.ok) {
          return choices;
        }
        const enabled =
          choice === 'off' ? withoutShaderNeeds(current, choices.value.enabled) : undefined;
        return service.setChoices(
          enabled === undefined ? { shaders: choice } : { shaders: choice, enabled },
        );
      },
      () => {
        if (view.value !== null) {
          view.value = withShaders(view.value, before);
        }
      },
    );
  }

  async function serverPlan(query: ServerModsQuery): Promise<ServerModsView | null> {
    const result = await service.serverPlan(query).catch(() => null);
    return result?.ok === true ? result.value : null;
  }

  function setServerOptional(serverId: number, slug: string, on: boolean): Promise<boolean> {
    return saved(
      () => service.setServerOptional(serverId, slug, on),
      () => undefined,
    );
  }

  return {
    view,
    status,
    error,
    saveFailed,
    lastShaders,
    enabledCount: computed(() => (view.value === null ? null : enabledModsCount(view.value))),
    load,
    setEnabled,
    setShaders,
    serverPlan,
    setServerOptional,
    changes,
  };
}

export function useMods(): ModsStore {
  return useStores().mods;
}

export interface ServerModsState {
  view: ShallowRef<ServerModsView | null>;
  reload: () => Promise<void>;
}

export function useServerMods(query: () => ServerModsQuery | null): ServerModsState {
  const mods = useMods();
  const view = shallowRef<ServerModsView | null>(null);
  let run = 0;
  let alive = true;

  async function reload(): Promise<void> {
    run += 1;
    const mine = run;
    const asked = query();
    const loaded = asked === null ? null : await mods.serverPlan(asked);
    if (alive && mine === run) {
      view.value = loaded;
    }
  }

  watch(
    () => {
      const asked = query();
      return asked === null ? null : `${String(asked.serverId)}:${asked.minecraft}`;
    },
    () => {
      view.value = null;
      void reload();
    },
    { immediate: true },
  );
  watch(mods.changes, () => void reload());
  onBeforeUnmount(() => {
    alive = false;
  });

  return { view, reload };
}
