import { rm } from 'node:fs/promises';
import path from 'node:path';
import { bareHost, type ServerAddress } from '@shared/server-address';
import { withFsRetry } from './fs-retry';
import { writeJsonAtomic } from './json-cache';

export const PLAY_CODE_FORMAT = 1;

export interface PlayCode {
  serverId: number;
  nick: string;
  code: string;
  address: ServerAddress;
}

export function playCodeFile(instance: string): string {
  return path.join(instance, 'mcmonitor', 'play.json');
}

// The MC Monitor client mod reads this file and hands the code only to the server at this very
// address. The format is shared with the client mod.
export function writePlayCode(instance: string, play: PlayCode): Promise<void> {
  return writeJsonAtomic(playCodeFile(instance), {
    v: PLAY_CODE_FORMAT,
    server_id: play.serverId,
    nick: play.nick,
    code: play.code,
    host: bareHost(play.address.host),
    port: play.address.port,
  });
}

// A code left from an earlier launch must not reach the server when this one has none.
export async function clearPlayCode(instance: string): Promise<void> {
  await withFsRetry(() => rm(playCodeFile(instance), { force: true }));
}
