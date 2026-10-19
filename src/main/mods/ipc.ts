import { IpcChannels } from '@shared/ipc';
import type { ModsService } from '@shared/mods';
import { handleInvokes, UNTRUSTED_SENDER, type InvokeHandlers } from '../ipc';

export function registerModsIpc(
  handlers: InvokeHandlers<ModsService>,
  devServerUrl: string | undefined,
): void {
  handleInvokes<ModsService>(IpcChannels.mods.invoke, handlers, {
    devServerUrl,
    untrusted: UNTRUSTED_SENDER,
    onError: () => ({ ok: false, error: { code: 'failed' } }),
  });
}
