import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { IpcChannels } from '@shared/ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();
const listeners = new Map<string, Handler>();

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {
    handle: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler);
    },
    on: (channel: string, handler: Handler): void => {
      listeners.set(channel, handler);
    },
  },
}));

const { handleInvokes, isTrustedSender, registerWindowIpc, Subscribers, UNTRUSTED_SENDER } =
  await import('./ipc');

class FakeContents extends EventEmitter {
  readonly sent: unknown[] = [];

  isDestroyed(): boolean {
    return false;
  }

  getURL(): string {
    return 'app://launcher/index.html';
  }

  send(_channel: string, payload: unknown): void {
    this.sent.push(payload);
  }
}

describe('Subscribers', () => {
  it('reloading the main frame removes the subscription; a hash-route change does not', () => {
    const subscribers = new Subscribers(undefined);
    const contents = new FakeContents();
    const asContents = contents as unknown as Parameters<typeof subscribers.add>[0];
    subscribers.add(asContents);
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    expect(subscribers.size).toBe(1);
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(subscribers.size).toBe(0);
    subscribers.send('x', 1);
    expect(contents.sent).toEqual([]);
    expect(subscribers.add(asContents)).toBe(true);
    expect(contents.listenerCount('did-start-navigation')).toBe(1);
  });
});

function event(
  frameUrl: string,
  isMainFrame = true,
  hasFrame = true,
): Parameters<typeof isTrustedSender>[0] {
  const mainFrame = { url: frameUrl };
  const senderFrame = hasFrame ? (isMainFrame ? mainFrame : { url: frameUrl }) : null;
  return { senderFrame, sender: { mainFrame } } as unknown as Parameters<typeof isTrustedSender>[0];
}

describe('isTrustedSender', () => {
  it('in a build, accepts only the main frame with app://launcher', () => {
    expect(isTrustedSender(event('app://launcher/index.html'), undefined)).toBe(true);
    expect(isTrustedSender(event('app://evil/index.html'), undefined)).toBe(false);
    expect(isTrustedSender(event('https://example.com/'), undefined)).toBe(false);
  });

  it('rejects nested frames and a missing frame', () => {
    expect(isTrustedSender(event('app://launcher/index.html', false), undefined)).toBe(false);
    expect(isTrustedSender(event('app://launcher/index.html', true, false), undefined)).toBe(false);
  });

  it('in development, accepts only the dev server', () => {
    const dev = 'http://localhost:5173/';
    expect(isTrustedSender(event('http://localhost:5173/'), dev)).toBe(true);
    expect(isTrustedSender(event('app://launcher/index.html'), dev)).toBe(false);
  });
});

describe('handleInvokes', () => {
  interface Echo {
    echo: (value: string) => Promise<string>;
    fail: () => Promise<string>;
  }

  const table = { echo: 'test:echo', fail: 'test:fail' } as const;

  function register(
    onError?: (error: unknown) => unknown,
  ): Mock<(value: unknown) => Promise<string>> {
    const echo = vi.fn((value: unknown) => Promise.resolve(`got ${String(value)}`));
    handleInvokes<Echo>(
      table,
      { echo, fail: () => Promise.reject(new Error('boom')) },
      {
        devServerUrl: undefined,
        untrusted: UNTRUSTED_SENDER,
        ...(onError === undefined ? {} : { onError }),
      },
    );
    return echo;
  }

  it('a foreign sender gets rejected; the handler is not called', async () => {
    const echo = register();
    expect(await handlers.get(table.echo)?.(event('https://evil.example/'), 'x')).toBe(
      UNTRUSTED_SENDER,
    );
    expect(echo).not.toHaveBeenCalled();
  });

  it('a trusted sender reaches the handler with its arguments', async () => {
    const echo = register();
    expect(await handlers.get(table.echo)?.(event('app://launcher/index.html'), 'x')).toBe('got x');
    expect(echo).toHaveBeenCalledWith('x');
  });

  it('a handler exception turns into the onError response', async () => {
    register(() => ({ ok: false, error: { code: 'failed' } }));
    expect(await handlers.get(table.fail)?.(event('app://launcher/index.html'))).toEqual({
      ok: false,
      error: { code: 'failed' },
    });
  });
});

describe('window:boot', () => {
  const boot = (): Handler | undefined => listeners.get(IpcChannels.window.send.boot);

  it('the report of the application page reaches the recovery, as a plain yes or no', () => {
    const onBoot = vi.fn();
    registerWindowIpc(undefined, onBoot);
    const trusted = event('app://launcher/index.html');
    boot()?.(trusted, true);
    boot()?.(trusted, false);
    boot()?.(trusted, 'yes');
    boot()?.(trusted, { mounted: true });
    expect(onBoot.mock.calls).toEqual([
      [trusted.sender, true],
      [trusted.sender, false],
      [trusted.sender, false],
      [trusted.sender, false],
    ]);
  });

  it('another page, a frame and the recovery page itself cannot report a start', () => {
    const onBoot = vi.fn();
    registerWindowIpc(undefined, onBoot);
    boot()?.(event('data:text/html,recovery'), true);
    boot()?.(event('https://evil.example/'), true);
    boot()?.(event('app://launcher/index.html', false), true);
    expect(onBoot).not.toHaveBeenCalled();
  });
});
