import { PLAY_CHECK_TIMEOUT_MS, type PlayAuth, type PlayCheckQuery } from '@shared/account';
import type { LaunchError, LaunchRequest } from '@shared/launch';
import type { CheckedPlay } from '../account/nick';
import { withDeadline } from '../deadline';
import type { GamePlayer } from './accounts';

export type PlayChecker = (query: PlayCheckQuery) => Promise<CheckedPlay>;

export type Admission =
  { go: true; nick: string; code: string | null } | { go: false; error: LaunchError };

export interface PlayGate {
  verdict: Promise<Admission>;
  refusal: () => LaunchError | null;
}

export function playCheckQuery(request: LaunchRequest, player: GamePlayer): PlayCheckQuery {
  return {
    serverId: request.target.serverId,
    nick: player.nick,
    auth: request.account.kind === 'nick' ? 'nick' : 'microsoft',
  };
}

// A licence plays under its own name whatever the site says about nicknames, and has no code:
// a licensed server knows the player from Mojang.
export function admit(checked: CheckedPlay, nick: string, auth: PlayAuth): Admission {
  const { check } = checked;
  if (check.kind === 'banned') {
    return { go: false, error: { code: 'banned', ...check.ban } };
  }
  if (auth === 'nick' && check.kind === 'nick_taken') {
    return { go: false, error: { code: 'nick-taken' } };
  }
  return {
    go: true,
    nick,
    code: auth === 'nick' && check.kind !== 'nick_mismatch' ? checked.code : null,
  };
}

export function openPlayGate(
  checker: PlayChecker | undefined,
  query: PlayCheckQuery,
  onRefused: () => void,
  timeoutMs: number = PLAY_CHECK_TIMEOUT_MS,
): PlayGate {
  let refusal: LaunchError | null = null;
  const unchecked: CheckedPlay = { check: { kind: 'unchecked' }, code: null };
  // The game never waits for the site longer than this, however the checker is built.
  const asked: Promise<CheckedPlay> =
    checker === undefined
      ? Promise.resolve(unchecked)
      : withDeadline(
          Promise.resolve().then(() => checker(query)),
          timeoutMs,
          unchecked,
        );
  const verdict = asked.then((check) => {
    const admission = admit(check, query.nick, query.auth);
    if (!admission.go) {
      refusal = admission.error;
      onRefused();
    }
    return admission;
  });
  return { verdict, refusal: () => refusal };
}
