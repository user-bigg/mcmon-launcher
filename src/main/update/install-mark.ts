import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { UPDATE_VIAS, type UpdateReport, type UpdateVia } from '@shared/telemetry';
import { isUpdateVersion } from '@shared/update';

export const INSTALL_MARK_FILE = 'update-install.json';
export const HIDDEN_RELAUNCH_MS = 10 * 60_000;

export interface InstallMark {
  from: string;
  to: string;
  via: UpdateVia;
  at: number;
}

export function parseInstallMark(value: unknown): InstallMark | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { from, to, via, at } = value as Record<string, unknown>;
  const knownVia = UPDATE_VIAS.find((item) => item === via);
  return isUpdateVersion(from) &&
    isUpdateVersion(to) &&
    knownVia !== undefined &&
    typeof at === 'number' &&
    Number.isFinite(at)
    ? { from, to, via: knownVia, at }
    : null;
}

export function writeInstallMark(file: string, mark: InstallMark): void {
  try {
    writeFileSync(file, JSON.stringify(mark));
  } catch {
    // Without the mark the new version only starts with its window and reports nothing.
  }
}

export function removeInstallMark(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // A mark left behind reports a failed install on the next start, which is what happened.
  }
}

export function takeInstallMark(file: string): InstallMark | null {
  try {
    const text = readFileSync(file, 'utf8');
    rmSync(file, { force: true });
    return parseInstallMark(JSON.parse(text));
  } catch {
    return null;
  }
}

// A quiet install from the tray brings the launcher back into the tray; a mark left by an install
// that did not happen must not hide the window of a start by the player.
export function relaunchesHidden(mark: InstallMark | null, current: string, now: number): boolean {
  return (
    mark?.via === 'tray' &&
    mark.to === current &&
    now >= mark.at &&
    now - mark.at < HIDDEN_RELAUNCH_MS
  );
}

// An install the launcher restarted for left the old version in place: trying it again on every
// start would make the launcher vanish each time, so the player gets the download page instead.
export function failedRelaunch(mark: InstallMark | null, current: string): string | null {
  return mark !== null && mark.via !== 'quit' && mark.to !== current ? mark.to : null;
}

export function installOutcome(mark: InstallMark, current: string): UpdateReport {
  return current === mark.to
    ? { stage: 'installed', to: mark.to, from: mark.from, via: mark.via, error_code: null }
    : {
        stage: 'failed',
        to: mark.to,
        from: mark.from,
        via: mark.via,
        error_code: 'not_installed',
      };
}
