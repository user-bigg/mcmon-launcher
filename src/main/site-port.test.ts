import { request } from 'node:http';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeepLink } from '@shared/deep-link';
import {
  allowedOrigins,
  MAX_BODY_BYTES,
  parseSitePlay,
  PLAY_INTERVAL_MS,
  SITE_PORTS,
  SitePortSwitch,
  startSitePort,
  type ServerLookup,
  type SitePort,
  type SitePortDeps,
} from './site-port';

const SITE = 'https://mc-mon.ru';
const STAGING = 'https://staging.example';
const LAUNCH_ID = '3f0c2a52-6f0e-4c1e-9a55-0d3a4d1b7c21';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface Call {
  method?: string;
  path?: string;
  origin?: string | null;
  host?: string;
  type?: string | null;
  body?: string;
}

interface World {
  port: SitePort;
  played: DeepLink[];
  raised: number;
  logs: string[];
  state: { ready: boolean; busy: boolean; lookup: ServerLookup; now: number };
  call: (options?: Call) => Promise<Reply>;
  play: (body: unknown, options?: Call) => Promise<Reply>;
}

const opened: { close: () => void }[] = [];
const openedGates: SitePortSwitch[] = [];

afterEach(async () => {
  for (const gate of openedGates.splice(0)) {
    await gate.release();
  }
  for (const item of opened.splice(0)) {
    item.close();
  }
});

function occupy(port = 0): Promise<{ port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      opened.push(server);
      resolve({ port: (server.address() as AddressInfo).port, server });
    });
  });
}

async function freePort(): Promise<number> {
  const taken = await occupy();
  await new Promise((resolve) => taken.server.close(resolve));
  return taken.port;
}

function send(port: number, options: Call): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: options.host ?? `127.0.0.1:${String(port)}` };
    if (options.origin !== null) {
      headers.Origin = options.origin ?? SITE;
    }
    if (options.type !== null && options.body !== undefined) {
      headers['Content-Type'] = options.type ?? 'application/json';
    }
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/v1/hello',
        headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

async function open(
  deps: Partial<SitePortDeps> = {},
  ports?: readonly number[],
): Promise<World | null> {
  const state: World['state'] = { ready: true, busy: false, lookup: 'found', now: 1_000_000 };
  const played: DeepLink[] = [];
  const logs: string[] = [];
  const world = { raised: 0 };
  const port = await startSitePort(
    {
      version: '0.1.0',
      origins: [SITE],
      ready: () => state.ready,
      busy: () => state.busy,
      raise: (): void => {
        world.raised += 1;
      },
      lookup: () => Promise.resolve(state.lookup),
      play: (link): void => {
        played.push(link);
      },
      now: () => state.now,
      log: (line): void => {
        logs.push(line);
      },
      ...deps,
    },
    ports ?? [await freePort()],
  );
  if (port === null) {
    return null;
  }
  opened.push(port);
  const call = (options: Call = {}): Promise<Reply> => send(port.port, options);
  return {
    port,
    played,
    logs,
    state,
    get raised(): number {
      return world.raised;
    },
    call,
    play: (body, options = {}): Promise<Reply> =>
      call({ method: 'POST', path: '/v1/play', body: JSON.stringify(body), ...options }),
  };
}

async function ready(deps: Partial<SitePortDeps> = {}): Promise<World> {
  const world = await open(deps);
  if (world === null) {
    throw new Error('no port');
  }
  return world;
}

const valid = { server_id: 7, launch_id: LAUNCH_ID, source: 'server_page' };

describe('site port: choosing a port', () => {
  it('keeps five own ports in a row', () => {
    expect(SITE_PORTS).toEqual([46610, 46611, 46612, 46613, 46614]);
  });

  it('takes the first free port and skips the taken ones', async () => {
    const first = await occupy();
    const second = await occupy();
    const free = await freePort();
    const world = await open({}, [first.port, second.port, free]);
    expect(world?.port.port).toBe(free);
    expect((await world?.call())?.status).toBe(200);
  });

  it('works without a port when all of them are taken, with a line in the log', async () => {
    const first = await occupy();
    const second = await occupy();
    const logs: string[] = [];
    const world = await open({ log: (line) => logs.push(line) }, [first.port, second.port]);
    expect(world).toBeNull();
    expect(logs.join('\n')).toContain('play from the site is off');
  });

  it('listens on 127.0.0.1 only', async () => {
    const world = await ready();
    const wildcard = await occupy(world.port.port).then(
      () => 'bound',
      () => 'refused',
    );
    const closed = new Promise((resolve) => {
      const probe = request({ host: '::1', port: world.port.port, agent: false });
      probe.on('error', () => {
        resolve('refused');
      });
      probe.on('response', () => {
        resolve('answered');
      });
      probe.end();
    });
    expect(wildcard).toBe('refused');
    expect(await closed).toBe('refused');
  });
});

describe('site port: a locked session gives the port up', () => {
  function switchOn(port: number): { gate: SitePortSwitch; opened: () => number } {
    let opened = 0;
    const gate = new SitePortSwitch(() => {
      opened += 1;
      return startSitePort(
        {
          version: '0.1.0',
          origins: [SITE],
          ready: () => true,
          busy: () => false,
          raise: () => undefined,
          lookup: () => Promise.resolve('found'),
          play: () => undefined,
          now: () => 0,
          log: () => undefined,
        },
        [port],
      );
    });
    openedGates.push(gate);
    return { gate, opened: () => opened };
  }

  it('lock: nothing listens; unlock: the port answers again', async () => {
    const port = await freePort();
    const { gate } = switchOn(port);
    await gate.listen();
    expect((await send(port, {})).status).toBe(200);
    await gate.release();
    expect(gate.current).toBeNull();
    await expect(send(port, {})).rejects.toThrow();
    const other = await occupy(port);
    other.server.close();
    await gate.listen();
    expect((await send(port, {})).status).toBe(200);
  });

  it('events in a row never open a second listener', async () => {
    const port = await freePort();
    const { gate, opened } = switchOn(port);
    void gate.listen();
    void gate.listen();
    void gate.release();
    void gate.listen();
    await gate.listen();
    expect(opened()).toBe(1);
    expect(gate.current?.port).toBe(port);
    void gate.release();
    void gate.release();
    void gate.listen();
    void gate.release();
    await gate.release();
    expect(gate.current).toBeNull();
    await expect(send(port, {})).rejects.toThrow();
    await gate.listen();
    await gate.listen();
    expect(opened()).toBe(2);
    expect((await send(port, {})).status).toBe(200);
  });

  it('a release while the port is still being opened closes it at once', async () => {
    const port = await freePort();
    const { gate } = switchOn(port);
    void gate.listen();
    await gate.release();
    expect(gate.current).toBeNull();
    await expect(send(port, {})).rejects.toThrow();
  });
});

describe('site port: hello', () => {
  it('tells the app, the version and the readiness, and nothing else', async () => {
    const world = await ready();
    const reply = await world.call();
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({
      app: 'mcmonitor-launcher',
      version: '0.1.0',
      play: true,
    });
    world.state.ready = false;
    expect(JSON.parse((await world.call()).body)).toMatchObject({ play: false });
  });

  it('answers with the CORS headers of the site and without credentials', async () => {
    const world = await ready();
    const { headers } = await world.call();
    expect(headers['access-control-allow-origin']).toBe(SITE);
    expect(headers.vary).toBe('Origin');
    expect(headers['access-control-allow-private-network']).toBe('true');
    expect(headers['access-control-allow-credentials']).toBeUndefined();
    expect(headers.connection).toBe('close');
  });
});

describe('site port: origin and host', () => {
  it.each([
    ['another site', { origin: 'https://evil.example' }],
    ['a lookalike of the site', { origin: 'https://mc-mon.ru.evil.example' }],
    ['the site over http', { origin: 'http://mc-mon.ru' }],
    ['the null origin', { origin: 'null' }],
    ['no origin at all', { origin: null }],
    ['a rebound host name', { host: 'evil.example:46610' }],
    ['localhost instead of the address', { host: 'localhost' }],
  ] as const)('refuses %s with 403 and no CORS headers', async (_name, options) => {
    const world = await ready();
    for (const path of ['/v1/hello', '/v1/play']) {
      const reply = await world.call({ ...options, path });
      expect(reply.status).toBe(403);
      expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    }
    const preflight = await world.call({ ...options, method: 'OPTIONS', path: '/v1/play' });
    expect(preflight.status).toBe(403);
    expect(world.played).toEqual([]);
  });

  it('does not start a game for a foreign origin', async () => {
    const world = await ready();
    const reply = await world.play(valid, { origin: 'https://evil.example' });
    expect(reply.status).toBe(403);
    expect(world.played).toEqual([]);
  });

  it('lets the staging site in only in an unpackaged launcher', async () => {
    const api = `${STAGING}/api/launcher/v1`;
    expect(allowedOrigins(false, SITE, api)).toEqual([SITE, STAGING]);
    expect(allowedOrigins(true, SITE, api)).toEqual([SITE]);
    expect(allowedOrigins(false, SITE, `${SITE}/api/launcher/v1`)).toEqual([SITE]);
    const packaged = await ready({ origins: allowedOrigins(true, SITE, api) });
    expect((await packaged.call({ origin: STAGING })).status).toBe(403);
    const development = await ready({ origins: allowedOrigins(false, SITE, api) });
    const reply = await development.call({ origin: STAGING });
    expect(reply.status).toBe(200);
    expect(reply.headers['access-control-allow-origin']).toBe(STAGING);
  });
});

describe('site port: OPTIONS, paths and methods', () => {
  it('answers a preflight with the allowed methods and headers', async () => {
    const world = await ready();
    const reply = await world.call({ method: 'OPTIONS', path: '/v1/play' });
    expect(reply.status).toBe(204);
    expect(reply.body).toBe('');
    expect(reply.headers).toMatchObject({
      'access-control-allow-origin': SITE,
      vary: 'Origin',
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'Content-Type',
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '600',
    });
  });

  it('answers 404 to other paths and 405 to other methods', async () => {
    const world = await ready();
    expect((await world.call({ path: '/' })).status).toBe(404);
    expect((await world.call({ path: '/v1/hello?x=1' })).status).toBe(404);
    expect((await world.call({ path: '/v1/play/7' })).status).toBe(404);
    expect((await world.call({ method: 'OPTIONS', path: '/v2/play' })).status).toBe(404);
    const get = await world.call({ path: '/v1/play' });
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST, OPTIONS');
    expect((await world.call({ method: 'POST', path: '/v1/hello', body: '{}' })).status).toBe(405);
    expect((await world.call({ method: 'DELETE', path: '/v1/play' })).status).toBe(405);
  });
});

describe('site port: play', () => {
  it('accepts a request and hands it on as a request of the site', async () => {
    const world = await ready();
    const reply = await world.play({ ...valid, ticket: 'later', extra: [1] });
    expect(reply.status).toBe(202);
    expect(JSON.parse(reply.body)).toEqual({ accepted: true });
    expect(world.played).toEqual([
      { kind: 'play', serverId: 7, launchId: LAUNCH_ID, source: 'server_page', via: 'site' },
    ]);
  });

  it('answers 202 before anything is installed: the lookup is all it waits for', async () => {
    const lookup = vi.fn(() => Promise.resolve<ServerLookup>('found'));
    const world = await ready({ lookup });
    expect((await world.play(valid)).status).toBe(202);
    expect(lookup).toHaveBeenCalledWith(7);
  });

  it('answers 404 when the catalog has no such server', async () => {
    const world = await ready();
    world.state.lookup = 'missing';
    const reply = await world.play(valid);
    expect(reply.status).toBe(404);
    expect(JSON.parse(reply.body)).toEqual({ error: 'server_not_found' });
    expect(world.played).toEqual([]);
  });

  it('accepts when the site did not answer about the server: the window shows the error', async () => {
    const world = await ready();
    world.state.lookup = 'unknown';
    expect((await world.play(valid)).status).toBe(202);
    const slow = await ready({ lookup: () => new Promise(() => undefined), lookupTimeoutMs: 20 });
    expect((await slow.play(valid)).status).toBe(202);
    const failing = await ready({ lookup: () => Promise.reject(new Error('offline')) });
    expect((await failing.play(valid)).status).toBe(202);
  });

  it('answers 409 and raises the window while a launch or a game is going', async () => {
    const world = await ready();
    world.state.busy = true;
    const reply = await world.play(valid);
    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body)).toEqual({ error: 'busy' });
    expect(world.raised).toBe(1);
    expect(world.played).toEqual([]);
  });

  it('answers 503 while the launcher cannot take a launch', async () => {
    const world = await ready();
    world.state.ready = false;
    expect((await world.play(valid)).status).toBe(503);
    expect(world.played).toEqual([]);
  });

  it.each([
    ['not JSON', 'play'],
    ['an array', '[]'],
    ['no server', JSON.stringify({ launch_id: LAUNCH_ID })],
    ['a server as a string', JSON.stringify({ ...valid, server_id: '7' })],
    ['a server of zero', JSON.stringify({ ...valid, server_id: 0 })],
    ['no launch id', JSON.stringify({ server_id: 7 })],
    [
      'a launch id that is not v4',
      JSON.stringify({ ...valid, launch_id: '3f0c2a52-6f0e-1c1e-9a55-0d3a4d1b7c21' }),
    ],
  ])('answers 400 to %s', async (_name, body) => {
    const world = await ready();
    const reply = await world.call({ method: 'POST', path: '/v1/play', body });
    expect(reply.status).toBe(400);
    expect(world.played).toEqual([]);
  });

  it('answers 415 to a body that is not declared as JSON', async () => {
    const world = await ready();
    const text = await world.play(valid, { type: 'text/plain' });
    expect(text.status).toBe(415);
    world.state.now += PLAY_INTERVAL_MS;
    expect((await world.play(valid, { type: null })).status).toBe(415);
    world.state.now += PLAY_INTERVAL_MS;
    expect((await world.play(valid, { type: 'application/json; charset=utf-8' })).status).toBe(202);
  });

  it("turns a source outside the site's list into 'other'", () => {
    expect(parseSitePlay({ ...valid, source: 'deeplink' })).toMatchObject({ source: 'other' });
    expect(parseSitePlay({ ...valid, source: 5 })).toMatchObject({ source: 'other' });
    expect(parseSitePlay({ server_id: 7, launch_id: LAUNCH_ID })).toMatchObject({
      source: 'other',
    });
  });
});

describe('site port: limits', () => {
  it('answers 413 to a body over 1 KB', async () => {
    const world = await ready();
    const reply = await world.play({ ...valid, pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect(reply.status).toBe(413);
    expect(world.played).toEqual([]);
  });

  it('takes play no more often than once in two seconds', async () => {
    const world = await ready();
    expect((await world.play(valid)).status).toBe(202);
    world.state.now += PLAY_INTERVAL_MS - 1;
    const early = await world.play(valid);
    expect(early.status).toBe(429);
    expect(early.headers['retry-after']).toBe('2');
    world.state.now += 1;
    expect((await world.play(valid)).status).toBe(202);
    expect(world.played).toHaveLength(2);
    expect((await world.call()).status).toBe(200);
  });
});
