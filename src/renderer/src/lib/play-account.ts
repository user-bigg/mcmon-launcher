import type { PinnedNick } from '@shared/account';
import type { LaunchAccount } from '@shared/launch';

export type PlayAccess = 'nick' | 'license';

export type PlayAccount = { ok: true; account: LaunchAccount } | { ok: false; missing: PlayAccess };

export interface PlayIdentities {
  nick: string | null;
  licenseId: string | null;
}

// A signed-in player has one nickname, the one pinned to the account; the nickname typed
// without an account stays on disk for the day they sign out.
export function gameNick(local: string | null, pinned: PinnedNick | null): string | null {
  return pinned === null ? local : pinned.name;
}

export function pickPlayAccount(
  access: PlayAccess,
  { nick, licenseId }: PlayIdentities,
): PlayAccount {
  if (access === 'license') {
    return licenseId === null
      ? { ok: false, missing: 'license' }
      : { ok: true, account: { kind: 'account', id: licenseId } };
  }
  return nick === null
    ? { ok: false, missing: 'nick' }
    : { ok: true, account: { kind: 'nick', nick } };
}
