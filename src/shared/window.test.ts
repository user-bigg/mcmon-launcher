import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitWindowSize, WINDOW_BACKGROUND, WINDOW_SIZE } from './window';

describe('window', () => {
  it('the window background equals --mc-bg from the design tokens', () => {
    const tokens = readFileSync(
      resolve(import.meta.dirname, '../../design/shared/tokens.css'),
      'utf8',
    );
    const match = /--mc-bg:\s*(#[0-9a-f]{6})/i.exec(tokens);
    expect(match?.[1]).toBe(WINDOW_BACKGROUND);
  });
});

describe('window size based on the work area', () => {
  it('on a large screen the window keeps its design size', () => {
    expect(fitWindowSize({ width: 1920, height: 1040 })).toEqual(WINDOW_SIZE);
  });

  it('1080p at 150% scale — no taller than the work area', () => {
    expect(fitWindowSize({ width: 1280, height: 680 })).toEqual({
      width: 1100,
      height: 680,
      minWidth: 960,
      minHeight: 600,
    });
  });

  it('a small screen — the minimum is no larger than the work area', () => {
    expect(fitWindowSize({ width: 900, height: 560 })).toEqual({
      width: 900,
      height: 560,
      minWidth: 900,
      minHeight: 560,
    });
  });
});
