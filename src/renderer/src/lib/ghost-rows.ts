export const GHOSTS_UNKNOWN = 3;
export const MAX_GHOST_ROWS = 12;

export function rowsFitting(height: number, row: number, gap: number): number | null {
  return height > 0 && row > 0 ? Math.floor((height + gap) / (row + gap)) : null;
}

export function ghostRows(remembered: number | null, fitting: number | null): number {
  const wanted = Math.min(remembered ?? GHOSTS_UNKNOWN, MAX_GHOST_ROWS);
  return Math.max(0, fitting === null ? wanted : Math.min(wanted, fitting));
}
