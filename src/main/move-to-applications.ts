import { execFileSync } from 'node:child_process';
import { posix as path } from 'node:path';
import { app, dialog, shell } from 'electron';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { compareUpdateVersions } from '@shared/update';
import type { LauncherSettingsStore } from './settings';

export interface MoveOffer {
  packaged: boolean;
  platform: NodeJS.Platform;
  cannotUpdateHere: boolean;
  declined: boolean;
  startedByLink: boolean;
}

export type MoveResult = 'stay' | 'moved' | 'opened-installed';

export function shouldOfferMove(offer: MoveOffer): boolean {
  return (
    offer.packaged &&
    offer.platform === 'darwin' &&
    offer.cannotUpdateHere &&
    !offer.declined &&
    !offer.startedByLink
  );
}

function installedVersion(bundle: string): string | null {
  try {
    return execFileSync(
      '/usr/bin/plutil',
      [
        '-extract',
        'CFBundleShortVersionString',
        'raw',
        '-o',
        '-',
        path.join(bundle, 'Contents', 'Info.plist'),
      ],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
  } catch {
    return null;
  }
}

// A copy already in Applications is replaced only when it is older: an old disk image or a copy
// left in Downloads must not take the place of a launcher that has updated itself since.
export function replacesInstalled(installed: string | null, current: string): boolean {
  return installed === null || compareUpdateVersions(installed, current) < 0;
}

async function openInstalled(installed: string, version: string): Promise<MoveResult> {
  await dialog.showMessageBox({
    type: 'info',
    title: ru.app.title,
    message: ru.moveToApplications.installedTitle,
    detail: fill(ru.moveToApplications.installedText, { version }),
    buttons: [ru.moveToApplications.open],
    defaultId: 0,
    noLink: true,
  });
  await shell.openPath(installed);
  return 'opened-installed';
}

// A launcher started from the disk image or from Downloads cannot replace itself on update;
// Electron moves the bundle, handles App Translocation and relaunches it from Applications.
export async function offerMoveToApplications(
  settings: LauncherSettingsStore,
  bundle: string,
  log: (message: string) => void,
): Promise<MoveResult> {
  const installed = path.join('/Applications', path.basename(bundle));
  const installedNow = installedVersion(installed);
  if (installedNow !== null && !replacesInstalled(installedNow, app.getVersion())) {
    return openInstalled(installed, installedNow);
  }
  const answer = await dialog.showMessageBox({
    type: 'question',
    title: ru.app.title,
    message: ru.moveToApplications.title,
    detail: ru.moveToApplications.text,
    buttons: [ru.moveToApplications.move, ru.moveToApplications.later],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: ru.moveToApplications.dontAsk,
    noLink: true,
  });
  if (answer.response !== 0) {
    if (answer.checkboxChecked) {
      await settings.markHint('moveDeclined').catch(() => undefined);
    }
    return 'stay';
  }
  const conflict = { keptInstalled: false };
  try {
    const moved = app.moveToApplicationsFolder({
      conflictHandler: (kind) => {
        if (kind !== 'exists') {
          return false;
        }
        conflict.keptInstalled = !replacesInstalled(installedVersion(installed), app.getVersion());
        return !conflict.keptInstalled;
      },
    });
    if (moved) {
      return 'moved';
    }
  } catch (error) {
    log(`move to Applications failed ${error instanceof Error ? error.message : String(error)}`);
    return 'stay';
  }
  if (conflict.keptInstalled) {
    await shell.openPath(installed);
    return 'opened-installed';
  }
  log('move to Applications was not done');
  return 'stay';
}
