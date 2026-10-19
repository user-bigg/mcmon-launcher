import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER_DATA = '/Users/player/Library/Application Support/MC Monitor Launcher';
const LOCAL_APP_DATA = 'D:\\Profiles\\player\\AppData\\Local';
const WINDOWS_DATA = `${LOCAL_APP_DATA}\\MC Monitor`;

const app = vi.hoisted(() => ({
  isPackaged: true,
  getPath: vi.fn((name: string): string => {
    if (name === 'userData') {
      return '/Users/player/Library/Application Support/MC Monitor Launcher';
    }
    if (name === 'home') {
      return 'C:\\Users\\player';
    }
    throw new Error(`unexpected path ${name}`);
  }),
}));

vi.mock('electron', () => ({ app }));

const { GAME_DIR_ENV, gameRoot, localDataRoot } = await import('./data-root');

const realPlatform = process.platform;

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('game data folder', () => {
  beforeEach(() => {
    app.isPackaged = true;
    app.getPath.mockClear();
    vi.stubEnv(GAME_DIR_ENV, '');
    vi.stubEnv('LOCALAPPDATA', LOCAL_APP_DATA);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    vi.unstubAllEnvs();
  });

  it('on Windows — in LocalAppData, not in the roaming profile', () => {
    onPlatform('win32');
    expect(localDataRoot()).toBe(WINDOWS_DATA);
    expect(gameRoot()).toBe(path.join(WINDOWS_DATA, 'game'));
    expect(app.getPath).not.toHaveBeenCalled();
  });

  it('on Windows without LOCALAPPDATA or with a relative path — AppData\\Local under the home folder', () => {
    onPlatform('win32');
    for (const value of [undefined, '', 'AppData\\Local']) {
      vi.stubEnv('LOCALAPPDATA', value);
      expect(localDataRoot()).toBe('C:\\Users\\player\\AppData\\Local\\MC Monitor');
    }
    expect(app.getPath).not.toHaveBeenCalledWith('userData');
  });

  it('on macOS and Linux — in userData', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      onPlatform(platform);
      expect(localDataRoot()).toBe(USER_DATA);
      expect(gameRoot()).toBe(path.join(USER_DATA, 'game'));
    }
    expect(app.getPath).not.toHaveBeenCalledWith('home');
  });

  it('MCMONITOR_GAME_DIR takes priority over the platform in development', () => {
    app.isPackaged = false;
    vi.stubEnv(GAME_DIR_ENV, '/srv/dev-game');
    onPlatform('win32');
    expect(gameRoot()).toBe('/srv/dev-game');
  });

  it('a packaged launcher ignores MCMONITOR_GAME_DIR', () => {
    vi.stubEnv(GAME_DIR_ENV, '/srv/dev-game');
    onPlatform('win32');
    expect(gameRoot()).toBe(path.join(WINDOWS_DATA, 'game'));
  });
});
