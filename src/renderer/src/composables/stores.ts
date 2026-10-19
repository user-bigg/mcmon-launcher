import type { App } from 'vue';
import { serverIdOfFolder } from '@shared/instance';
import type { SiteChange } from '@shared/site';
import { CONTEXT_KEY, STORES_KEY, type LauncherContext } from './context';
import { createAccounts, type AccountsStore } from './useAccounts';
import { createAlerts, type AlertsStore } from './useAlerts';
import { createCatalog, type CatalogStore } from './useCatalog';
import { createCrashes, type CrashStore } from './useCrashes';
import { createDeepLink, type DeepLinkStore } from './useDeepLink';
import { createFavorites, type FavoritesStore } from './useFavorites';
import { createFeed, type FeedStore } from './useFeed';
import { createLaunch, type LaunchStore } from './useLaunch';
import { createLibrary, type LibraryStore } from './useLibrary';
import { createMods, type ModsStore } from './useMods';
import { createOwner, type OwnerStore } from './useOwner';
import { createScenes, type ScenesStore } from './useScenes';
import { createSettings, type SettingsStore } from './useSettings';
import { createSite, type SiteStore } from './useSite';
import { createUpdates, type UpdatesStore } from './useUpdates';
import { createVotes, type VotesStore } from './useVotes';
import { createWardrobe, type WardrobeStore } from './useWardrobe';

export interface Stores {
  catalog: CatalogStore;
  favorites: FavoritesStore;
  accounts: AccountsStore;
  alerts: AlertsStore;
  votes: VotesStore;
  feed: FeedStore;
  library: LibraryStore;
  owner: OwnerStore;
  launch: LaunchStore;
  settings: SettingsStore;
  crashes: CrashStore;
  scenes: ScenesStore;
  deepLink: DeepLinkStore;
  site: SiteStore;
  updates: UpdatesStore;
  wardrobe: WardrobeStore;
  mods: ModsStore;
  stopSite: () => void;
}

export function createStores(context: LauncherContext): Stores {
  const accounts = createAccounts(context);
  const votes = createVotes(context, accounts);
  const catalog = createCatalog(context, () => {
    const asked = votes.session();
    return (card): void => {
      if (card.my_vote !== undefined) {
        votes.remember(card.id, card.my_vote.can_vote_at, asked);
      }
    };
  });
  const scenes = createScenes(context);
  const library = createLibrary(context, catalog);
  const site = createSite(context);
  void catalog.load();
  void library.load();
  void scenes.load();
  void site.load();
  const favorites = createFavorites(context, catalog, accounts);
  const alerts = createAlerts(context, accounts);
  const owner = createOwner(context, catalog, accounts);
  const wardrobe = createWardrobe(context);
  const mods = createMods(context);
  void mods.load();
  const refreshed: Partial<Record<SiteChange['topic'], () => void>> = {
    meta: () => void site.load(),
    'skin-mod': () => void site.load(),
    scenes: () => void scenes.load(),
    'look-presets': () => void wardrobe.load(),
    favorites: () => {
      favorites.refresh();
    },
    alerts: () => void alerts.open(),
    'owned-servers': () => void owner.load(),
    'vote-pauses': () => void votes.load(),
  };
  const stopSite = context.demo
    ? (): void => undefined
    : context.api.site.onChanged((change) => {
        catalog.siteChanged(change);
        refreshed[change.topic]?.();
      });
  return {
    stopSite,
    catalog,
    favorites,
    accounts,
    alerts,
    votes,
    feed: createFeed(context, votes, (serverId) => favorites.has(serverId)),
    owner,
    library,
    launch: createLaunch(context, (instanceId) => {
      const entry = library.find(instanceId);
      if (entry !== undefined) {
        return { instanceId, name: entry.name, serverId: entry.serverId };
      }
      const serverId = serverIdOfFolder(instanceId);
      const server = serverId === null ? undefined : catalog.server(serverId);
      return server === undefined ? null : { instanceId, name: server.name, serverId: server.id };
    }),
    settings: createSettings(context),
    crashes: createCrashes(context),
    scenes,
    deepLink: createDeepLink(context),
    site,
    updates: createUpdates(context),
    wardrobe,
    mods,
  };
}

export function launcherPlugin(context: LauncherContext): { install: (app: App) => void } {
  return {
    install: (app): void => {
      const stores = createStores(context);
      app.provide(CONTEXT_KEY, context);
      app.provide(STORES_KEY, stores);
      app.onUnmount(() => {
        stores.launch.dispose();
        stores.crashes.dispose();
        stores.deepLink.dispose();
        stores.settings.dispose();
        stores.library.dispose();
        stores.owner.dispose();
        stores.favorites.dispose();
        stores.alerts.dispose();
        stores.votes.dispose();
        stores.accounts.dispose();
        stores.updates.dispose();
        stores.scenes.dispose();
        stores.stopSite();
      });
    },
  };
}
