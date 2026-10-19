import type * as NodeHttp from 'node:http';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { ru } from '@shared/i18n/ru';
import { callbackPage, decideCallback, startLoopback, type CallbackDecision } from './loopback';

const servers = vi.hoisted((): Server[] => []);

vi.mock('node:http', async (importOriginal) => {
  const http = await importOriginal<typeof NodeHttp>();
  return {
    ...http,
    createServer: (...args: Parameters<typeof http.createServer>): Server => {
      const server = http.createServer(...args);
      servers.push(server);
      return server;
    },
  };
});

const STATE = 'state-value-123';
const PORT = 50123;

function decide(
  url: string,
  used = false,
  method = 'GET',
  host = `127.0.0.1:${String(PORT)}`,
): CallbackDecision {
  return decideCallback({ method, url, host }, { state: STATE, port: PORT, used });
}

interface Reply {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function get(port: number, path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body, headers: response.headers });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('decision for a /callback request', () => {
  it('correct state and code — 200 with a normalized code', () => {
    expect(decide(`/callback?code=abcd-ef23&state=${STATE}`)).toEqual({
      status: 200,
      code: 'ABCDEF23',
    });
  });

  it('wrong state, malformed code, wrong Host — 400', () => {
    expect(decide('/callback?code=ABCDEF23&state=other')).toEqual({ status: 400 });
    expect(decide(`/callback?code=ABCDEF2&state=${STATE}`)).toEqual({ status: 400 });
    expect(decide(`/callback?state=${STATE}`)).toEqual({ status: 400 });
    expect(
      decide(`/callback?code=ABCDEF23&state=${STATE}`, false, 'GET', 'evil.example:50123'),
    ).toEqual({ status: 400 });
  });

  it('different path — 404, non-GET — 405, repeat request — 410', () => {
    expect(decide('/favicon.ico')).toEqual({ status: 404 });
    expect(decide(`/callback?code=ABCDEF23&state=${STATE}`, false, 'POST')).toEqual({
      status: 405,
    });
    expect(decide(`/callback?code=ABCDEF23&state=${STATE}`, true)).toEqual({ status: 410 });
  });

  it('page is in Russian from the localization file and has no external resources', () => {
    const page = callbackPage(200);
    expect(page).toContain(ru.account.callback.doneTitle);
    expect(page).not.toMatch(/https?:\/\/|<script|<img|<link/);
    expect(callbackPage(410)).toContain(ru.account.callback.usedTitle);
    expect(callbackPage(400)).toContain(ru.account.callback.invalidTitle);
  });
});

describe('loopback server', () => {
  it('listens only on 127.0.0.1, wrong state — 400 and keeps waiting, correct — returns code and closes', async () => {
    const loopback = await startLoopback({ state: STATE, timeoutMs: 10_000 });
    expect(loopback.port).toBeGreaterThanOrEqual(1024);
    expect((servers.at(-1)?.address() as AddressInfo).address).toBe('127.0.0.1');
    const wrong = await get(loopback.port, '/callback?code=ABCDEF23&state=other');
    expect(wrong.status).toBe(400);
    const done = await get(loopback.port, `/callback?code=ABCDEF23&state=${STATE}`);
    expect(done.status).toBe(200);
    expect(done.headers['content-security-policy']).toContain("default-src 'none'");
    expect(done.headers['cache-control']).toBe('no-store');
    expect(done.body).toContain(ru.account.callback.doneTitle);
    await expect(loopback.result).resolves.toEqual({ kind: 'code', code: 'ABCDEF23' });
    await expect(get(loopback.port, `/callback?code=ABCDEF23&state=${STATE}`)).rejects.toThrow();
  });

  it('timeout closes the server', async () => {
    const loopback = await startLoopback({ state: STATE, timeoutMs: 30 });
    await expect(loopback.result).resolves.toEqual({ kind: 'timeout' });
    await expect(get(loopback.port, '/callback')).rejects.toThrow();
  });

  it('close() — result is closed', async () => {
    const loopback = await startLoopback({ state: STATE, timeoutMs: 10_000 });
    loopback.close();
    await expect(loopback.result).resolves.toEqual({ kind: 'closed' });
  });
});
