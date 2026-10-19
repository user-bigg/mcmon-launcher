import { describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '@shared/ipc';
import type { UpdateState } from '@shared/update';
import type { UpdateControl } from './ipc';

const handle = vi.fn();
const on = vi.fn();
vi.mock('electron', () => ({ ipcMain: { handle, on }, BrowserWindow: {} }));

const { registerUpdateIpc, updateHandlers } = await import('./ipc');

const STATE: UpdateState = {
  seq: 1,
  status: { kind: 'none' },
  current: { version: '0.1.0', builtAt: null, os: 'win32', arch: 'x64' },
  skipped: [],
  checkedAt: null,
  blocked: null,
};

function control(): UpdateControl & Record<keyof UpdateControl, ReturnType<typeof vi.fn>> {
  return {
    state: vi.fn(() => STATE),
    check: vi.fn(() => Promise.resolve(STATE)),
    download: vi.fn(() => Promise.resolve(STATE)),
    skip: vi.fn(() => Promise.resolve(STATE)),
    unskip: vi.fn(() => Promise.resolve(STATE)),
    restart: vi.fn(() => Promise.resolve({ ok: true as const })),
    onEvent: vi.fn(() => (): void => undefined),
  };
}

describe('update IPC', () => {
  it("a malformed version in 'skip' never reaches the service", async () => {
    const updates = control();
    const handlers = updateHandlers(updates);
    expect(await handlers.skip(42)).toBe(STATE);
    expect(await handlers.skip('../0.2.0')).toBe(STATE);
    expect(await handlers.unskip('x'.repeat(100))).toBe(STATE);
    expect(updates.skip).not.toHaveBeenCalled();
    expect(updates.unskip).not.toHaveBeenCalled();
    await handlers.skip('0.2.0');
    expect(updates.skip).toHaveBeenCalledWith('0.2.0');
  });

  it('service failure: status methods return a snapshot, restart — not-ready', async () => {
    const updates = control();
    updates.check.mockRejectedValue(new Error('engine import failed'));
    updates.restart.mockRejectedValue(new Error('boom'));
    const handlers = updateHandlers(updates);
    expect(await handlers.check()).toBe(STATE);
    expect(await handlers.restart()).toEqual({ ok: false, error: { code: 'not-ready' } });
  });

  it('channels from the table, a foreign sender does not restart, events via subscription', async () => {
    const updates = control();
    registerUpdateIpc(updates, undefined);
    const channels = handle.mock.calls.map((call) => call[0] as string);
    expect(channels.sort()).toEqual(Object.values(IpcChannels.update.invoke).sort());
    expect(on).toHaveBeenCalledWith(IpcChannels.update.events.subscribe, expect.any(Function));
    expect(updates.onEvent).toHaveBeenCalledTimes(1);
    const restart = handle.mock.calls.find(
      (call) => call[0] === IpcChannels.update.invoke.restart,
    )?.[1] as (event: unknown) => Promise<unknown>;
    const foreign = { senderFrame: { url: 'https://evil.example/' }, sender: { mainFrame: null } };
    expect(await restart(foreign)).toEqual({ ok: false, error: { code: 'not-ready' } });
    expect(updates.restart).not.toHaveBeenCalled();
  });
});
