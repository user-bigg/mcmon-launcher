import { describe, expect, it, vi } from 'vitest';
import type { InstanceService } from '@shared/instance';
import { IpcChannels } from '@shared/ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const InstanceChannel = IpcChannels.instances.invoke;
const handlers = new Map<string, Handler>();

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {
    handle: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler);
    },
  },
}));

const { registerInstanceIpc } = await import('./instance-ipc');

const ok = { ok: true, value: null } as const;
const service: InstanceService = {
  list: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
  sharedFiles: vi.fn(() => Promise.resolve({ ok: true as const, value: { bytes: 0 } })),
  remove: vi.fn(() => Promise.resolve(ok)),
  launchOptions: vi.fn(() => Promise.resolve({ ok: true as const, value: { withoutMods: false } })),
  setWithoutMods: vi.fn(() => Promise.resolve({ ok: true as const, value: { withoutMods: true } })),
};

registerInstanceIpc(service, undefined);

function sender(url: string): unknown {
  const mainFrame = { url };
  return { senderFrame: mainFrame, sender: { mainFrame } };
}

const trusted = sender('app://launcher/index.html');

describe('registerInstanceIpc', () => {
  it('a foreign sender never reaches the service', async () => {
    const result = await handlers.get(InstanceChannel.remove)?.(sender('https://evil'), 'a');
    expect(result).toEqual({ ok: false, error: { code: 'invalid-request', field: 'sender' } });
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('only a server folder reaches removal: a path or a foreign folder is rejected', async () => {
    for (const folderId of ['/Users/x', '../server-1', 'profile-pack', 'server-0', 1]) {
      expect(await handlers.get(InstanceChannel.remove)?.(trusted, folderId)).toEqual({
        ok: false,
        error: { code: 'invalid-request', field: 'folderId' },
      });
    }
    expect(service.remove).not.toHaveBeenCalled();
    await handlers.get(InstanceChannel.remove)?.(trusted, 'server-12');
    expect(service.remove).toHaveBeenCalledWith('server-12');
  });
});
