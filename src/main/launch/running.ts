import type { ChildProcess } from 'node:child_process';
import type { GameSession } from '@shared/launch';
import { telemetryMods, type TelemetryMod } from '@shared/mods';
import { telemetrySkins } from '@shared/skin-mod';
import type { LaunchTelemetryEvent } from '@shared/telemetry';
import type { GamePlayer } from './accounts';
import type { GameLogWriter } from './game-log';
import type { GameExit } from './game-process';
import type { Installed } from './install';
import type { ProgressModel } from './progress';

export interface RunningGame {
  child: ChildProcess;
  session: GameSession;
  serverId: number;
  instanceDir: string;
  log: GameLogWriter;
  progress: ProgressModel;
  startedAt: number;
  windowReadyAt: number | null;
  windowFailed: boolean;
  windowSlow: boolean;
  windowDialog: boolean;
  killedByUser: boolean;
  release: () => void;
}

export function safely(action: () => void): void {
  try {
    action();
  } catch {
    return;
  }
}

export function isCrashExit(running: RunningGame, exit: GameExit): boolean {
  return (
    exit.crashReportPath !== null ||
    running.windowFailed ||
    (!running.killedByUser && exit.code !== 0)
  );
}

// With the window open the launcher's part of joining is over: the address went to the game
// in its command line, and whether the server lets the player in is the game's own screen.
export function markWindowReady(running: RunningGame, at: number): void {
  running.windowReadyAt = at;
  running.windowFailed = false;
  running.windowSlow = false;
  running.windowDialog = false;
  running.progress.finish('launch');
  if (running.session.join === null) {
    running.progress.skip('join');
  } else {
    running.progress.start('join');
    running.progress.finish('join');
  }
}

export function settleSteps(running: RunningGame): void {
  const { progress } = running;
  if (running.windowReadyAt === null && progress.status('launch') === 'active') {
    progress.fail('launch');
  }
  progress.skipWaiting();
}

export function startedTelemetry(
  running: RunningGame,
  installed: Installed,
  player: GamePlayer,
  launchId?: string,
): LaunchTelemetryEvent {
  return {
    type: 'launch.started',
    at: running.session.startedAt,
    server_id: running.serverId,
    minecraft: installed.entry.id,
    loader: installed.runtime.loader,
    account: player.telemetry,
    ram_mb: running.session.memoryMb,
    java_major: installed.java.major,
    ...(running.session.join === null ? {} : { nick: running.session.nick }),
    ...(launchId === undefined ? {} : { launch_id: launchId }),
    ...(installed.skins === null ? {} : { skins: telemetrySkins(installed.skins) }),
    ...(installed.clientMod === null ? {} : { client_mod: installed.clientMod }),
    ...modsField(installed),
  };
}

function modsField(installed: Installed): { mods?: TelemetryMod[] } {
  const mods = telemetryMods(installed.mods);
  return mods.length === 0 ? {} : { mods };
}

export function finishedTelemetry(
  running: RunningGame,
  exit: GameExit,
  crashed: boolean,
  now: number,
): LaunchTelemetryEvent {
  return {
    type: 'launch.finished',
    at: new Date(now).toISOString(),
    server_id: running.serverId,
    outcome: crashed ? 'crash' : exit.code === 0 ? 'ok' : 'exit',
    exit_code: exit.code,
    duration_s: Math.round((now - running.startedAt) / 1000),
    time_to_window_s:
      running.windowReadyAt === null
        ? null
        : Math.round((running.windowReadyAt - running.startedAt) / 1000),
  };
}
