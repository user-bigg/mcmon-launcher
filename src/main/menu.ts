import { Menu, type MenuItemConstructorOptions } from 'electron';
import { ru } from '@shared/i18n/ru';

export interface AppMenuActions {
  about: () => void;
  settings: () => void;
  site: () => void;
}

type Item = MenuItemConstructorOptions;

const SEPARATOR: Item = { type: 'separator' };

function appMenu(actions: AppMenuActions): Item {
  return {
    label: ru.app.name,
    submenu: [
      { label: ru.menu.about, click: actions.about },
      SEPARATOR,
      { label: ru.menu.settings, accelerator: 'Command+,', click: actions.settings },
      SEPARATOR,
      { role: 'hide', label: ru.menu.hide },
      { role: 'hideOthers', label: ru.menu.hideOthers },
      { role: 'unhide', label: ru.menu.showAll },
      SEPARATOR,
      { role: 'quit', label: ru.menu.quit },
    ],
  };
}

const EDIT_MENU: Item = {
  label: ru.menu.edit,
  submenu: [
    { role: 'undo', label: ru.menu.undo },
    { role: 'redo', label: ru.menu.redo },
    SEPARATOR,
    { role: 'cut', label: ru.menu.cut },
    { role: 'copy', label: ru.menu.copy },
    { role: 'paste', label: ru.menu.paste },
    { role: 'selectAll', label: ru.menu.selectAll },
  ],
};

const VIEW_MENU: Item = {
  label: ru.menu.view,
  submenu: [
    { role: 'reload', label: ru.menu.reload },
    { role: 'forceReload', label: ru.menu.forceReload },
    { role: 'toggleDevTools', label: ru.menu.devTools },
  ],
};

const WINDOW_MENU: Item = {
  role: 'window',
  label: ru.menu.window,
  submenu: [
    { role: 'minimize', label: ru.menu.minimize },
    { role: 'close', label: ru.menu.close },
  ],
};

export function macMenu(development: boolean, actions: AppMenuActions): Item[] {
  return [
    appMenu(actions),
    EDIT_MENU,
    ...(development ? [VIEW_MENU] : []),
    WINDOW_MENU,
    { role: 'help', label: ru.menu.help, submenu: [{ label: ru.menu.site, click: actions.site }] },
  ];
}

export type MenuPlan = 'mac' | 'none' | 'default';

// Without a menu macOS has no Cmd+C, Cmd+V and Cmd+Q at all. A frameless window on Windows and
// Linux shows no menu bar, but Electron's default menu would still answer Ctrl+R and
// Ctrl+Shift+I, so outside development it is removed.
export function menuPlan(platform: NodeJS.Platform, development: boolean): MenuPlan {
  if (platform === 'darwin') {
    return 'mac';
  }
  return development ? 'default' : 'none';
}

export function installApplicationMenu(development: boolean, actions: AppMenuActions): void {
  const plan = menuPlan(process.platform, development);
  if (plan === 'mac') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(macMenu(development, actions)));
  } else if (plan === 'none') {
    Menu.setApplicationMenu(null);
  }
}
