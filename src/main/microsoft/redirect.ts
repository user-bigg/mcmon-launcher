import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ru } from '@shared/i18n/ru';
import { browserPage } from '../account/browser-page';
import { sendPage } from '../account/loopback';
import { isRecord } from '../site/guards';
import { REDIRECT_HOST, REDIRECT_PATH, REDIRECT_PORT } from './config';
import { microsoftCodeOf, microsoftFailure } from './errors';

export type RedirectOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'denied' }
  | { kind: 'rejected' }
  | { kind: 'state-mismatch' }
  | { kind: 'timeout' }
  | { kind: 'closed' };

export interface RedirectRequest {
  method: string | undefined;
  url: string | undefined;
  host: string | undefined;
  fetchMode: string | undefined;
}

interface RedirectDecision {
  status: 200 | 400 | 404 | 405 | 410;
  outcome: RedirectOutcome | null;
}

export interface RedirectListener {
  port: number;
  result: Promise<RedirectOutcome>;
  close: () => Promise<void>;
}

export interface RedirectOptions {
  state: string;
  timeoutMs: number;
  port?: number;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CODE_LENGTH = 4096;

// The browser comes by the name from the registered address (localhost); the numeric form is
// accepted too. Any other Host is a page that resolved its own name to the loopback address.
function isOwnHost(host: string | undefined, port: number): boolean {
  return host === `localhost:${String(port)}` || host === `${REDIRECT_HOST}:${String(port)}`;
}

// Any open page can send a background request here (an image, a no-cors fetch) with a made-up
// state. Only the browser really coming back to the address may cancel the sign-in; browsers
// without Sec-Fetch-Mode are treated as coming back.
function isNavigation(request: RedirectRequest): boolean {
  return request.fetchMode === undefined || request.fetchMode === 'navigate';
}

export function decideRedirect(
  request: RedirectRequest,
  expected: { state: string; port: number; used: boolean },
): RedirectDecision {
  if (expected.used) {
    return { status: 410, outcome: null };
  }
  if (request.method !== 'GET') {
    return { status: 405, outcome: null };
  }
  const url = URL.parse(request.url ?? '', `http://${REDIRECT_HOST}`);
  if (url?.pathname !== REDIRECT_PATH) {
    return { status: 404, outcome: null };
  }
  if (!isOwnHost(request.host, expected.port)) {
    return { status: 400, outcome: null };
  }
  if (url.searchParams.get('state') !== expected.state) {
    return { status: 400, outcome: isNavigation(request) ? { kind: 'state-mismatch' } : null };
  }
  const error = url.searchParams.get('error');
  if (error === 'access_denied') {
    return { status: 200, outcome: { kind: 'denied' } };
  }
  const code = url.searchParams.get('code') ?? '';
  if (error !== null || code.length === 0 || code.length > MAX_CODE_LENGTH) {
    return { status: 400, outcome: { kind: 'rejected' } };
  }
  return { status: 200, outcome: { kind: 'code', code } };
}

function redirectPage(decision: RedirectDecision): string {
  if (decision.outcome?.kind === 'code') {
    return browserPage('ok', ru.microsoft.callback.doneTitle, ru.microsoft.callback.doneText);
  }
  if (decision.outcome?.kind === 'denied') {
    return browserPage('fail', ru.microsoft.callback.deniedTitle, ru.microsoft.callback.deniedText);
  }
  if (decision.status === 410) {
    return browserPage('fail', ru.microsoft.callback.usedTitle, ru.microsoft.callback.usedText);
  }
  return browserPage('fail', ru.microsoft.callback.invalidTitle, ru.microsoft.callback.invalidText);
}

function fetchModeOf(request: IncomingMessage): string | undefined {
  const mode = request.headers['sec-fetch-mode'];
  return typeof mode === 'string' ? mode : undefined;
}

const ANY_FREE_PORT = 0;

export async function startRedirectListener(options: RedirectOptions): Promise<RedirectListener> {
  if (options.port !== undefined) {
    return listenOn(options, options.port);
  }
  try {
    return await listenOn(options, REDIRECT_PORT);
  } catch (error) {
    if (microsoftCodeOf(error) !== 'port_busy') {
      throw error;
    }
    return listenOn(options, ANY_FREE_PORT);
  }
}

async function listenOn(options: RedirectOptions, requested: number): Promise<RedirectListener> {
  let port = requested;
  let listened = false;
  let used = false;
  let finished = false;
  let settle: (outcome: RedirectOutcome) => void = () => undefined;
  const result = new Promise<RedirectOutcome>((resolve) => {
    settle = resolve;
  });
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const decision = decideRedirect(
      {
        method: request.method,
        url: request.url,
        host: request.headers.host,
        fetchMode: fetchModeOf(request),
      },
      { state: options.state, port, used },
    );
    sendPage(response, decision.status, redirectPage(decision));
    const { outcome } = decision;
    if (outcome !== null) {
      used = true;
      response.once('finish', () => {
        void finish(outcome);
      });
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  const closed = new Promise<void>((resolve) => {
    server.once('close', resolve);
  });
  const timer = setTimeout(() => {
    void finish({ kind: 'timeout' });
  }, options.timeoutMs);
  timer.unref();
  function finish(outcome: RedirectOutcome): Promise<void> {
    if (!finished) {
      finished = true;
      clearTimeout(timer);
      settle(outcome);
      if (listened) {
        server.close();
        server.closeAllConnections();
      }
    }
    return listened ? closed : Promise.resolve();
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, REDIRECT_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  }).catch((error: unknown) => {
    void finish({ kind: 'closed' });
    throw microsoftFailure(isRecord(error) && error.code === 'EADDRINUSE' ? 'port_busy' : 'failed');
  });
  listened = true;
  server.on('error', () => {
    void finish({ kind: 'closed' });
  });
  port = (server.address() as AddressInfo).port;
  return { port, result, close: () => finish({ kind: 'closed' }) };
}
