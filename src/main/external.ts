import { shell } from 'electron';
import { IpcChannels, type ShellApi } from '@shared/ipc';
import { isHttpsUrl } from '@shared/links';
import { handleInvokes } from './ipc';

export async function openHttps(url: unknown): Promise<boolean> {
  if (!isHttpsUrl(url)) {
    return false;
  }
  await shell.openExternal(url);
  return true;
}

export function registerExternalIpc(devServerUrl: string | undefined): void {
  handleInvokes<ShellApi>(
    IpcChannels.shell.invoke,
    { openExternal: (url) => openHttps(url) },
    { devServerUrl, untrusted: false },
  );
}
