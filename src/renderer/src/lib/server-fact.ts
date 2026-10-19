import type { ServerRow } from '@shared/catalog';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import {
  catalogServerRuntime,
  installedRuntimeOf,
  sameInstalledRuntime,
  type InstalledRuntime,
} from '@shared/instance';
import { capitalize, moscowDate, moscowTime } from './time';

export interface PendingUpdate {
  from: InstalledRuntime;
  to: InstalledRuntime;
}

function sinceText(at: string, now: Date): string {
  return moscowDate(at) === moscowDate(now) ? moscowTime(at) : moscowDate(at);
}

export function catalogRuntime(server: Pick<ServerRow, 'launch'>): InstalledRuntime | null {
  return server.launch.kind === 'direct'
    ? installedRuntimeOf(catalogServerRuntime(server.launch.minecraft))
    : null;
}

export function pendingUpdate(
  server: Pick<ServerRow, 'launch'>,
  installed: InstalledRuntime | null,
): PendingUpdate | null {
  const current = catalogRuntime(server);
  if (installed === null || current === null || sameInstalledRuntime(installed, current)) {
    return null;
  }
  return { from: installed, to: current };
}

export function runtimeLabel(runtime: InstalledRuntime): string {
  const { kind, version } = runtime.loader;
  if (kind === 'vanilla') {
    return runtime.minecraft;
  }
  const loader = version === null ? ru.loaders[kind] : `${ru.loaders[kind]} ${version}`;
  return `${runtime.minecraft}, ${loader}`;
}

export function updateText(update: PendingUpdate): string {
  return fill(ru.install.updateFrom, {
    old: runtimeLabel(update.from),
    new: runtimeLabel(update.to),
  });
}

export function serverFact(
  server: ServerRow,
  now: Date,
  installed: InstalledRuntime | null = null,
): string | null {
  const downSince = server.down_since ?? null;
  if (downSince !== null && !Number.isNaN(Date.parse(downSince))) {
    return fill(ru.home.factDown, { since: sinceText(downSince, now) });
  }
  if (server.status === 'offline') {
    return ru.home.factDownUnknown;
  }
  if (server.wipe_label !== null) {
    return capitalize(server.wipe_label);
  }
  return pendingUpdate(server, installed) === null ? null : ru.home.factUpdate;
}
