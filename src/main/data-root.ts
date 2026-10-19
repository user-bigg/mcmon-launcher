import { app } from 'electron';
import path from 'node:path';

export const GAME_DIR_ENV = 'MCMONITOR_GAME_DIR';

const LOCAL_DATA_FOLDER = 'MC Monitor';

// Electron's app.getPath has no 'localAppData'; electron-updater reads LOCALAPPDATA the same way.
function windowsLocalAppData(): string {
  const fromEnv = process.env.LOCALAPPDATA;
  return fromEnv !== undefined && path.win32.isAbsolute(fromEnv)
    ? fromEnv
    : path.win32.join(app.getPath('home'), 'AppData', 'Local');
}

export function localDataRoot(): string {
  return process.platform === 'win32'
    ? path.win32.join(windowsLocalAppData(), LOCAL_DATA_FOLDER)
    : app.getPath('userData');
}

function devGameRoot(): string | undefined {
  const override = app.isPackaged ? undefined : process.env[GAME_DIR_ENV];
  return override !== undefined && override.length > 0 ? override : undefined;
}

export function gameRoot(): string {
  return devGameRoot() ?? path.join(localDataRoot(), 'game');
}
