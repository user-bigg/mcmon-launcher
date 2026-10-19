import type { ServerRow } from '@shared/catalog';

export function pickTopSlot(candidates: readonly ServerRow[], roll: number): ServerRow | undefined {
  const ranked = candidates.toSorted((a, b) => a.online - b.online);
  const count = ranked.length;
  const total = (count * (count + 1)) / 2;
  let cursor = Math.min(Math.max(roll, 0), 0.999_999) * total;
  for (const [index, server] of ranked.entries()) {
    cursor -= count - index;
    if (cursor < 0) {
      return server;
    }
  }
  return ranked.at(-1);
}
