import { app, net } from 'electron';
import { join } from 'node:path';
import { openHttps } from '../external';
import type { PlayerResolver } from '../launch/accounts';
import { electronCipher } from '../secret-cipher';
import { msClientId } from './config';
import { registerMicrosoftIpc } from './ipc';
import { MicrosoftManager } from './manager';
import { httpsOnly } from './oauth';
import { microsoftPlayerResolver } from './player';
import { startRedirectListener } from './redirect';
import { MicrosoftStore } from './store';

const ACCOUNTS_FILE = 'microsoft.json';

declare const __MS_CLIENT_ID__: string | undefined;

function builtClientId(): string | undefined {
  return typeof __MS_CLIENT_ID__ === 'string' ? __MS_CLIENT_ID__ : undefined;
}

export interface MicrosoftRuntime {
  resolvePlayer: PlayerResolver;
  has: (id: string) => Promise<boolean>;
}

export function startMicrosoft(
  devServerUrl: string | undefined,
  onRemoved: (id: string) => void,
): MicrosoftRuntime {
  const manager = new MicrosoftManager({
    clientId: msClientId(app.isPackaged, process.env, builtClientId()),
    store: new MicrosoftStore(join(app.getPath('userData'), ACCOUNTS_FILE), electronCipher()),
    fetch: httpsOnly((url, init): Promise<Response> => net.fetch(url, init)),
    openBrowser: openHttps,
    listen: startRedirectListener,
    now: Date.now,
    log: (message): void => {
      console.warn(message);
    },
  });
  manager.onEvent((event) => {
    if (event.change === 'removed' && event.accountId !== null) {
      onRemoved(event.accountId);
    }
  });
  registerMicrosoftIpc(manager, devServerUrl);
  return { resolvePlayer: microsoftPlayerResolver(manager), has: (id) => manager.has(id) };
}
