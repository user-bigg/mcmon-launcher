import { describe, expect, it, vi } from 'vitest';
import { bestEffort, withFsRetry } from './fs-retry';

function fsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('withFsRetry', () => {
  it('on Windows retries EPERM, EACCES and EBUSY with a delay', async () => {
    let attempt = 0;
    const operation = vi.fn(() => {
      attempt += 1;
      const codes = ['EPERM', 'EBUSY', 'EACCES'];
      const code = codes[attempt - 1];
      return code === undefined ? Promise.resolve('ok') : Promise.reject(fsError(code));
    });
    await expect(withFsRetry(operation, { platform: 'win32', backoffMs: [1, 1, 1] })).resolves.toBe(
      'ok',
    );
    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('gives up after all delays and leaves other errors and platforms alone', async () => {
    const busy = vi.fn(() => Promise.reject(fsError('EBUSY')));
    await expect(withFsRetry(busy, { platform: 'win32', backoffMs: [1, 1] })).rejects.toThrow(
      'EBUSY',
    );
    expect(busy).toHaveBeenCalledTimes(3);
    const missing = vi.fn(() => Promise.reject(fsError('ENOENT')));
    await expect(withFsRetry(missing, { platform: 'win32', backoffMs: [1] })).rejects.toThrow();
    expect(missing).toHaveBeenCalledTimes(1);
    const mac = vi.fn(() => Promise.reject(fsError('EPERM')));
    await expect(withFsRetry(mac, { platform: 'darwin', backoffMs: [1] })).rejects.toThrow();
    expect(mac).toHaveBeenCalledTimes(1);
  });
});

describe('bestEffort', () => {
  it('an error turns into false', async () => {
    expect(await bestEffort(() => Promise.reject(new Error('x')))).toBe(false);
    expect(await bestEffort(() => Promise.resolve())).toBe(true);
  });
});
