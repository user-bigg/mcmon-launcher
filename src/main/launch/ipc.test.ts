import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '@shared/ipc';
import type { LaunchEvent, LaunchService, LaunchState } from '@shared/launch';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
type Listener = (event: unknown) => void;
const handlers = new Map<string, Handler>();
const listeners = new Map<string, Listener>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler);
    },
    on: (channel: string, listener: Listener): void => {
      listeners.set(channel, listener);
    },
  },
}));

const { registerLaunchIpc } = await import('./ipc');

let emit: (event: LaunchEvent) => void = () => undefined;
const service: LaunchService = {
  prepare: vi.fn(() => Promise.reject(Object.assign(new Error('disk'), { code: 'ENOSPC' }))),
  launch: vi.fn(() => {
    throw new Error('sync boom');
  }),
  cancel: vi.fn(() => Promise.resolve({ ok: true as const, value: null })),
  kill: vi.fn(() => Promise.resolve({ ok: true as const, value: null })),
  keepWaiting: vi.fn(() => Promise.resolve({ ok: true as const, value: null })),
  setJoinServer: vi.fn(() => Promise.resolve({ ok: true as const, value: null })),
  answerMods: vi.fn(() => Promise.resolve({ ok: true as const, value: null })),
  logTail: vi.fn(() => Promise.reject(new Error('EIO'))),
  state: vi.fn(() => Promise.resolve({ ok: true as const, value: {} as never })),
  onEvent: (listener) => {
    emit = listener;
    return () => undefined;
  },
};

registerLaunchIpc(service, undefined, 16 * 1024 ** 3);

class FakeContents extends EventEmitter {
  readonly mainFrame: { url: string };
  readonly sent: unknown[] = [];
  destroyed = false;

  constructor(
    readonly url: string,
    private readonly failing = false,
  ) {
    super();
    this.mainFrame = { url };
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getURL(): string {
    return this.url;
  }

  send(_channel: string, payload: unknown): void {
    if (this.failing) {
      throw new Error('frame disposed');
    }
    this.sent.push(payload);
  }
}

function sender(url: string, nested = false): unknown {
  const contents = new FakeContents(url);
  return { senderFrame: nested ? { url } : contents.mainFrame, sender: contents };
}

const trusted = sender('app://launcher/index.html');
const { invoke, events } = IpcChannels.launch;

function call(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (handler === undefined) {
    throw new Error(`no handler ${channel}`);
  }
  return handler(event, ...args);
}

function subscribe(contents: FakeContents, nested = false): void {
  listeners.get(events.subscribe)?.({
    senderFrame: nested ? { url: contents.url } : contents.mainFrame,
    sender: contents,
  });
}

const state = { seq: 1 } as LaunchState;

describe('registerLaunchIpc', () => {
  it('an untrusted sender or a nested frame gets rejected without calling the service', async () => {
    const untrusted = { ok: false, error: { code: 'invalid-request', field: 'sender' } };
    expect(await call(invoke.cancel, sender('https://evil.example/'))).toEqual(untrusted);
    expect(await call(invoke.cancel, sender('app://launcher/index.html', true))).toEqual(untrusted);
    expect(service.cancel).not.toHaveBeenCalled();
    expect(await call(invoke.cancel, trusted)).toEqual({ ok: true, value: null });
  });

  it('a service exception turns into a response with an error code', async () => {
    const target = { kind: 'server', serverId: 3, minecraft: '26.3', address: 'play.example.ru' };
    expect(await call(invoke.prepare, trusted, target)).toEqual({
      ok: false,
      error: { code: 'disk-full', path: null, bytesNeeded: null },
    });
    expect(
      await call(invoke.launch, trusted, { target, account: { kind: 'nick', nick: 'Steve' } }),
    ).toEqual({ ok: false, error: { code: 'unknown', message: 'sync boom' } });
    expect(await call(invoke.logTail, trusted, 10)).toEqual({
      ok: false,
      error: { code: 'unknown', message: 'EIO' },
    });
  });

  it('input parsing rejects garbage before it reaches the service', async () => {
    expect(await call(invoke.logTail, trusted, 'x')).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'lines' },
    });
    expect(await call(invoke.setJoinServer, trusted, 'yes')).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'joinServer' },
    });
    expect(service.setJoinServer).not.toHaveBeenCalled();
    expect(await call(invoke.setJoinServer, trusted, false)).toEqual({ ok: true, value: null });
    expect(service.setJoinServer).toHaveBeenCalledWith(false);
    expect(await call(invoke.answerMods, trusted, 'later')).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'answer' },
    });
    expect(service.answerMods).not.toHaveBeenCalled();
    expect(await call(invoke.answerMods, trusted, 'without')).toEqual({ ok: true, value: null });
    expect(service.answerMods).toHaveBeenCalledWith('without');
  });

  it('only a subscribed, trusted webContents receives events', () => {
    const subscribed = new FakeContents('app://launcher/index.html');
    const silent = new FakeContents('app://launcher/index.html');
    const foreign = new FakeContents('https://evil.example/');
    const nested = new FakeContents('app://launcher/index.html');
    subscribe(subscribed);
    subscribe(subscribed);
    subscribe(foreign);
    subscribe(nested, true);
    const event: LaunchEvent = { kind: 'progress', state };
    emit(event);
    expect(subscribed.sent).toEqual([event]);
    expect(silent.sent).toEqual([]);
    expect(foreign.sent).toEqual([]);
    expect(nested.sent).toEqual([]);
  });

  it('a destroyed subscriber is removed, and a failing send does not break the broadcast', () => {
    const gone = new FakeContents('app://launcher/index.html');
    const broken = new FakeContents('app://launcher/index.html', true);
    const alive = new FakeContents('app://launcher/index.html');
    for (const contents of [gone, broken, alive]) {
      subscribe(contents);
    }
    gone.destroyed = true;
    gone.emit('destroyed');
    const event: LaunchEvent = { kind: 'progress', state };
    expect(() => {
      emit(event);
    }).not.toThrow();
    expect(gone.sent).toEqual([]);
    expect(alive.sent).toEqual([event]);
  });
});
