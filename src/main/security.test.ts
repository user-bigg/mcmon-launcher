import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, type Mock } from 'vitest';

type CheckHandler = (contents: unknown, permission: string, origin: string) => boolean;
type RequestHandler = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl: string },
) => void;
type DeviceHandler = () => boolean;
type ContentsCreated = (event: unknown, contents: unknown) => void;

const handlers: {
  check?: CheckHandler;
  request?: RequestHandler;
  device?: DeviceHandler;
  contentsCreated?: ContentsCreated;
} = {};

vi.mock('electron', () => ({
  app: {
    on: (name: string, handler: ContentsCreated): void => {
      if (name === 'web-contents-created') {
        handlers.contentsCreated = handler;
      }
    },
  },
  Menu: {},
  BrowserWindow: {},
  screen: {},
  session: {
    defaultSession: {
      setPermissionCheckHandler: (handler: CheckHandler): void => {
        handlers.check = handler;
      },
      setPermissionRequestHandler: (handler: RequestHandler): void => {
        handlers.request = handler;
      },
      setDevicePermissionHandler: (handler: DeviceHandler): void => {
        handlers.device = handler;
      },
    },
  },
}));

const { hardenApp, isPermissionAllowed, restrictPermissions } = await import('./security');

class FakeContents extends EventEmitter {
  openHandler: (() => { action: string }) | null = null;

  setWindowOpenHandler(handler: () => { action: string }): void {
    this.openHandler = handler;
  }
}

interface NavigationEvent {
  url: string;
  preventDefault: Mock<() => void>;
}

function hardened(devServerUrl?: string): FakeContents {
  hardenApp(devServerUrl);
  const contents = new FakeContents();
  handlers.contentsCreated?.({}, contents);
  return contents;
}

function navigation(url: string): NavigationEvent {
  return { url, preventDefault: vi.fn() };
}

function blocked(contents: FakeContents, name: string, url: string): boolean {
  const event = navigation(url);
  contents.emit(name, event, url);
  return event.preventDefault.mock.calls.length > 0;
}

describe('permissions', () => {
  it('clipboard write is allowed only for a trusted origin', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', 'app://launcher', undefined)).toBe(
      true,
    );
    expect(
      isPermissionAllowed('clipboard-sanitized-write', 'https://evil.example', undefined),
    ).toBe(false);
    expect(isPermissionAllowed('clipboard-sanitized-write', undefined, undefined)).toBe(false);
    expect(isPermissionAllowed('clipboard-read', 'app://launcher', undefined)).toBe(false);
    expect(isPermissionAllowed('media', 'app://launcher', undefined)).toBe(false);
    expect(isPermissionAllowed('notifications', 'app://launcher', undefined)).toBe(false);
  });

  it('session handlers follow the same rule, device access is always denied', () => {
    restrictPermissions(undefined);
    expect(handlers.check?.({}, 'clipboard-sanitized-write', 'app://launcher')).toBe(true);
    expect(handlers.check?.({}, 'geolocation', 'app://launcher')).toBe(false);
    const granted: boolean[] = [];
    const details = { requestingUrl: 'app://launcher/index.html' };
    handlers.request?.({}, 'clipboard-sanitized-write', (value) => granted.push(value), details);
    handlers.request?.({}, 'openExternal', (value) => granted.push(value), details);
    handlers.request?.({}, 'clipboard-sanitized-write', (value) => granted.push(value), {
      requestingUrl: 'https://evil.example/',
    });
    expect(granted).toEqual([true, false, false]);
    expect(handlers.device?.()).toBe(false);
  });
});

describe('navigation and windows', () => {
  it.each(['will-navigate', 'will-redirect', 'will-frame-navigate'])(
    '%s: a foreign address is cancelled, our own passes',
    (name) => {
      const contents = hardened();
      expect(blocked(contents, name, 'https://evil.example/')).toBe(true);
      expect(blocked(contents, name, 'app://evil/index.html')).toBe(true);
      expect(blocked(contents, name, 'app://launcher/index.html#/catalog')).toBe(false);
    },
  );

  it('in development, only the dev server is allowed', () => {
    const contents = hardened('http://localhost:5173/');
    expect(blocked(contents, 'will-navigate', 'http://localhost:5173/#/home')).toBe(false);
    expect(blocked(contents, 'will-navigate', 'http://localhost:5174/')).toBe(true);
  });

  it('webviews are not embedded, new windows are not opened', () => {
    const contents = hardened();
    expect(blocked(contents, 'will-attach-webview', 'app://launcher/index.html')).toBe(true);
    expect(contents.openHandler?.()).toEqual({ action: 'deny' });
  });
});
