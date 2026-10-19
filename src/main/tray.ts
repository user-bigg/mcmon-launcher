import {
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron';
import { readFileSync } from 'node:fs';
import { hostSystemOf } from '@shared/host-system';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { APP_ICON_PATH, TRAY_TEMPLATE_PATHS, WINDOWS_ICON_PATH } from './app-icon';
import type { LifecycleTray, TrayActions, TrayGame } from './lifecycle';

const LINUX_ICON_SIZE = 22;

export interface TrayMenuState {
  game: TrayGame | null;
  autostart: boolean;
  platform: NodeJS.Platform;
}

export interface TrayMenuActions extends TrayActions {
  setAutostart: (enabled: boolean) => void;
}

export interface AppTray extends LifecycleTray {
  refresh: () => void;
}

export interface AppTrayDeps {
  actions: TrayActions;
  autostart: () => boolean;
  setAutostart: (enabled: boolean) => void;
}

function gameLabel(game: TrayGame): string {
  if (game.name === null) {
    return game.starting ? ru.tray.startingUnnamed : ru.tray.playingUnnamed;
  }
  return fill(game.starting ? ru.tray.starting : ru.tray.playing, { name: game.name });
}

function gameItems(game: TrayGame, actions: TrayMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: gameLabel(game), enabled: false },
    { label: ru.tray.stopGame, click: actions.stopGame },
  ];
}

export function trayMenu(
  state: TrayMenuState,
  actions: TrayMenuActions,
): MenuItemConstructorOptions[] {
  return [
    { label: ru.tray.open, click: actions.show },
    ...(state.game === null ? [] : gameItems(state.game, actions)),
    { type: 'separator' },
    {
      label: ru.tray.autostart[hostSystemOf(state.platform)],
      type: 'checkbox',
      checked: state.autostart,
      // The system flips the mark before the click arrives, so the item itself says what the
      // player chose; a state captured when the menu was built could be stale.
      click: (item): void => {
        actions.setAutostart(item.checked);
      },
    },
    { type: 'separator' },
    { label: ru.tray.quit, click: actions.quit },
  ];
}

export function trayTooltip(game: TrayGame | null): string {
  if (game === null) {
    return ru.tray.tooltip;
  }
  return game.starting ? ru.tray.tooltipStarting : ru.tray.tooltipPlaying;
}

function templateIcon(): NativeImage {
  const image = nativeImage.createEmpty();
  image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(TRAY_TEMPLATE_PATHS.x1) });
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(TRAY_TEMPLATE_PATHS.x2) });
  image.setTemplateImage(true);
  return image;
}

// Windows picks the exact 16 or 32 frame of the pixel mark from the .ico; the macOS menu bar
// takes a one-colour template that the system paints for the light and the dark bar.
function trayIcon(platform: NodeJS.Platform): NativeImage {
  if (platform === 'darwin') {
    return templateIcon();
  }
  if (platform === 'win32') {
    return nativeImage.createFromPath(WINDOWS_ICON_PATH);
  }
  return nativeImage
    .createFromPath(APP_ICON_PATH)
    .resize({ width: LINUX_ICON_SIZE, height: LINUX_ICON_SIZE });
}

export function createAppTray(deps: AppTrayDeps): AppTray {
  const tray = new Tray(trayIcon(process.platform));
  let game: TrayGame | null = null;
  const actions: TrayMenuActions = { ...deps.actions, setAutostart: deps.setAutostart };
  const refresh = (): void => {
    if (tray.isDestroyed()) {
      return;
    }
    const state = { game, autostart: deps.autostart(), platform: process.platform };
    tray.setToolTip(trayTooltip(game));
    tray.setContextMenu(Menu.buildFromTemplate(trayMenu(state, actions)));
  };
  // The macOS menu bar opens the menu on a click by itself.
  if (process.platform !== 'darwin') {
    tray.on('click', deps.actions.show);
  }
  refresh();
  return {
    refresh,
    update: (next): void => {
      game = next;
      refresh();
    },
    destroy: (): void => {
      tray.destroy();
    },
  };
}
