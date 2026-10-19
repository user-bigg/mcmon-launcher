export const WINDOW_SIZE = {
  width: 1100,
  height: 700,
  minWidth: 960,
  minHeight: 600,
} as const;

// Value of --mc-bg from design/shared/tokens.css: the main process does not read CSS,
// a test checks that they match.
export const WINDOW_BACKGROUND = '#0a0e13';

export interface WindowBounds {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export function fitWindowSize(workArea: { width: number; height: number }): WindowBounds {
  return {
    width: Math.min(WINDOW_SIZE.width, workArea.width),
    height: Math.min(WINDOW_SIZE.height, workArea.height),
    minWidth: Math.min(WINDOW_SIZE.minWidth, workArea.width),
    minHeight: Math.min(WINDOW_SIZE.minHeight, workArea.height),
  };
}
