import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { normalizeLoginCode } from '@shared/account';
import { ru } from '@shared/i18n/ru';
import { browserPage } from './browser-page';

export const LOOPBACK_HOST = '127.0.0.1';
export const CALLBACK_PATH = '/callback';

export type CallbackOutcome =
  { kind: 'code'; code: string } | { kind: 'timeout' } | { kind: 'closed' };

export interface CallbackRequest {
  method: string | undefined;
  url: string | undefined;
  host: string | undefined;
}

export interface CallbackExpectation {
  state: string;
  port: number;
  used: boolean;
}

export type CallbackDecision =
  { status: 200; code: string } | { status: 400 | 404 | 405 | 410; code?: never };

export interface Loopback {
  port: number;
  result: Promise<CallbackOutcome>;
  close: () => void;
}

export interface LoopbackOptions {
  state: string;
  timeoutMs: number;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function decideCallback(
  request: CallbackRequest,
  expected: CallbackExpectation,
): CallbackDecision {
  if (expected.used) {
    return { status: 410 };
  }
  if (request.method !== 'GET') {
    return { status: 405 };
  }
  const url = URL.parse(request.url ?? '', `http://${LOOPBACK_HOST}`);
  if (url?.pathname !== CALLBACK_PATH) {
    return { status: 404 };
  }
  if (request.host !== `${LOOPBACK_HOST}:${String(expected.port)}`) {
    return { status: 400 };
  }
  if (url.searchParams.get('state') !== expected.state) {
    return { status: 400 };
  }
  const code = normalizeLoginCode(url.searchParams.get('code') ?? '');
  return code === null ? { status: 400 } : { status: 200, code };
}

export function callbackPage(status: CallbackDecision['status']): string {
  if (status === 200) {
    return browserPage('ok', ru.account.callback.doneTitle, ru.account.callback.doneText);
  }
  if (status === 410) {
    return browserPage('fail', ru.account.callback.usedTitle, ru.account.callback.usedText);
  }
  return browserPage('fail', ru.account.callback.invalidTitle, ru.account.callback.invalidText);
}

export function sendPage(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Connection: 'close',
  });
  response.end(html);
}

function respond(response: ServerResponse, status: CallbackDecision['status']): void {
  sendPage(response, status, callbackPage(status));
}

export async function startLoopback(options: LoopbackOptions): Promise<Loopback> {
  let used = false;
  let port = 0;
  let settle: (outcome: CallbackOutcome) => void = () => undefined;
  const result = new Promise<CallbackOutcome>((resolve) => {
    settle = resolve;
  });
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const decision = decideCallback(
      { method: request.method, url: request.url, host: request.headers.host },
      { state: options.state, port, used },
    );
    respond(response, decision.status);
    if (decision.status === 200) {
      used = true;
      response.once('finish', () => {
        finish({ kind: 'code', code: decision.code });
      });
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  let finished = false;
  const timer = setTimeout(() => {
    finish({ kind: 'timeout' });
  }, options.timeoutMs);
  timer.unref();
  function finish(outcome: CallbackOutcome): void {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
    settle(outcome);
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  }).catch((error: unknown) => {
    finish({ kind: 'closed' });
    throw error;
  });
  port = (server.address() as AddressInfo).port;
  return {
    port,
    result,
    close: (): void => {
      finish({ kind: 'closed' });
    },
  };
}
