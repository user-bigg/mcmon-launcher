import { dialog, Notification, type BrowserWindow, type MessageBoxOptions } from 'electron';
import { hostSystemOf } from '@shared/host-system';
import { ru } from '@shared/i18n/ru';
import type { ConfirmKind } from './lifecycle';

export function confirmDialog(kind: ConfirmKind): MessageBoxOptions {
  const text = ru.confirm[kind];
  return {
    type: 'warning',
    title: ru.app.title,
    message: text.title,
    detail: text.text,
    buttons: [text.action, 'cancel' in text ? text.cancel : ru.confirm.cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

let openPrompts = 0;

// A message box of the launcher disables its window just as the game's own dialog does.
export function promptOpen(): boolean {
  return openPrompts > 0;
}

export async function confirmGameAction(
  kind: ConfirmKind,
  window: BrowserWindow | null,
): Promise<boolean> {
  const options = confirmDialog(kind);
  openPrompts += 1;
  try {
    const parent = window === null || window.isDestroyed() ? null : window;
    const result =
      parent === null
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(parent, options);
    return result.response === 0;
  } finally {
    openPrompts -= 1;
  }
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

export function notifyHiddenToTray(): void {
  notify(ru.tray.hiddenTitle, ru.tray.hiddenText[hostSystemOf(process.platform)]);
}

export function notifyLeftInTray(): void {
  notify(ru.tray.leftTitle[hostSystemOf(process.platform)], ru.tray.leftText);
}
