import { describe, expect, it, vi } from 'vitest';

vi.mock('../../build/icon.png?asset', () => ({ default: '/app/icon.png' }));
vi.mock('../../build/icon.ico?asset', () => ({ default: '/app/icon.ico' }));
vi.mock('../../build/icon-mac.png?asset', () => ({ default: '/app/icon-mac.png' }));

const { needsDockIcon, windowIcon } = await import('./app-icon');

describe('application icon', () => {
  it('is given to the window on Windows and Linux, with the exact frames of the .ico on Windows', () => {
    expect(windowIcon('win32')).toEqual({ icon: '/app/icon.ico' });
    expect(windowIcon('linux')).toEqual({ icon: '/app/icon.png' });
    expect(windowIcon('darwin')).toEqual({});
  });

  it('replaces the Electron icon in the Dock only in a development run on macOS', () => {
    expect(needsDockIcon('darwin', false)).toBe(true);
    expect(needsDockIcon('darwin', true)).toBe(false);
    expect(needsDockIcon('win32', false)).toBe(false);
  });
});
