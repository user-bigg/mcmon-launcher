import type { RecentPlay } from '@shared/player';
import { recentPlay, voteAvailableIds } from '../mock/player';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { VotesStore } from './useVotes';

export interface FeedStore {
  recent: RecentPlay | null;
  voteAvailable: (serverId: number) => boolean;
}

export function createFeed(
  context: LauncherContext,
  votes: VotesStore,
  isFavorite: (serverId: number) => boolean,
): FeedStore {
  if (!context.demo) {
    return {
      recent: null,
      voteAvailable: (serverId) => votes.available(serverId, isFavorite(serverId)),
    };
  }
  return {
    recent: recentPlay,
    voteAvailable: (serverId) => voteAvailableIds.includes(serverId),
  };
}

export function useFeed(): FeedStore {
  return useStores().feed;
}
