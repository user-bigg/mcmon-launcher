import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isSiteLaunchId, sitePlaySource, type DeepLink } from '@shared/deep-link';
import { isValidServerId } from '@shared/launch';

export const SITE_PORTS: readonly number[] = [46610, 46611, 46612, 46613, 46614];
export const SITE_PORT_HOST = '127.0.0.1';
export const SITE_PORT_APP = 'mcmonitor-launcher';
export const MAX_BODY_BYTES = 1024;
export const MAX_CONNECTIONS = 8;
export const PLAY_INTERVAL_MS = 2000;
export const HEADERS_TIMEOUT_MS = 3000;
export const REQUEST_TIMEOUT_MS = 5000;
export const LOOKUP_TIMEOUT_MS = 4000;
export const PREFLIGHT_MAX_AGE_S = 600;
const MAX_HEADER_BYTES = 8192;

export type ServerLookup = 'found' | 'missing' | 'unknown';

export interface SitePortDeps {
  version: string;
  origins: readonly string[];
  ready: () => boolean;
  busy: () => boolean;
  raise: () => void;
  lookup: (serverId: number) => Promise<ServerLookup>;
  play: (link: DeepLink) => void;
  now: () => number;
  log: (line: string) => void;
  lookupTimeoutMs?: number;
}

export interface SitePort {
  port: number;
  close: () => void;
}

type Json = Record<string, unknown>;
type ExtraHeaders = Record<string, string>;

// A staging site's origin is trusted only by an unpackaged launcher: a variable in the player's
// environment must not let another site start the game.
export function allowedOrigins(packaged: boolean, siteUrl: string, apiBase: string): string[] {
  const site = new URL(siteUrl).origin;
  const staging = new URL(apiBase).origin;
  return packaged || staging === site ? [site] : [site, staging];
}

// Unknown fields are skipped on purpose: the site API keeps room for an optional `ticket`.
export function parseSitePlay(body: unknown): DeepLink | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const { server_id: serverId, launch_id: launchId, source } = body as Json;
  if (!isValidServerId(serverId) || !isSiteLaunchId(launchId)) {
    return null;
  }
  return { kind: 'play', serverId, launchId, source: sitePlaySource(source), via: 'site' };
}

function corsHeaders(origin: string): ExtraHeaders {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_S),
  };
}

function send(res: ServerResponse, status: number, body: Json | null, extra: ExtraHeaders): void {
  const text = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...extra,
    ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    'Content-Length': String(Buffer.byteLength(text)),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
  });
  // Every answer ends the connection, so a page cannot keep sockets open or go on sending a body.
  res.end(text, () => {
    res.socket?.destroy();
  });
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data');
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      resolve(null);
    });
    req.on('close', () => {
      resolve(null);
    });
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(fallback);
    }, ms);
    const done = (value: T): void => {
      clearTimeout(timer);
      resolve(value);
    };
    promise.then(done, () => {
      done(fallback);
    });
  });
}

const ROUTES: Readonly<Record<string, 'GET' | 'POST'>> = { '/v1/hello': 'GET', '/v1/play': 'POST' };

export class SitePortHandler {
  private lastPlayAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly deps: SitePortDeps,
    private readonly port: () => number,
  ) {}

  handle(req: IncomingMessage, res: ServerResponse): void {
    void this.route(req, res).catch(() => {
      if (!res.headersSent) {
        send(res, 500, { error: 'failed' }, {});
      }
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.httpVersion !== '1.1') {
      send(res, 505, { error: 'http_version' }, {});
      return;
    }
    const { origin } = req.headers;
    // The Host check stops DNS rebinding: a foreign name pointed at 127.0.0.1 arrives with that
    // name in Host, whatever Origin says.
    const local = req.headers.host === `${SITE_PORT_HOST}:${String(this.port())}`;
    if (!local || origin === undefined || !this.deps.origins.includes(origin)) {
      send(res, 403, { error: 'forbidden' }, {});
      return;
    }
    const cors = corsHeaders(origin);
    const path = req.url ?? '';
    const method = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
    if (method === undefined) {
      send(res, 404, { error: 'not_found' }, cors);
      return;
    }
    if (req.method === 'OPTIONS') {
      send(res, 204, null, cors);
      return;
    }
    if (req.method !== method) {
      send(res, 405, { error: 'method_not_allowed' }, { ...cors, Allow: `${method}, OPTIONS` });
      return;
    }
    if (method === 'GET') {
      this.hello(res, cors);
      return;
    }
    await this.play(req, res, cors);
  }

  private hello(res: ServerResponse, cors: ExtraHeaders): void {
    const body = { app: SITE_PORT_APP, version: this.deps.version, play: this.deps.ready() };
    send(res, 200, body, cors);
  }

  private async play(req: IncomingMessage, res: ServerResponse, cors: ExtraHeaders): Promise<void> {
    const now = this.deps.now();
    if (now - this.lastPlayAt < PLAY_INTERVAL_MS) {
      const retry = String(Math.ceil(PLAY_INTERVAL_MS / 1000));
      send(res, 429, { error: 'rate_limited' }, { ...cors, 'Retry-After': retry });
      return;
    }
    this.lastPlayAt = now;
    if (!isJson(req.headers['content-type'])) {
      send(res, 415, { error: 'unsupported_media_type' }, cors);
      return;
    }
    if (Number(req.headers['content-length'] ?? '0') > MAX_BODY_BYTES) {
      send(res, 413, { error: 'too_large' }, cors);
      return;
    }
    const body = await readBody(req);
    if (body === null) {
      send(res, 413, { error: 'too_large' }, cors);
      return;
    }
    const link = parseSitePlay(parseJson(body.toString('utf8')));
    if (link === null) {
      send(res, 400, { error: 'bad_request' }, cors);
      return;
    }
    if (!this.deps.ready()) {
      send(res, 503, { error: 'not_ready' }, cors);
      return;
    }
    if (this.refuseBusy(res, cors)) {
      return;
    }
    const timeout = this.deps.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS;
    const found = await within(this.deps.lookup(link.serverId), timeout, 'unknown');
    if (found === 'missing') {
      send(res, 404, { error: 'server_not_found' }, cors);
      return;
    }
    if (this.refuseBusy(res, cors)) {
      return;
    }
    this.deps.play(link);
    send(res, 202, { accepted: true }, cors);
  }

  private refuseBusy(res: ServerResponse, cors: ExtraHeaders): boolean {
    if (!this.deps.busy()) {
      return false;
    }
    this.deps.raise();
    send(res, 409, { error: 'busy' }, cors);
    return true;
  }
}

// 127.0.0.1 is shared by every session of the computer. While this session is locked or
// another user is at the screen, the port is given up, so a browser of that user cannot start
// a game here; it is taken again (the first free one) when the session comes back.
export class SitePortSwitch {
  private port: SitePort | null = null;
  private wanted = false;
  private work: Promise<void> = Promise.resolve();

  constructor(private readonly open: () => Promise<SitePort | null>) {}

  get current(): SitePort | null {
    return this.port;
  }

  listen(): Promise<void> {
    this.wanted = true;
    return this.settle();
  }

  release(): Promise<void> {
    this.wanted = false;
    return this.settle();
  }

  // One change at a time: events that come in a row never open a second listener.
  private settle(): Promise<void> {
    this.work = this.work.then(async () => {
      if (this.wanted && this.port === null) {
        this.port = await this.open().catch(() => null);
      }
      if (!this.wanted && this.port !== null) {
        this.port.close();
        this.port = null;
      }
    });
    return this.work;
  }
}

function listenLocal(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const failed = (): void => {
      resolve(false);
    };
    server.once('error', failed);
    server.listen({ host: SITE_PORT_HOST, port, exclusive: true }, () => {
      server.off('error', failed);
      resolve(true);
    });
  });
}

export async function startSitePort(
  deps: SitePortDeps,
  ports: readonly number[] = SITE_PORTS,
): Promise<SitePort | null> {
  let bound = 0;
  const handler = new SitePortHandler(deps, () => bound);
  const server = createServer(
    { maxHeaderSize: MAX_HEADER_BYTES, connectionsCheckingInterval: 1000 },
    (req, res) => {
      handler.handle(req, res);
    },
  );
  server.maxConnections = MAX_CONNECTIONS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 1;
  server.on('clientError', (_error, socket) => {
    socket.destroy();
  });
  for (const port of ports) {
    if (await listenLocal(server, port)) {
      bound = port;
      server.on('error', () => undefined);
      deps.log(`site port: listening on ${SITE_PORT_HOST}:${String(port)}`);
      return {
        port,
        close: (): void => {
          server.close();
          server.closeAllConnections();
        },
      };
    }
  }
  deps.log(`site port: none of ${ports.join(', ')} is free, play from the site is off`);
  return null;
}
