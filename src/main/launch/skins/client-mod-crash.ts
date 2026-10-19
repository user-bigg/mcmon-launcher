import { open } from 'node:fs/promises';
import type { CrashCause } from '@shared/crash';

// The mod id and the package come from fabric.mod.json of the client mod
// (github.com/user-bigg/mcmon-plugin, client-fabric). Mixin pastes a handler into the target
// class under a name with the mod id between dollars, so a frame of a handler names the mod
// without our package.
export const CLIENT_MOD_ID = 'mcmonitor';
const OWN_FRAME = /^\s*at\s+\S*(?:\bru\.mcmon\.plugin\.client\.|\$mcmonitor\$)/m;

// Only the mod that failed comes first in these Fabric lines; a mod that merely depends on or
// breaks ours is named after the verb.
const OWN_FABRIC_FAILURE = [
  /^\s*-?\s*Mod '[^'\n]*' \(mcmonitor\) \S+ (?:requires|is incompatible|conflicts|breaks)/m,
  /^\s*(?:Caused by: )?[\w.$]+: Mixin apply for mod mcmonitor failed/m,
];

const IN_WORLD = [/\[CHAT\]/, /logged in with entity id/, /Loaded \d+ advancements/];
const CONNECTING = /Connecting to [^\s,]+, \d+/;
const EVENT = /<log4j:Event\b[^>]*>[\s\S]*?<\/log4j:Event>/g;
const TIMESTAMP = /timestamp="(\d+)"/;
const SERIOUS = /level="(?:ERROR|FATAL)"/;

// A server need not send anything to the chat on join, so time after the connect line counts
// too: no handshake takes a minute.
export const JOIN_WINDOW_MS = 60_000;

const LOG_LIMIT_BYTES = 4 * 1024 * 1024;

export interface ClientModCrashInput {
  crashed: boolean;
  cause: CrashCause;
  logText: string | null;
  crashReport: string | null;
}

function ownLoadFailure(cause: CrashCause): boolean {
  return (
    (cause.code === 'mod-dependency' || cause.code === 'mod-version') &&
    cause.modId === CLIENT_MOD_ID
  );
}

export function blamesClientMod(text: string): boolean {
  return OWN_FRAME.test(text) || OWN_FABRIC_FAILURE.some((pattern) => pattern.test(text));
}

function events(logText: string): string[] {
  return logText.match(EVENT) ?? [];
}

function timeOf(event: string): number | null {
  const stamp = TIMESTAMP.exec(event)?.[1];
  return stamp === undefined ? null : Number(stamp);
}

function seriousPart(logText: string): string {
  const all = events(logText);
  return all.length === 0 ? logText : all.filter((event) => SERIOUS.test(event)).join('\n');
}

function longAfterConnect(logText: string): boolean {
  const all = events(logText);
  const connect = all.findLast((event) => CONNECTING.test(event));
  const connectAt = connect === undefined ? null : timeOf(connect);
  const lastAt = all.length === 0 ? null : timeOf(all[all.length - 1] ?? '');
  return connectAt !== null && lastAt !== null && lastAt - connectAt > JOIN_WINDOW_MS;
}

export function reachedWorld(logText: string): boolean {
  return IN_WORLD.some((pattern) => pattern.test(logText)) || longAfterConnect(logText);
}

export function crashedOnClientMod(input: ClientModCrashInput): boolean {
  if (!input.crashed || input.logText === null || reachedWorld(input.logText)) {
    return false;
  }
  return (
    ownLoadFailure(input.cause) ||
    blamesClientMod(seriousPart(input.logText)) ||
    (input.crashReport !== null && blamesClientMod(input.crashReport))
  );
}

export async function readStartLog(file: string): Promise<string | null> {
  const handle = await open(file, 'r').catch(() => null);
  if (handle === null) {
    return null;
  }
  try {
    const { size } = await handle.stat();
    if (size > LOG_LIMIT_BYTES) {
      return null;
    }
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}
