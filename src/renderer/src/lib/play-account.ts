import type { LaunchAccount } from '@shared/launch';

export type PlayAccess = 'nick' | 'license';

export type PlayAccount = { ok: true; account: LaunchAccount } | { ok: false; missing: PlayAccess };

export interface PlayIdentities {
  nick: string | null;
  licenseId: string | null;
  withAccount?: boolean;
  licenseChosen?: boolean;
}

export function pickPlayAccount(
  access: PlayAccess,
  { nick, licenseId, withAccount = false, licenseChosen = false }: PlayIdentities,
): PlayAccount {
  // A chosen licence plays everywhere, as the account list promises.
  if (access === 'license' || (licenseChosen && licenseId !== null)) {
    return licenseId === null
      ? { ok: false, missing: 'license' }
      : { ok: true, account: { kind: 'account', id: licenseId } };
  }
  return nick === null
    ? { ok: false, missing: 'nick' }
    : { ok: true, account: { kind: 'nick', nick, ...(withAccount ? { withAccount } : {}) } };
}
