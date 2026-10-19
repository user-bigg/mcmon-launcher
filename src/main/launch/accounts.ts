import type { LaunchAccount } from '@shared/launch';
import type { TelemetryAccount } from '@shared/telemetry';
import { failure } from './errors';

export interface GameAuth {
  uuid: string;
  accessToken: string;
}

export interface GamePlayer {
  nick: string;
  telemetry: TelemetryAccount;
  auth: GameAuth | null;
}

export type PlayerResolver = (account: LaunchAccount) => Promise<GamePlayer>;

export const resolveOfflinePlayer: PlayerResolver = (account) => {
  if (account.kind === 'nick') {
    return Promise.resolve({ nick: account.nick, telemetry: 'nick', auth: null });
  }
  return Promise.reject(failure({ code: 'account-unsupported' }));
};
