import { describe, expect, it, vi } from 'vitest';
import { rememberRegistryArch, storedRegistryArch } from './arch-memory';

interface Saved {
  schemaVersion: 1;
  registryArch: string;
}

interface Disk {
  data: unknown;
  saves: Saved[];
  load: () => Promise<unknown>;
  save: (data: Saved) => Promise<void>;
}

function disk(initial?: unknown): Disk {
  const state: Disk = {
    data: initial,
    saves: [],
    load: () => Promise.resolve(state.data),
    save: (data) => {
      state.data = data;
      state.saves.push(data);
      return Promise.resolve();
    },
  };
  return state;
}

function later<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('storedRegistryArch', () => {
  it('accepts only the file this launcher writes', () => {
    expect(storedRegistryArch({ schemaVersion: 1, registryArch: 'ARM64' })).toBe('ARM64');
    expect(storedRegistryArch({ schemaVersion: 2, registryArch: 'ARM64' })).toBeNull();
    expect(storedRegistryArch({ schemaVersion: 1, registryArch: 'ARM64\r\n..\\x' })).toBeNull();
    expect(storedRegistryArch({ schemaVersion: 1, registryArch: 64 })).toBeNull();
    expect(storedRegistryArch(undefined)).toBeNull();
    expect(storedRegistryArch('ARM64')).toBeNull();
  });
});

describe('rememberRegistryArch', () => {
  it('the first reading is waited for and saved', async () => {
    const files = disk();
    const read = vi.fn(() => Promise.resolve<string | null>('ARM64'));
    const arch = rememberRegistryArch({ read, load: files.load, save: files.save, log: vi.fn() });
    expect(await arch()).toBe('ARM64');
    expect(files.saves).toEqual([{ schemaVersion: 1, registryArch: 'ARM64' }]);
  });

  it('a remembered value is returned without waiting for the registry', async () => {
    const files = disk({ schemaVersion: 1, registryArch: 'AMD64' });
    const hanging = later<string | null>();
    const read = vi.fn(() => hanging.promise);
    const arch = rememberRegistryArch({ read, load: files.load, save: files.save, log: vi.fn() });
    expect(await arch()).toBe('AMD64');
    expect(await arch()).toBe('AMD64');
    expect(files.saves).toEqual([]);
    hanging.resolve('AMD64');
    await settle();
    expect(files.saves).toEqual([]);
  });

  it('a reading that came after the caller stopped waiting serves the next start', async () => {
    const files = disk();
    const slow = later<string | null>();
    const first = rememberRegistryArch({
      read: () => slow.promise,
      load: files.load,
      save: files.save,
      log: vi.fn(),
    });
    const waited = first();
    slow.resolve('ARM64');
    await waited;
    const hanging = (): Promise<string | null> => new Promise(() => undefined);
    const next = rememberRegistryArch({
      read: hanging,
      load: files.load,
      save: files.save,
      log: vi.fn(),
    });
    expect(await next()).toBe('ARM64');
  });

  it('a failed reading saves nothing and is tried again', async () => {
    const files = disk();
    const read = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('reg.exe'))
      .mockResolvedValue('ARM64');
    const arch = rememberRegistryArch({ read, load: files.load, save: files.save, log: vi.fn() });
    expect(await arch()).toBeNull();
    expect(await arch()).toBeNull();
    expect(files.saves).toEqual([]);
    expect(await arch()).toBe('ARM64');
    expect(files.saves).toHaveLength(1);
  });

  it('a value that changed is used from the next request and saved', async () => {
    const files = disk({ schemaVersion: 1, registryArch: 'ARM64' });
    const read = vi.fn(() => Promise.resolve<string | null>('AMD64'));
    const arch = rememberRegistryArch({ read, load: files.load, save: files.save, log: vi.fn() });
    expect(await arch()).toBe('ARM64');
    await settle();
    expect(await arch()).toBe('AMD64');
    expect(files.saves).toEqual([{ schemaVersion: 1, registryArch: 'AMD64' }]);
  });

  it('a file that cannot be read or written does not break the reading', async () => {
    const log = vi.fn();
    const arch = rememberRegistryArch({
      read: () => Promise.resolve('ARM64'),
      load: () => Promise.reject(new Error('EACCES')),
      save: () => Promise.reject(new Error('EACCES')),
      log,
    });
    expect(await arch()).toBe('ARM64');
    expect(log).toHaveBeenCalledWith('device: native_arch not saved');
  });
});
