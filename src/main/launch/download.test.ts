import type { InstallMaterializeOperation, InstallRuntime } from '@xmcl/installer';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureFreeSpace,
  resilientRuntime,
  retryDelayMs,
  shouldRetryRequest,
  trustedCertificates,
} from './download';
import { LaunchFailure } from './errors';

vi.mock('node:tls', () => ({
  getCACertificates: (kind: string): string[] =>
    kind === 'system' ? ['shared', 'corporate'] : ['bundled', 'shared'],
}));

const MIB = 1024 * 1024;

describe('ensureFreeSpace', () => {
  it('requires download size plus a 256 MB margin', async () => {
    await expect(ensureFreeSpace('/g', 100 * MIB, () => Promise.resolve(400 * MIB))).resolves.toBe(
      undefined,
    );
    const error = await ensureFreeSpace('/g', 200 * MIB, () => Promise.resolve(400 * MIB)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(LaunchFailure);
    expect((error as LaunchFailure).error).toEqual({
      code: 'disk-full',
      path: '/g',
      bytesNeeded: 456 * MIB,
    });
  });

  it("nothing to download or statfs unavailable — doesn't block", async () => {
    const freeSpace = vi.fn(() => Promise.resolve(0));
    await ensureFreeSpace('/g', 0, freeSpace);
    expect(freeSpace).not.toHaveBeenCalled();
    await ensureFreeSpace('/g', MIB, () => Promise.reject(new Error('ENOSYS')));
  });
});

describe('request retries', () => {
  it('retries dropped connections, timeouts and 5xx, but not 404 or unrelated errors', () => {
    expect(shouldRetryRequest({ code: 'UND_ERR_BODY_TIMEOUT' }, 1)).toBe(true);
    expect(shouldRetryRequest({ code: 'ECONNRESET' }, 3)).toBe(true);
    expect(shouldRetryRequest({ code: 'ECONNRESET' }, 4)).toBe(false);
    expect(shouldRetryRequest({ code: 'UND_ERR_REQ_RETRY', statusCode: 503 }, 1)).toBe(true);
    expect(shouldRetryRequest({ code: 'UND_ERR_REQ_RETRY', statusCode: 404 }, 1)).toBe(false);
    expect(shouldRetryRequest({ code: 'CERT_HAS_EXPIRED' }, 1)).toBe(false);
  });

  it('backoff doubles and caps at 5s', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([500, 1000, 2000, 4000, 5000]);
  });
});

describe('trustedCertificates', () => {
  it('merges bundled and system root certificates without duplicates', () => {
    expect(trustedCertificates()).toEqual(['bundled', 'shared', 'corporate']);
  });
});

describe('resilientRuntime', () => {
  function runtimeWith(materialize: InstallRuntime['materialize']): InstallRuntime {
    return { materialize } as unknown as InstallRuntime;
  }

  it('hard link not supported — retries with a copy', async () => {
    const calls: InstallMaterializeOperation[][] = [];
    const runtime = resilientRuntime(
      runtimeWith((operations) => {
        calls.push(operations);
        if (operations.some((operation) => operation.type === 'link')) {
          return Promise.reject(Object.assign(new Error('link'), { code: 'EXDEV' }));
        }
        return Promise.resolve({
          commit: () => Promise.resolve(),
          rollback: () => Promise.resolve(),
        });
      }),
    );
    await runtime.materialize([{ type: 'link', source: '/a/sha.json', path: '/a/30.json' }]);
    expect(calls[1]).toEqual([{ type: 'copy', source: '/a/sha.json', path: '/a/30.json' }]);
  });

  it('other errors and operations without links are not substituted', async () => {
    const failing = resilientRuntime(
      runtimeWith(() => Promise.reject(Object.assign(new Error('full'), { code: 'ENOSPC' }))),
    );
    await expect(failing.materialize([{ type: 'link', source: '/a', path: '/b' }])).rejects.toThrow(
      'full',
    );
    await expect(failing.materialize([{ type: 'remove', path: '/b' }])).rejects.toThrow('full');
  });
});
