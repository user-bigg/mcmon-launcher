import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ServerAddress } from '@shared/server-address';
import { pingOf, ServerPinger, type StatusReply } from './ping';

const REPLY: StatusReply = {
  players: { online: 12, max: 100 },
  ping: 41.6,
};

interface Built {
  pinger: ServerPinger;
  query: Mock<(host: string, port: number) => Promise<StatusReply>>;
  advance: (ms: number) => void;
}

function setup(query: (host: string, port: number) => Promise<StatusReply>): Built {
  let now = 0;
  const run = vi.fn(query);
  const pinger = new ServerPinger({
    query: run,
    resolveSrv: (address): Promise<ServerAddress> => Promise.resolve(address),
    now: (): number => now,
  });
  return {
    pinger,
    query: run,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ping from the player's computer", () => {
  it('server response: latency, online count and only valid nicknames', async () => {
    const { pinger, query } = setup(() => Promise.resolve(REPLY));
    expect(await pinger.ping({ host: 'play.example.ru', port: null })).toEqual({
      ok: true,
      value: { ms: 42, online: 12, max: 100 },
    });
    expect(query).toHaveBeenCalledWith('play.example.ru', 25565, 3000);
  });

  it('no more than once every 20 seconds per address', async () => {
    const { pinger, query, advance } = setup(() => Promise.resolve(REPLY));
    const address = { host: 'play.example.ru', port: 25565 };
    await pinger.ping(address);
    advance(19_999);
    await pinger.ping({ host: 'play.example.ru', port: null });
    expect(query).toHaveBeenCalledTimes(1);
    await pinger.ping({ host: 'other.example.ru', port: null });
    expect(query).toHaveBeenCalledTimes(2);
    advance(1);
    await pinger.ping(address);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('remembers no more than 500 addresses, the oldest is forgotten first', async () => {
    const { pinger, query } = setup(() => Promise.resolve(REPLY));
    const host = (index: number): ServerAddress => ({
      host: `s${String(index)}.example.ru`,
      port: null,
    });
    for (let index = 0; index <= 500; index += 1) {
      await pinger.ping(host(index));
    }
    expect(query).toHaveBeenCalledTimes(501);
    await pinger.ping(host(500));
    expect(query).toHaveBeenCalledTimes(501);
    await pinger.ping(host(0));
    expect(query).toHaveBeenCalledTimes(502);
  });

  it('3 second timeout', async () => {
    vi.useFakeTimers();
    const { pinger } = setup(() => new Promise<StatusReply>(() => undefined));
    const result = pinger.ping({ host: 'slow.example.ru', port: null });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ ok: false, error: { code: 'timeout' } });
  });

  it('connection refused — unreachable', async () => {
    const { pinger } = setup(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(await pinger.ping({ host: 'down.example.ru', port: null })).toEqual({
      ok: false,
      error: { code: 'unreachable' },
    });
  });

  it('odd numbers in the response do not break parsing', () => {
    expect(pingOf({ players: { online: -5, max: Number.NaN }, ping: -3 })).toEqual({
      ms: 0,
      online: 0,
      max: 0,
    });
  });
});

describe("ping by the site's last check of the address", () => {
  const checkedAt = '2026-10-14T09:00:00Z';
  const at = (iso: string): number => Date.parse(iso);

  it("a check younger than a day: the site's IP and port, without DNS or SRV", async () => {
    const { pinger, query, advance } = setup(() => Promise.resolve(REPLY));
    advance(at('2026-10-14T20:00:00Z'));
    const target = { ip: '203.0.113.5', port: 25570, checkedAt };
    await pinger.ping({ host: 'srv.example.ru', port: null }, target);
    expect(query).toHaveBeenCalledWith('203.0.113.5', 25570, 3000);
  });

  it('an IPv6 address goes to the socket without brackets', async () => {
    const { pinger, query, advance } = setup(() => Promise.resolve(REPLY));
    advance(at('2026-10-14T10:00:00Z'));
    await pinger.ping(
      { host: 'v6.example.ru', port: 25565 },
      { ip: '2001:db8::5', port: 25565, checkedAt },
    );
    expect(query).toHaveBeenCalledWith('2001:db8::5', 25565, 3000);
  });

  it('a check older than a day or none: the address as entered, as before', async () => {
    const stale = setup(() => Promise.resolve(REPLY));
    stale.advance(at('2026-10-15T09:00:01Z'));
    await stale.pinger.ping(
      { host: 'srv.example.ru', port: null },
      { ip: '203.0.113.5', port: 25570, checkedAt },
    );
    expect(stale.query).toHaveBeenCalledWith('srv.example.ru', 25565, 3000);
    const none = setup(() => Promise.resolve(REPLY));
    await none.pinger.ping({ host: 'port.example.ru', port: 25566 }, null);
    expect(none.query).toHaveBeenCalledWith('port.example.ru', 25566, 3000);
  });
});
