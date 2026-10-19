import type { ServerRow } from '@shared/catalog';
import { pickTopSlot } from './top-slot-pick';

export const HOME_CARDS = 3;
export const POPULAR_COUNT = 6;

export interface HomeInput {
  servers: readonly ServerRow[];
  popular: readonly ServerRow[];
  topSlots: readonly ServerRow[];
  recent: ServerRow | undefined;
  waitRecent: boolean;
  favorites: readonly ServerRow[];
  topSlotRoll: number;
}

export interface HomePick {
  recent: ServerRow | undefined;
  top: ServerRow | undefined;
  topSlot: ServerRow | undefined;
  favorites: ServerRow[];
  popular: ServerRow[];
}

export function byOnline(servers: readonly ServerRow[]): ServerRow[] {
  return servers.toSorted((a, b) => b.online - a.online);
}

export function topServer(ranked: readonly ServerRow[]): ServerRow | undefined {
  return ranked.find((server) => server.launch.kind !== 'none') ?? ranked[0];
}

export function pickHome(input: HomeInput): HomePick {
  const ranked = byOnline(input.servers);
  const top = input.recent === undefined && !input.waitRecent ? topServer(ranked) : undefined;
  const shown = new Set<number>();
  const hero = input.recent ?? top;
  if (hero !== undefined) {
    shown.add(hero.id);
  }
  const fresh = (server: ServerRow): boolean => !shown.has(server.id);
  const take = (servers: readonly ServerRow[]): ServerRow[] => {
    const picked = servers.filter(fresh).slice(0, HOME_CARDS);
    for (const server of picked) {
      shown.add(server.id);
    }
    return picked;
  };
  const topSlot = pickTopSlot(input.topSlots.filter(fresh), input.topSlotRoll);
  if (topSlot !== undefined) {
    shown.add(topSlot.id);
  }
  const favorites = take(input.favorites);
  const popular = favorites.length > 0 ? [] : take(input.popular);
  return { recent: input.recent, top, topSlot, favorites, popular };
}
