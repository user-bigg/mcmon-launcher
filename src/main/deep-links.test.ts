import { describe, expect, it, vi } from 'vitest';
import { SITE_PLAY_TTL_MS, type DeepLinkDelivery } from '@shared/deep-link';

vi.mock('electron', () => ({ app: {}, ipcMain: {}, BrowserWindow: {} }));

const { DeepLinkQueue, MAX_PENDING_LINKS, protocolArguments } = await import('./deep-links');

function target(): {
  size: number;
  sent: DeepLinkDelivery[];
  send: (c: string, p: unknown) => void;
} {
  const sent: DeepLinkDelivery[] = [];
  return {
    size: 1,
    sent,
    send: (_channel, payload): void => {
      sent.push(payload as DeepLinkDelivery);
    },
  };
}

describe('DeepLinkQueue', () => {
  it('a link is held until the renderer acknowledges it and is resent after a reload', () => {
    const queue = new DeepLinkQueue();
    queue.receive({ kind: 'play', serverId: 5 });
    const first = target();
    queue.attach(first);
    expect(first.sent).toEqual([{ id: 1, link: { kind: 'play', serverId: 5 } }]);
    queue.deliver();
    expect(first.sent).toHaveLength(2);
    queue.ack(1);
    queue.deliver();
    expect(first.sent).toHaveLength(2);
    expect(queue.size).toBe(0);
  });

  it('a request of the site replaces a waiting link to the same server, never the other way', () => {
    const queue = new DeepLinkQueue();
    const site = { kind: 'play', serverId: 5, source: 'catalog', via: 'site' } as const;
    queue.receive({ kind: 'play', serverId: 5 });
    queue.receive(site);
    queue.receive({ kind: 'play', serverId: 5 });
    const first = target();
    queue.attach(first);
    expect(first.sent).toEqual([{ id: 1, link: site }]);
  });

  it('a request of the site that waited over 30 s for a window is delivered as stale', () => {
    let now = 1_000;
    const queue = new DeepLinkQueue(() => now);
    const site = { kind: 'play', serverId: 5, via: 'site' } as const;
    queue.receive(site);
    queue.receive({ kind: 'play', serverId: 6 });
    now += SITE_PLAY_TTL_MS;
    const early = target();
    queue.attach(early);
    expect(early.sent.map((item) => item.link)).toEqual([site, { kind: 'play', serverId: 6 }]);
    now += 1;
    queue.deliver();
    expect(early.sent.slice(2).map((item) => item.link)).toEqual([
      { ...site, stale: true },
      { kind: 'play', serverId: 6 },
    ]);
    queue.receive(site);
    expect(early.sent.at(-2)?.link).toEqual(site);
  });

  it('sends nothing without subscribers; repeating the same server does not duplicate', () => {
    const queue = new DeepLinkQueue();
    const empty = { ...target(), size: 0 };
    queue.attach(empty);
    expect(queue.receive({ kind: 'play', serverId: 5 })).toBe(true);
    queue.receive({ kind: 'play', serverId: 5 });
    expect(empty.sent).toEqual([]);
    expect(queue.size).toBe(1);
    expect(queue.receive(null)).toBe(false);
  });

  it('the queue is bounded; the oldest links are dropped first', () => {
    const queue = new DeepLinkQueue();
    const total = MAX_PENDING_LINKS + 3;
    for (let id = 1; id <= total; id++) {
      queue.receive({ kind: 'play', serverId: id });
    }
    expect(queue.size).toBe(MAX_PENDING_LINKS);
    const shown = target();
    queue.attach(shown);
    expect(shown.sent.map((item) => item.link.serverId)).toEqual(
      Array.from(
        { length: MAX_PENDING_LINKS },
        (_, index) => total - MAX_PENDING_LINKS + 1 + index,
      ),
    );
  });

  it('protocol registration: "--" before the link, plus the app path in development', () => {
    expect(protocolArguments(true, '/app')).toEqual(['--']);
    expect(protocolArguments(false, '/app')).toEqual(['/app', '--']);
  });
});
