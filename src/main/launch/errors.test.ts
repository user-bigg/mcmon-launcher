import { describe, expect, it } from 'vitest';
import type { LaunchError } from '@shared/launch';
import { failure, toLaunchError } from './errors';

function systemError(code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`${code}: something`), { code, ...extra });
}

describe('toLaunchError', () => {
  it('our own errors pass through unchanged', () => {
    const error: LaunchError = { code: 'java-missing', component: 'jre-legacy', major: 8 };
    expect(toLaunchError(failure(error))).toEqual(error);
  });

  it('space, permissions and network from Node error codes', () => {
    expect(toLaunchError(systemError('ENOSPC', { path: '/g/assets/x' }))).toEqual({
      code: 'disk-full',
      path: '/g/assets/x',
      bytesNeeded: null,
    });
    expect(toLaunchError(systemError('EACCES', { path: '/g' }))).toEqual({
      code: 'permission-denied',
      path: '/g',
    });
    expect(toLaunchError(systemError('EPERM'))).toEqual({ code: 'permission-denied', path: null });
    expect(toLaunchError(systemError('ENOTFOUND'))).toEqual({
      code: 'network',
      url: null,
      reason: 'dns',
    });
    expect(toLaunchError(systemError('UND_ERR_CONNECT_TIMEOUT'))).toEqual({
      code: 'network',
      url: null,
      reason: 'timeout',
    });
  });

  it('file busy, disappeared after retries, ran out of file descriptors', () => {
    expect(toLaunchError(systemError('EBUSY', { path: '/g/x.jar' }))).toEqual({
      code: 'file-locked',
      path: '/g/x.jar',
    });
    expect(toLaunchError(systemError('ENOENT', { path: '/g/y.jar' }))).toEqual({
      code: 'file-missing',
      path: '/g/y.jar',
    });
    expect(toLaunchError(systemError('EMFILE'))).toEqual({ code: 'too-many-files' });
  });

  it.each([
    'SELF_SIGNED_CERT_IN_CHAIN',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'ERR_SSL_WRONG_VERSION_NUMBER',
  ])('TLS error %s: network with the tls subcode', (code) => {
    const fetchFailed = new TypeError('fetch failed', { cause: systemError(code) });
    expect(toLaunchError(fetchFailed)).toEqual({ code: 'network', url: null, reason: 'tls' });
  });

  it('Chromium errors from net.fetch are parsed from the net::ERR_ text', () => {
    const error = (name: string): Error =>
      Object.assign(new Error(`net::${name}`), { downloadUrl: 'https://piston-meta.mojang.com/x' });
    expect(toLaunchError(error('ERR_CERT_AUTHORITY_INVALID'))).toMatchObject({ reason: 'tls' });
    expect(toLaunchError(error('ERR_PROXY_CONNECTION_FAILED'))).toMatchObject({
      reason: 'proxy',
    });
    expect(toLaunchError(error('ERR_NAME_NOT_RESOLVED'))).toEqual({
      code: 'network',
      url: 'https://piston-meta.mojang.com/x',
      reason: 'dns',
    });
    expect(toLaunchError(error('ERR_INTERNET_DISCONNECTED'))).toMatchObject({
      reason: 'connection',
    });
    expect(toLaunchError(error('ERR_ABORTED'))).toEqual({ code: 'cancelled' });
  });

  it('fetch failed: reason from cause, address from the wrapper; timeout is network', () => {
    const wrapped = Object.assign(
      new TypeError('fetch failed', { cause: systemError('ECONNRESET') }),
      {
        downloadUrl: 'https://piston-meta.mojang.com/v1/x.json',
      },
    );
    expect(toLaunchError(wrapped)).toEqual({
      code: 'network',
      url: 'https://piston-meta.mojang.com/v1/x.json',
      reason: 'connection',
    });
    expect(toLaunchError(new DOMException('timeout', 'TimeoutError'))).toEqual({
      code: 'network',
      url: null,
      reason: 'timeout',
    });
  });

  it('@xmcl/file-transfer download error — network with address', () => {
    const error = Object.assign(new Error('HTTP Error: 503 Service Unavailable'), {
      name: 'DownloadError',
      statusCode: 503,
      downloadUrls: JSON.stringify(['https://piston-data.mojang.com/v1/objects/abc/client.jar']),
    });
    expect(toLaunchError(error)).toEqual({
      code: 'network',
      url: 'https://piston-data.mojang.com/v1/objects/abc/client.jar',
      reason: 'http',
    });
  });

  it('file downloaded but the hash did not match', () => {
    const error = new Error(
      'Cannot recover 2 install file(s): /g/libraries/a.jar, /g/libraries/b.jar',
    );
    expect(toLaunchError(error)).toEqual({ code: 'checksum-mismatch', file: '/g/libraries/a.jar' });
  });

  it('cancellation takes priority over other errors in AggregateError', () => {
    const aggregate = new AggregateError([
      systemError('ECONNRESET'),
      new DOMException('aborted', 'AbortError'),
    ]);
    expect(toLaunchError(aggregate)).toEqual({ code: 'cancelled' });
    const diskAndNetwork = new AggregateError([systemError('ECONNRESET'), systemError('ENOSPC')]);
    expect(toLaunchError(diskAndNetwork).code).toBe('disk-full');
  });

  it('@xmcl/core precheck before launch', () => {
    expect(toLaunchError({ error: 'CorruptedVersionJar', version: '1.21' })).toEqual({
      code: 'checksum-mismatch',
      file: 'client.jar',
    });
  });

  it('unknown error — first line of the message without the stack', () => {
    const error = new Error('Something odd\n    at secret (/Users/me/file.ts:1:1)');
    expect(toLaunchError(error)).toEqual({ code: 'unknown', message: 'Something odd' });
    expect(toLaunchError('строка')).toEqual({ code: 'unknown', message: 'строка' });
    expect(toLaunchError(null)).toEqual({ code: 'unknown', message: 'null' });
  });
});
