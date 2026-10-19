import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { vi } from 'vitest';
import { createMemoryHistory, type Router } from 'vue-router';
import type {
  AccountEvent,
  AccountResult,
  AccountState,
  AccountUser,
  NickResult,
  PlayCheck,
} from '@shared/account';
import type { ServerCard } from '@shared/catalog';
import type { CrashAnalysis, CrashEvent, CrashResult } from '@shared/crash';
import type { DeepLink, DeepLinkDelivery } from '@shared/deep-link';
import type { LookResult } from '@shared/look';
import type { ServerInstanceInfo } from '@shared/instance';
import type { AppNavigation, LauncherApi } from '@shared/ipc';
import type { MicrosoftState } from '@shared/microsoft';
import {
  catalogView,
  DEFAULT_MOD_CHOICES,
  newestMinecraft,
  serverKey,
  serverModsView,
  type ModCatalog,
  type ModChoices,
  type ModChoicesPatch,
  type ServerModsQuery,
  type ServerModsSource,
  NO_SERVER_MODS,
} from '@shared/mods';
import type { SiteChange, SiteError } from '@shared/site';
import type { SystemAutostart, SystemJava, SystemMemory, SystemResult } from '@shared/system';
import type {
  GameSession,
  LaunchChange,
  LaunchError,
  LaunchEvent,
  LaunchResult,
  LaunchState,
  PreparedGame,
} from '@shared/launch';
import { EMPTY_PLAYERS, type StoredPlayers } from '@shared/players';
import { DEFAULT_SETTINGS, type LauncherSettings, type SettingsPatch } from '@shared/settings';
import type { RestartResult, UpdateState } from '@shared/update';
import App from './App.vue';
import type { LauncherContext } from './composables/context';
import { launcherPlugin } from './composables/stores';
import { demoModCatalog, demoServerMods } from './mock/mods';
import { SERVER_IDS, serverCard } from './mock/servers';
import { createAppRouter } from './router';

export const stubTotalMemoryMb = 16384;
export const stubDefaultGameMemoryMb = 4096;
export const stubInstalledJava: readonly number[] = [21, 17];

export const TEST_NOW = new Date('2026-10-03T12:00:00Z');

export const TEST_USER: AccountUser = {
  id: 7,
  name: 'Player_7',
  nick: null,
  avatarUrl: null,
  skin: null,
  cape: null,
  createdAt: '2026-03-12T10:00:00Z',
  votesMonth: 4,
  favoritesCount: 2,
  hoursPlayed: null,
  trusted: true,
  trustedReason: null,
  unreadAlerts: 0,
  ownedServers: [],
};

export const idleState: LaunchState = {
  seq: 0,
  phase: 'idle',
  operationId: 0,
  target: null,
  progress: null,
  session: null,
  skins: null,
  windowReady: false,
  windowSlow: false,
  windowDialog: false,
  lastError: null,
  lastExit: null,
  lastCrash: null,
};

function done<T>(value: T): LaunchResult<T> {
  return { ok: true, value };
}

const busyError: LaunchError = { code: 'busy' };

function offline(): Promise<{ ok: false; error: SiteError }> {
  return Promise.resolve({ ok: false, error: { code: 'offline' } });
}

export const signedOutState: AccountState = {
  seq: 0,
  encryptionAvailable: true,
  user: null,
  connect: null,
  error: null,
};

export const emptyMicrosoftState: MicrosoftState = {
  seq: 0,
  available: false,
  encryptionAvailable: true,
  accounts: [],
  login: null,
  error: null,
};

function microsoftOff(): Promise<{ ok: false; error: { code: 'unavailable' } }> {
  return Promise.resolve({ ok: false, error: { code: 'unavailable' } });
}

function notSignedIn<T>(): Promise<AccountResult<T>> {
  return Promise.resolve({ ok: false, error: { code: 'not_signed_in' } });
}

function busy<T>(): LaunchResult<T> {
  return { ok: false, error: busyError };
}

export const idleUpdateState: UpdateState = {
  seq: 0,
  status: { kind: 'none' },
  current: { version: '0.1.0', builtAt: '2026-10-03T09:00:00.000Z', os: 'win32', arch: 'x64' },
  skipped: [],
  checkedAt: '2026-10-03T11:30:00.000Z',
  blocked: null,
};

export interface Stub {
  api: LauncherApi;
  emit: (event: LaunchEvent) => void;
  emitCrash: (event: CrashEvent) => void;
  emitDeepLink: (link: DeepLink) => void;
  emitNavigate: (navigation: AppNavigation) => void;
  emitAccount: (event: AccountEvent) => void;
  emitSite: (change: SiteChange) => void;
  emitUpdate: (state: Partial<UpdateState>) => void;
  update: { state: UpdateState; restart: RestartResult };
  settings: LauncherSettings;
  players: { stored: StoredPlayers };
  mods: {
    catalog: ModCatalog | null;
    choices: ModChoices;
    servers: Partial<Record<number, ServerModsSource>>;
  };
}

let seq = 0;

export function launchEvent(change: LaunchChange, state: Partial<LaunchState> = {}): LaunchEvent {
  seq += 1;
  return { ...change, state: { ...idleState, seq, ...state } };
}

export function stubLauncher(): Stub {
  const launchListeners = new Set<(event: LaunchEvent) => void>();
  const withoutMods = new Set<string>();
  const crashListeners = new Set<(event: CrashEvent) => void>();
  const deepLinkListeners = new Set<(delivery: DeepLinkDelivery) => void>();
  const navigateListeners = new Set<(navigation: AppNavigation) => void>();
  const accountListeners = new Set<(event: AccountEvent) => void>();
  const siteListeners = new Set<(change: SiteChange) => void>();
  const updateListeners = new Set<(state: UpdateState) => void>();
  const update: Stub['update'] = { state: idleUpdateState, restart: { ok: true } };
  const currentUpdate = (): Promise<UpdateState> => Promise.resolve(update.state);
  const settings: LauncherSettings = { ...DEFAULT_SETTINGS, ramGb: 6, resolution: '1920x1080' };
  const players: Stub['players'] = { stored: { ...EMPTY_PLAYERS, nicks: [] } };
  const mods: Stub['mods'] = {
    catalog: demoModCatalog,
    choices: structuredClone(DEFAULT_MOD_CHOICES),
    servers: Object.fromEntries(
      Object.entries(demoServerMods).map(([id, server]) => [
        id,
        { state: 'known' as const, modpack: false, mods: server ?? NO_SERVER_MODS },
      ]),
    ),
  };
  const modsFetched = <T>(
    value: T,
  ): Promise<{ ok: true; value: T; stale: false; fetchedAt: string }> =>
    Promise.resolve({ ok: true, value, stale: false, fetchedAt: TEST_NOW.toISOString() });
  const modChoices = (): Promise<{ ok: true; value: ModChoices }> =>
    Promise.resolve({ ok: true, value: structuredClone(mods.choices) });
  let deliveries = 0;
  const api: LauncherApi = {
    window: {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      reportBoot: vi.fn(),
      isMaximized: vi.fn(() => Promise.resolve(false)),
      onMaximizedChanged: vi.fn(() => () => undefined),
    },
    openExternal: vi.fn(() => Promise.resolve(true)),
    onDeepLink: vi.fn((listener: (delivery: DeepLinkDelivery) => void) => {
      deepLinkListeners.add(listener);
      return (): void => {
        deepLinkListeners.delete(listener);
      };
    }),
    ackDeepLink: vi.fn(),
    onNavigate: vi.fn((listener: (navigation: AppNavigation) => void) => {
      navigateListeners.add(listener);
      return (): void => {
        navigateListeners.delete(listener);
      };
    }),
    settings: {
      get: vi.fn(() => Promise.resolve({ ok: true as const, value: { ...settings } })),
      update: vi.fn((patch: SettingsPatch) => {
        Object.assign(settings, patch);
        return Promise.resolve({ ok: true as const, value: { ...settings } });
      }),
    },
    players: {
      get: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: structuredClone(players.stored) }),
      ),
      save: vi.fn((next: StoredPlayers) => {
        players.stored = structuredClone(next);
        return Promise.resolve({ ok: true as const, value: structuredClone(next) });
      }),
    },
    mods: {
      catalog: vi.fn((minecraft?: string) => {
        const catalog = mods.catalog;
        return catalog === null
          ? offline()
          : modsFetched(catalogView(catalog, mods.choices, minecraft ?? newestMinecraft(catalog)));
      }),
      choices: vi.fn(() => modChoices()),
      setChoices: vi.fn((patch: ModChoicesPatch) => {
        mods.choices = { ...mods.choices, ...structuredClone(patch) };
        return modChoices();
      }),
      serverPlan: vi.fn((query: ServerModsQuery) =>
        mods.catalog === null
          ? offline()
          : modsFetched(
              serverModsView(
                query,
                mods.servers[query.serverId] ?? { state: 'unknown' },
                mods.catalog,
                mods.choices,
              ),
            ),
      ),
      setServerOptional: vi.fn((serverId: number, slug: string, on: boolean) => {
        const key = serverKey(serverId);
        const off = (mods.choices.optionalOff[key] ?? []).filter((item) => item !== slug);
        mods.choices.optionalOff[key] = on ? off : [...off, slug];
        return modChoices();
      }),
    },
    launch: {
      prepare: vi.fn(() => Promise.resolve(busy<PreparedGame>())),
      launch: vi.fn(() => new Promise<LaunchResult<GameSession>>(() => undefined)),
      cancel: vi.fn(() => Promise.resolve(done(null))),
      kill: vi.fn(() => Promise.resolve(done(null))),
      keepWaiting: vi.fn(() => Promise.resolve(done(null))),
      setJoinServer: vi.fn(() => Promise.resolve(done(null))),
      answerMods: vi.fn(() => Promise.resolve(done(null))),
      logTail: vi.fn(() => Promise.resolve(done<string[]>([]))),
      state: vi.fn(() => Promise.resolve(done<LaunchState>(idleState))),
      onEvent: vi.fn((listener: (event: LaunchEvent) => void) => {
        launchListeners.add(listener);
        return (): void => {
          launchListeners.delete(listener);
        };
      }),
    },
    instances: {
      list: vi.fn(() => Promise.resolve(done<ServerInstanceInfo[]>([]))),
      sharedFiles: vi.fn(() => Promise.resolve(done({ bytes: 0 }))),
      remove: vi.fn(() => Promise.resolve(done(null))),
      launchOptions: vi.fn((folderId: string) =>
        Promise.resolve(done({ withoutMods: withoutMods.has(folderId) })),
      ),
      setWithoutMods: vi.fn((folderId: string, off: boolean) => {
        if (off) {
          withoutMods.add(folderId);
        } else {
          withoutMods.delete(folderId);
        }
        return Promise.resolve(done({ withoutMods: off }));
      }),
    },
    crash: {
      last: vi.fn(() =>
        Promise.resolve<CrashResult<CrashAnalysis | null>>({ ok: true, value: null }),
      ),
      apply: vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'busy' as const } })),
      report: vi.fn(() =>
        Promise.resolve({ ok: false as const, error: { code: 'busy' as const } }),
      ),
      onEvent: vi.fn((listener: (event: CrashEvent) => void) => {
        crashListeners.add(listener);
        return (): void => {
          crashListeners.delete(listener);
        };
      }),
    },
    site: {
      meta: vi.fn(() => offline()),
      servers: vi.fn(() => offline()),
      server: vi.fn(() => offline()),
      live: vi.fn(() => offline()),
      scenes: vi.fn(() => offline()),
      ensureScene: vi.fn(() => offline()),
      skinMod: vi.fn(() => offline()),
      lookPresets: vi.fn(() => offline()),
      standardSkin: vi.fn(() => Promise.resolve(null)),
      ping: vi.fn(() =>
        Promise.resolve({ ok: false as const, error: { code: 'timeout' as const } }),
      ),
      telemetryPreview: vi.fn(() => offline()),
      favorites: vi.fn(() => notSignedIn<number[]>()),
      setFavorite: vi.fn(() => notSignedIn<boolean>()),
      vote: vi.fn(() => notSignedIn<never>()),
      report: vi.fn(() => notSignedIn<never>()),
      alerts: vi.fn(() => notSignedIn<never>()),
      readAlerts: vi.fn(() => notSignedIn<never>()),
      clearAlerts: vi.fn(() => notSignedIn<never>()),
      setWatch: vi.fn(() => notSignedIn<boolean>()),
      alertSettings: vi.fn(() => notSignedIn<never>()),
      setAlertSettings: vi.fn(() => notSignedIn<never>()),
      ownedServers: vi.fn(() => notSignedIn<never>()),
      ownedServer: vi.fn(() => notSignedIn<never>()),
      votePauses: vi.fn(() => notSignedIn<never>()),
      onChanged: vi.fn((listener: (change: SiteChange) => void) => {
        siteListeners.add(listener);
        return (): void => {
          siteListeners.delete(listener);
        };
      }),
    },
    system: {
      memory: vi.fn(() =>
        Promise.resolve<SystemResult<SystemMemory>>({
          ok: true,
          value: { totalMb: stubTotalMemoryMb, defaultGameMb: stubDefaultGameMemoryMb },
        }),
      ),
      java: vi.fn(() =>
        Promise.resolve<SystemResult<SystemJava>>({
          ok: true,
          value: { installed: [...stubInstalledJava] },
        }),
      ),
      autostart: vi.fn(() =>
        Promise.resolve<SystemResult<SystemAutostart>>({ ok: true, value: { view: 'on' } }),
      ),
      enableAutostart: vi.fn(() =>
        Promise.resolve<SystemResult<SystemAutostart>>({ ok: true, value: { view: 'on' } }),
      ),
    },
    account: {
      state: vi.fn(() => Promise.resolve(signedOutState)),
      connect: vi.fn(() => notSignedIn<AccountState>()),
      reopen: vi.fn(() => notSignedIn<AccountState>()),
      submitCode: vi.fn(() => notSignedIn<AccountState>()),
      cancel: vi.fn(() => Promise.resolve(signedOutState)),
      logout: vi.fn(() => Promise.resolve({ ok: true as const, value: signedOutState })),
      refresh: vi.fn(() => Promise.resolve({ ok: true as const, value: signedOutState })),
      setNick: vi.fn(() =>
        Promise.resolve<NickResult>({ ok: false, error: { code: 'not_signed_in' } }),
      ),
      playCheck: vi.fn(() => Promise.resolve<PlayCheck>({ kind: 'unchecked' })),
      wear: vi.fn(() =>
        Promise.resolve<LookResult>({ ok: false, error: { code: 'not_signed_in' } }),
      ),
      resetLook: vi.fn(() =>
        Promise.resolve<LookResult>({ ok: false, error: { code: 'not_signed_in' } }),
      ),
      onEvent: vi.fn((listener: (event: AccountEvent) => void) => {
        accountListeners.add(listener);
        return (): void => {
          accountListeners.delete(listener);
        };
      }),
    },
    microsoft: {
      state: vi.fn(() => Promise.resolve(emptyMicrosoftState)),
      login: vi.fn(() => microsoftOff()),
      reopen: vi.fn(() => microsoftOff()),
      cancel: vi.fn(() => Promise.resolve(emptyMicrosoftState)),
      remove: vi.fn(() => microsoftOff()),
      onEvent: vi.fn(() => () => undefined),
    },
    update: {
      state: vi.fn(currentUpdate),
      check: vi.fn(currentUpdate),
      download: vi.fn(currentUpdate),
      skip: vi.fn((version: string) => {
        update.state = {
          ...update.state,
          seq: update.state.seq + 1,
          skipped: [...update.state.skipped, version],
        };
        return currentUpdate();
      }),
      unskip: vi.fn((version: string) => {
        update.state = {
          ...update.state,
          seq: update.state.seq + 1,
          skipped: update.state.skipped.filter((entry) => entry !== version),
        };
        return currentUpdate();
      }),
      restart: vi.fn(() => Promise.resolve(update.restart)),
      onEvent: vi.fn((listener: (state: UpdateState) => void) => {
        updateListeners.add(listener);
        return (): void => {
          updateListeners.delete(listener);
        };
      }),
    },
    telemetry: {
      behavior: vi.fn(() => Promise.resolve(false)),
      track: vi.fn(),
    },
  };
  return {
    api,
    emit: (event): void => {
      for (const listener of launchListeners) {
        listener(event);
      }
    },
    emitCrash: (event): void => {
      for (const listener of crashListeners) {
        listener(event);
      }
    },
    emitDeepLink: (link): void => {
      deliveries += 1;
      for (const listener of deepLinkListeners) {
        listener({ id: deliveries, link });
      }
    },
    emitNavigate: (navigation): void => {
      for (const listener of navigateListeners) {
        listener(navigation);
      }
    },
    emitAccount: (event): void => {
      for (const listener of accountListeners) {
        listener(event);
      }
    },
    emitSite: (change): void => {
      for (const listener of siteListeners) {
        listener(change);
      }
    },
    emitUpdate: (patch): void => {
      update.state = { ...update.state, seq: update.state.seq + 1, ...patch };
      for (const listener of updateListeners) {
        listener(update.state);
      }
    },
    update,
    settings,
    players,
    mods,
  };
}

async function preloadRoutes(router: Router): Promise<void> {
  const loaders = router
    .getRoutes()
    .map((route) => route.components?.default)
    .filter((component) => typeof component === 'function');
  await Promise.all(loaders.map((load) => (load as () => Promise<unknown>)()));
}

export interface Mounted extends Stub {
  app: VueWrapper;
  router: Router;
}

export interface MountOptions {
  stub?: Stub;
  demo?: boolean;
}

export async function mountAt(path: string, options: MountOptions = {}): Promise<Mounted> {
  const stub = options.stub ?? stubLauncher();
  const router = createAppRouter(createMemoryHistory());
  await preloadRoutes(router);
  await router.push(path);
  await router.isReady();
  const app = mount(App, {
    global: {
      plugins: [
        launcherPlugin({
          api: stub.api,
          demo: options.demo ?? true,
          now: () => TEST_NOW,
          random: () => 0,
        }),
        router,
      ],
    },
    attachTo: document.body,
  });
  await flushPromises();
  return { ...stub, app, router };
}

export function contextOf(stub: Stub, now: () => Date = () => TEST_NOW): LauncherContext {
  return { api: stub.api, demo: false, now, random: () => 0 };
}

export function testCard(patch: Partial<ServerCard> = {}): ServerCard {
  const base = serverCard(SERVER_IDS.wasteland, TEST_NOW.getTime());
  if (base === undefined) {
    throw new Error('card missing');
  }
  return { ...base, ...patch };
}

export function withCard(stub: Stub, value: ServerCard): void {
  stub.api.site.server = vi.fn(() =>
    Promise.resolve({ ok: true as const, value, stale: false, fetchedAt: TEST_NOW.toISOString() }),
  );
}
