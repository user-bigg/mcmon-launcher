import { resolveOfflinePlayer, type PlayerResolver } from '../launch/accounts';
import { failure } from '../launch/errors';
import { launchErrorOf, microsoftCodeOf } from './errors';
import type { MicrosoftManager } from './manager';

export function microsoftPlayerResolver(
  accounts: Pick<MicrosoftManager, 'gameAuth'>,
): PlayerResolver {
  return async (account) => {
    if (account.kind !== 'account') {
      return resolveOfflinePlayer(account);
    }
    try {
      const auth = await accounts.gameAuth(account.id);
      return {
        nick: auth.nick,
        telemetry: 'microsoft',
        auth: { uuid: auth.uuid, accessToken: auth.accessToken },
      };
    } catch (error) {
      throw failure(launchErrorOf(microsoftCodeOf(error)));
    }
  };
}
