import { app, ipcMain } from 'electron';
import {
  DEEP_LINK_SCHEME,
  SITE_PLAY_TTL_MS,
  type DeepLink,
  type DeepLinkDelivery,
} from '@shared/deep-link';
import { IpcChannels } from '@shared/ipc';
import { isTrustedSender, listenSubscriptions } from './ipc';

export const DEV_PROTOCOL_ENV = 'MCMONITOR_DEV_PROTOCOL';
export const MAX_PENDING_LINKS = 5;

export interface DeepLinkTarget {
  readonly size: number;
  send: (channel: string, payload: unknown) => void;
}

interface PendingLink extends DeepLinkDelivery {
  receivedAt: number;
}

export class DeepLinkQueue {
  private readonly pending: PendingLink[] = [];
  private nextId = 1;
  private target: DeepLinkTarget | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  attach(target: DeepLinkTarget): void {
    this.target = target;
    this.deliver();
  }

  receive(link: DeepLink | null): boolean {
    if (link === null) {
      return false;
    }
    const waiting = this.pending.find((item) => item.link.serverId === link.serverId);
    if (waiting === undefined) {
      this.pending.push({ id: this.nextId, link, receivedAt: this.now() });
      this.nextId += 1;
      this.pending.splice(0, Math.max(0, this.pending.length - MAX_PENDING_LINKS));
    } else if (link.via === 'site') {
      waiting.link = link;
      waiting.receivedAt = this.now();
    }
    this.deliver();
    return true;
  }

  ack(id: unknown): void {
    const index = this.pending.findIndex((item) => item.id === id);
    if (index >= 0) {
      this.pending.splice(index, 1);
    }
  }

  get size(): number {
    return this.pending.length;
  }

  deliver(): void {
    const target = this.target;
    if (target === null || target.size === 0) {
      return;
    }
    for (const item of this.pending) {
      target.send(IpcChannels.deepLink.events.event, { id: item.id, link: this.fresh(item) });
    }
  }

  // A request of the site that found no window in time (the page failed to load) must not start
  // a game hours later, when the window is opened for another reason.
  private fresh(item: PendingLink): DeepLink {
    const expired = item.link.via === 'site' && this.now() - item.receivedAt > SITE_PLAY_TTL_MS;
    return expired ? { ...item.link, stale: true } : item.link;
  }
}

export class DeepLinkInbox extends DeepLinkQueue {
  listen(devServerUrl: string | undefined): void {
    this.attach(
      listenSubscriptions(IpcChannels.deepLink.events, devServerUrl, () => {
        this.deliver();
      }),
    );
    ipcMain.on(IpcChannels.deepLink.ack, (event, id: unknown) => {
      if (isTrustedSender(event, devServerUrl)) {
        this.ack(id);
      }
    });
  }
}

export function protocolArguments(packaged: boolean, appPath: string): string[] {
  return packaged ? ['--'] : [appPath, '--'];
}

export interface ProtocolRegistration {
  registered: boolean;
  unregister: () => void;
}

const NOT_REGISTERED: ProtocolRegistration = { registered: false, unregister: () => undefined };

// Without '--' before %1 the link string would be parsed as Chromium switches, and a link
// like 'mcmonitor://x --inspect' would become a command-line flag.
export function registerProtocolClient(): ProtocolRegistration {
  const args = protocolArguments(app.isPackaged, app.getAppPath());
  if (app.isPackaged) {
    return {
      registered: app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, args),
      unregister: () => undefined,
    };
  }
  if (process.env[DEV_PROTOCOL_ENV] !== '1') {
    return NOT_REGISTERED;
  }
  const registered = app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, args);
  return {
    registered,
    unregister: (): void => {
      if (registered) {
        app.removeAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, args);
      }
    },
  };
}
