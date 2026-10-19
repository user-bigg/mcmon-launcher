import icoPath from '../../build/icon.ico?asset';
import dockIconPath from '../../build/icon-mac.png?asset';
import iconPath from '../../build/icon.png?asset';
import trayMacPath from '../../build/tray-mac.png?asset';
import trayMacPath2x from '../../build/tray-mac@2x.png?asset';

export const APP_ICON_PATH = iconPath;
export const WINDOWS_ICON_PATH = icoPath;
// The build renames assets, so the '@2x' pair is not found by name: both sizes are put into one
// image by hand.
export const TRAY_TEMPLATE_PATHS = { x1: trayMacPath, x2: trayMacPath2x } as const;
// The Dock draws an icon as it is: a mark that fills the whole canvas looks oversized next to
// the others, so macOS gets the mark on the system grid, with the margin and the shadow.
export const DOCK_ICON_PATH = dockIconPath;

// Windows takes the window icon from the executable, and in development that is Electron's
// own; macOS has no window icons at all and shows the Dock one. The .ico carries exact frames
// of the pixel mark, which a large PNG scaled down by Windows would smear.
export function windowIcon(platform: NodeJS.Platform): { icon?: string } {
  if (platform === 'darwin') {
    return {};
  }
  return { icon: platform === 'win32' ? icoPath : APP_ICON_PATH };
}

export function needsDockIcon(platform: NodeJS.Platform, packaged: boolean): boolean {
  return platform === 'darwin' && !packaged;
}
