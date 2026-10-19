import { IpcChannels } from '@shared/ipc';
import { isMicrosoftAccountId, type MicrosoftService } from '@shared/microsoft';
import { handleInvokes, listenSubscriptions, type InvokeHandlers } from '../ipc';
import { microsoftRejected } from './errors';
import type { MicrosoftManager } from './manager';

const UNTRUSTED = microsoftRejected('forbidden');
const FAILED = microsoftRejected('failed');
const INVALID = microsoftRejected('invalid_request');

export type MicrosoftControl = Pick<
  MicrosoftManager,
  'state' | 'login' | 'reopen' | 'cancel' | 'remove' | 'onEvent'
>;

export function microsoftHandlers(manager: MicrosoftControl): InvokeHandlers<MicrosoftService> {
  return {
    state: () => manager.state(),
    login: () => manager.login(),
    reopen: () => manager.reopen(),
    cancel: () => manager.cancel(),
    remove: (id) => (isMicrosoftAccountId(id) ? manager.remove(id) : INVALID),
  };
}

export function registerMicrosoftIpc(
  manager: MicrosoftControl,
  devServerUrl: string | undefined,
): void {
  handleInvokes<MicrosoftService>(IpcChannels.microsoft.invoke, microsoftHandlers(manager), {
    devServerUrl,
    untrusted: UNTRUSTED,
    onError: () => FAILED,
  });
  const { events } = IpcChannels.microsoft;
  const subscribers = listenSubscriptions(events, devServerUrl);
  manager.onEvent((event) => {
    subscribers.send(events.event, event);
  });
}
