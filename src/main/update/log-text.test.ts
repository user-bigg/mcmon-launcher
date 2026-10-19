import { createHttpError } from 'builder-util-runtime';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { logTextOf } from './log-text';

const SESSION = 'mcmon_session=eyJpdiI6IkFCQyIsInZhbHVlIjoiWFlaIn0%3D; path=/; secure; httponly';

function siteResponse(status: number, message: string): IncomingMessage {
  return {
    statusCode: status,
    statusMessage: message,
    headers: {
      server: 'nginx',
      'content-type': 'text/html; charset=UTF-8',
      'set-cookie': [SESSION, 'theme=dark; path=/'],
      authorization: 'Bearer secret-token',
    },
  } as unknown as IncomingMessage;
}

describe('update log lines', () => {
  it('an HTTP error of electron-updater gives the status only, without the headers', () => {
    const error = createHttpError(siteResponse(403, 'Forbidden'));
    expect(logTextOf(error)).toBe('HTTP 403');
  });

  it('the stack that electron-updater hands to its logger loses everything after the first line', () => {
    const error = createHttpError(siteResponse(404, 'Not Found'));
    const line = logTextOf(`Error: ${error.stack ?? ''}`);
    expect(line).toBe('Error: HttpError: 404 Not Found');
    expect(line).not.toMatch(/cookie|session|Bearer|nginx/i);
  });

  it('says Error once when the logger prefixes a stack that starts with it', () => {
    const missing = new Error('Cannot find channel "latest.yml" update info: HttpError: 404');
    expect(logTextOf(`Error: ${missing.stack ?? ''}`)).toBe(
      'Error: Cannot find channel "latest.yml" update info: HttpError: 404',
    );
  });

  it('cuts a header that sits on the first line and a bearer token', () => {
    expect(logTextOf('failed Headers: {"set-cookie":"a=b"}')).toBe('failed');
    expect(logTextOf('request failed, set-cookie: mcmon_session=xyz')).toBe(
      'request failed, set-cookie: [removed]',
    );
    expect(logTextOf(new Error('Authorization: Bearer abc.def'))).toBe('Authorization: [removed]');
    expect(logTextOf('sent Bearer abc.def to the site')).toBe('sent Bearer [removed] to the site');
  });

  it('keeps a network code and makes a long line short', () => {
    const offline = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    expect(logTextOf(offline)).toBe('ENOTFOUND getaddrinfo ENOTFOUND');
    expect(logTextOf('x'.repeat(500))).toHaveLength(201);
  });
});
