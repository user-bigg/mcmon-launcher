import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import { IpcChannels, type EventStream, type InvokeMethod, type InvokeTable } from '@shared/ipc';
import { isTrustedUrl } from './origins';

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent;

export type InvokeHandlers<T> = {
  [K in InvokeMethod<T>]: T[K] extends (...args: never[]) => infer R
    ? (...args: unknown[]) => R | Awaited<R>
    : never;
};

export interface InvokeGuard {
  devServerUrl: string | undefined;
  untrusted: unknown;
  onError?: (error: unknown) => unknown;
}

export const UNTRUSTED_SENDER = {
  ok: false,
  error: { code: 'invalid-request', field: 'sender' },
} as const;

export function isTrustedSender(event: IpcEvent, devServerUrl: string | undefined): boolean {
  const frame = event.senderFrame;
  if (frame === null || frame !== event.sender.mainFrame) {
    return false;
  }
  return isTrustedUrl(frame.url, devServerUrl);
}

export function handleInvokes<T>(
  table: InvokeTable<T>,
  handlers: InvokeHandlers<T>,
  guard: InvokeGuard,
): void {
  for (const method of Object.keys(table) as InvokeMethod<T>[]) {
    const run = handlers[method] as (...args: unknown[]) => unknown;
    ipcMain.handle(table[method], async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event, guard.devServerUrl)) {
        return guard.untrusted;
      }
      if (guard.onError === undefined) {
        return run(...args);
      }
      try {
        return await run(...args);
      } catch (error) {
        return guard.onError(error);
      }
    });
  }
}

export class Subscribers {
  private readonly targets = new Set<WebContents>();
  private readonly cleanups = new Map<WebContents, () => void>();

  constructor(private readonly devServerUrl: string | undefined) {}

  add(contents: WebContents): boolean {
    if (this.targets.has(contents)) {
      return false;
    }
    this.targets.add(contents);
    const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) {
        this.remove(contents);
      }
    };
    const forget = (): void => {
      contents.off('did-start-navigation', onNavigation);
      this.targets.delete(contents);
    };
    this.cleanups.set(contents, forget);
    contents.on('did-start-navigation', onNavigation);
    contents.once('destroyed', forget);
    return true;
  }

  remove(contents: WebContents): void {
    const forget = this.cleanups.get(contents);
    this.cleanups.delete(contents);
    forget?.();
  }

  has(contents: WebContents): boolean {
    return this.targets.has(contents);
  }

  get size(): number {
    return this.targets.size;
  }

  send(channel: string, payload: unknown): void {
    for (const contents of [...this.targets]) {
      try {
        if (contents.isDestroyed()) {
          this.targets.delete(contents);
        } else if (isTrustedUrl(contents.getURL(), this.devServerUrl)) {
          contents.send(channel, payload);
        }
      } catch {
        continue;
      }
    }
  }
}

export function listenSubscriptions(
  stream: EventStream,
  devServerUrl: string | undefined,
  onSubscribe: (contents: WebContents) => void = () => undefined,
): Subscribers {
  const subscribers = new Subscribers(devServerUrl);
  ipcMain.on(stream.subscribe, (event) => {
    if (isTrustedSender(event, devServerUrl)) {
      subscribers.add(event.sender);
      onSubscribe(event.sender);
    }
  });
  return subscribers;
}

export function registerWindowIpc(
  devServerUrl: string | undefined,
  onBoot: (contents: WebContents, mounted: boolean) => void = () => undefined,
): void {
  const trusted = (event: IpcEvent): BrowserWindow | null => {
    if (!isTrustedSender(event, devServerUrl)) {
      return null;
    }
    return BrowserWindow.fromWebContents(event.sender);
  };
  const { send, invoke } = IpcChannels.window;

  ipcMain.on(send.minimize, (event) => {
    trusted(event)?.minimize();
  });
  ipcMain.on(send.toggleMaximize, (event) => {
    const window = trusted(event);
    if (window === null) {
      return;
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });
  ipcMain.on(send.close, (event) => {
    trusted(event)?.close();
  });
  ipcMain.on(send.boot, (event, mounted: unknown) => {
    if (isTrustedSender(event, devServerUrl)) {
      onBoot(event.sender, mounted === true);
    }
  });
  ipcMain.handle(invoke.isMaximized, (event) => trusted(event)?.isMaximized() ?? false);
}
