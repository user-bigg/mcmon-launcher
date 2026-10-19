// Fits "999K" in the score column and its "?" header.
export const SCORE_COLUMN_PX = 64;
// Fits the widest compact action: the "join" button with its icon is about 107 px.
export const ACTION_COLUMN_PX = 116;

// Fits "1.18.2–1.21.11" in the version pill; longer ranges are shortened by compactVersionLabel.
export const VERSION_COLUMN_PX = 120;

// Fits "12 763" with the weekly trend next to it, e.g. "12 763 ▲11%".
export const ONLINE_COLUMN_PX = 112;

export const ROW_COLUMNS = [
  '22px',
  '44px',
  'minmax(0, 1fr)',
  `${String(VERSION_COLUMN_PX)}px`,
  `${String(ONLINE_COLUMN_PX)}px`,
  `${String(SCORE_COLUMN_PX)}px`,
  `${String(ACTION_COLUMN_PX)}px`,
].join(' ');
