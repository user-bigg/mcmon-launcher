import { describe, expect, it, vi, type Mock } from 'vitest';
import type { AccountState } from '@shared/account';
import { IpcChannels } from '@shared/ipc';
import type { AccountControl } from './ipc';

const handle = vi.fn();
const on = vi.fn();
vi.mock('electron', () => ({ ipcMain: { handle, on }, BrowserWindow: {} }));

const { accountHandlers, registerAccountIpc } = await import('./ipc');

const STATE: AccountState = {
  seq: 1,
  encryptionAvailable: true,
  user: null,
  connect: null,
  error: null,
};

function manager(): Required<AccountControl> & Record<keyof AccountControl, Mock> {
  return {
    state: vi.fn(() => Promise.resolve(STATE)),
    connect: vi.fn(() => Promise.resolve({ ok: true as const, value: STATE })),
    reopen: vi.fn(() => Promise.resolve({ ok: true as const, value: STATE })),
    submitCode: vi.fn(() => Promise.resolve({ ok: true as const, value: STATE })),
    cancel: vi.fn(() => Promise.resolve(STATE)),
    logout: vi.fn(() => Promise.resolve({ ok: true as const, value: STATE })),
    refresh: vi.fn(() => Promise.resolve({ ok: true as const, value: STATE })),
    setNick: vi.fn(() => Promise.resolve({ ok: true as const, value: STATE })),
    playCheck: vi.fn(() => Promise.resolve({ kind: 'ok' as const })),
    wear: vi.fn(() => Promise.resolve({ ok: true as const, value: STATE })),
    resetLook: vi.fn(() => Promise.resolve({ ok: true as const, value: STATE })),
    onEvent: vi.fn(() => (): void => undefined),
  };
}

describe('account IPC', () => {
  it('rejects a non-string or too-long code before it reaches the service', async () => {
    const control = manager();
    const handlers = accountHandlers(control);
    expect(await handlers.submitCode(42)).toEqual({
      ok: false,
      error: { code: 'invalid_code_format' },
    });
    expect(await handlers.submitCode('A'.repeat(100))).toMatchObject({ ok: false });
    expect(control.submitCode).not.toHaveBeenCalled();
    await handlers.submitCode('abcd-ef23');
    expect(control.submitCode).toHaveBeenCalledWith('abcd-ef23');
  });

  it('a malformed skin or cape change never reaches the site', async () => {
    const control = manager();
    const handlers = accountHandlers(control);
    const failed = { ok: false, error: { code: 'failed' } };
    expect(await handlers.wear({})).toEqual(failed);
    expect(await handlers.wear({ skin: 'https://example.com/a.png' })).toEqual(failed);
    expect(await handlers.wear({ skin: 'plaid-shirt', cape: 1 })).toEqual(failed);
    expect(control.wear).not.toHaveBeenCalled();
    await handlers.wear({ skin: 'plaid-shirt', cape: null, file: 'x' });
    expect(control.wear).toHaveBeenCalledWith({ skin: 'plaid-shirt', cape: null });
    await handlers.resetLook();
    expect(control.resetLook).toHaveBeenCalledTimes(1);
  });

  it('a malformed nickname or play check never reaches the site', async () => {
    const control = manager();
    const handlers = accountHandlers(control);
    expect(await handlers.setNick('no spaces')).toEqual({
      ok: false,
      error: { code: 'invalid_nick' },
    });
    expect(await handlers.playCheck({ serverId: 'x', nick: 'Steve', auth: 'nick' })).toEqual({
      kind: 'unchecked',
    });
    expect(await handlers.playCheck({ serverId: null, nick: 'Steve', auth: 'unknown' })).toEqual({
      kind: 'unchecked',
    });
    expect(control.setNick).not.toHaveBeenCalled();
    expect(control.playCheck).not.toHaveBeenCalled();
    await handlers.playCheck({ serverId: 5, nick: 'Steve', auth: 'microsoft', extra: 1 });
    expect(control.playCheck).toHaveBeenCalledWith({
      serverId: null,
      nick: 'Steve',
      auth: 'microsoft',
    });
  });

  it('the window checks only the nickname: a server id never reaches the site from it', async () => {
    const control = manager();
    await accountHandlers(control).playCheck({ serverId: 68, nick: 'Steve', auth: 'nick' });
    expect(control.playCheck).toHaveBeenCalledWith({ serverId: null, nick: 'Steve', auth: 'nick' });
  });

  it('registers the table channels, forbids a foreign sender, delivers events by subscription', async () => {
    const control = manager();
    registerAccountIpc(control, undefined);
    const channels = handle.mock.calls.map((call) => call[0] as string);
    expect(channels.sort()).toEqual(Object.values(IpcChannels.account.invoke).sort());
    expect(on).toHaveBeenCalledWith(IpcChannels.account.events.subscribe, expect.any(Function));
    expect(control.onEvent).toHaveBeenCalledTimes(1);
    const connect = handle.mock.calls.find(
      (call) => call[0] === IpcChannels.account.invoke.connect,
    )?.[1] as (event: unknown) => Promise<unknown>;
    const foreign = { senderFrame: { url: 'https://evil.example/' }, sender: { mainFrame: null } };
    expect(await connect(foreign)).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(control.connect).not.toHaveBeenCalled();
  });
});
