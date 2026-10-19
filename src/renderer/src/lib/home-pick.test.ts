import { describe, expect, it } from 'vitest';
import type { ServerRow } from '@shared/catalog';
import { topSlots, servers, votesTop } from '../mock/servers';
import { pickHome, topServer, type HomeInput } from './home-pick';

function server(id: number): ServerRow {
  const found = [...servers, ...topSlots.diamond, ...topSlots.gold].find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`mock server ${String(id)} missing`);
  }
  return found;
}

function input(patch: Partial<HomeInput> = {}): HomeInput {
  return {
    servers,
    popular: votesTop,
    topSlots: [...topSlots.diamond, ...topSlots.gold],
    recent: undefined,
    waitRecent: false,
    favorites: [],
    topSlotRoll: 0,
    ...patch,
  };
}

function shownIds(pick: ReturnType<typeof pickHome>): number[] {
  return [
    pick.recent?.id,
    pick.top?.id,
    pick.topSlot?.id,
    ...pick.favorites.map((item) => item.id),
    ...pick.popular.map((item) => item.id),
  ].filter((id) => id !== undefined);
}

describe('home screen picks', () => {
  it('hero — the most populated server that can be joined', () => {
    const none = { ...server(101), launch: { kind: 'none' as const } };
    expect(topServer([none, server(102)])?.id).toBe(102);
    expect(topServer([none])?.id).toBe(101);
    expect(pickHome(input()).top?.id).toBe(101);
  });

  it('popular — by votes, not by online count', () => {
    const pick = pickHome(input());
    expect(pick.popular.map((item) => item.id)).toEqual([107, 104, 102]);
  });

  it('no server is shown twice: hero, top slot, favorites', () => {
    const pick = pickHome(
      input({
        recent: server(102),
        favorites: [server(102), server(202), server(201), server(103), server(104), server(105)],
      }),
    );
    expect(pick.topSlot?.id).toBe(202);
    expect(pick.favorites.map((item) => item.id)).toEqual([201, 103, 104]);
    expect(pick.popular).toEqual([]);
    const ids = shownIds(pick);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("while the last server's card is loading, the top pick is not substituted", () => {
    const pick = pickHome(input({ waitRecent: true }));
    expect(pick.top).toBeUndefined();
    expect(pick.recent).toBeUndefined();
  });
});
