import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { LauncherBuild, UpdateState } from '@shared/update';
import { moscowDateWithYear, moscowTime } from './time';

function skippedOr(update: UpdateState, version: string, text: string): string {
  return fill(update.skipped.includes(version) ? ru.settings.updateStatus.skipped : text, {
    version,
  });
}

export function updateStatusText(update: UpdateState): string {
  const { status } = update;
  switch (status.kind) {
    case 'disabled':
    case 'idle':
    case 'checking':
      return ru.settings.updateStatus[status.kind];
    case 'none':
      return update.checkedAt === null
        ? ru.settings.updateStatus.none
        : fill(ru.settings.updateStatus.noneAt, { time: moscowTime(update.checkedAt) });
    case 'available':
      return skippedOr(update, status.version, ru.settings.updateStatus.available);
    case 'downloading':
      return fill(ru.settings.updateStatus.downloading, {
        version: status.version,
        percent: status.percent,
      });
    case 'verifying':
      return fill(ru.settings.updateStatus.verifying, { version: status.version });
    case 'ready':
      return skippedOr(update, status.version, ru.settings.updateStatus.ready);
    case 'error':
      if (status.code === 'move' || status.code === 'readonly' || status.code === 'install') {
        return status.version === null
          ? ru.settings.updateErrors[`${status.code}Any`]
          : fill(ru.settings.updateErrors[status.code], { version: status.version });
      }
      if (status.code !== 'signature') {
        return ru.settings.updateErrors[status.code];
      }
      return status.version === null
        ? ru.settings.updateErrors.signatureUnknown
        : fill(ru.settings.updateErrors.signature, { version: status.version });
  }
}

export function buildTitle(build: LauncherBuild): string | null {
  if (build.version === '') {
    return null;
  }
  return build.builtAt === null
    ? fill(ru.settings.updateVersion, { version: build.version })
    : fill(ru.settings.updateBuiltAt, {
        version: build.version,
        date: moscowDateWithYear(build.builtAt),
      });
}

type PlatformKey = keyof typeof ru.settings.platforms;

function isPlatform(os: string): os is PlatformKey {
  return Object.hasOwn(ru.settings.platforms, os);
}

function platformName(os: string): string {
  return isPlatform(os) ? ru.settings.platforms[os] : os;
}

export function buildReport(build: LauncherBuild): string {
  const platform = fill(ru.settings.platformLine, {
    os: platformName(build.os),
    arch: build.arch,
  }).trim();
  if (build.builtAt === null) {
    return fill(ru.settings.versionTextNoBuild, { version: build.version, platform });
  }
  const moment = fill(ru.settings.buildMoment, {
    date: moscowDateWithYear(build.builtAt),
    time: moscowTime(build.builtAt),
  });
  return fill(ru.settings.versionText, { version: build.version, build: moment, platform });
}
