import { serverIdOfFolder, type InstanceService } from '@shared/instance';
import { IpcChannels } from '@shared/ipc';
import { handleInvokes, UNTRUSTED_SENDER } from '../ipc';
import { failure } from './errors';
import { launchFailureResult } from './ipc';

function folderIdOf(value: unknown): string {
  if (typeof value !== 'string' || serverIdOfFolder(value) === null) {
    throw failure({ code: 'invalid-request', field: 'folderId' });
  }
  return value;
}

export function registerInstanceIpc(
  service: InstanceService,
  devServerUrl: string | undefined,
): void {
  handleInvokes<InstanceService>(
    IpcChannels.instances.invoke,
    {
      list: () => service.list(),
      sharedFiles: () => service.sharedFiles(),
      remove: (folderId) => service.remove(folderIdOf(folderId)),
      launchOptions: (folderId) => {
        if (typeof folderId !== 'string') {
          throw failure({ code: 'invalid-request', field: 'instance' });
        }
        return service.launchOptions(folderId);
      },
      setWithoutMods: (folderId, off) => {
        if (typeof folderId !== 'string' || typeof off !== 'boolean') {
          throw failure({ code: 'invalid-request', field: 'withoutMods' });
        }
        return service.setWithoutMods(folderId, off);
      },
    },
    { devServerUrl, untrusted: UNTRUSTED_SENDER, onError: launchFailureResult },
  );
}
