import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: {}, ipcMain: {}, app: {} }));

const { createSystemService, graphicsOf } = await import('./system');

describe('system', () => {
  it('returns memory size in megabytes, rounding down', async () => {
    const service = createSystemService(() => 16 * 1024 ** 3 + 1_000_000);
    expect(await service.memory()).toEqual({
      ok: true,
      value: { totalMb: 16384, defaultGameMb: 4096 },
    });
  });

  it('gives the memory a server launch passes to -Xmx when the player chose none', async () => {
    const vm = createSystemService(() => 6 * 1024 ** 3 - 200 * 1024 ** 2);
    const result = await vm.memory();
    expect(result.ok && result.value.defaultGameMb).toBe(3072);
  });

  it('returns the Java versions found on disk', async () => {
    const service = createSystemService(
      () => 0,
      () => Promise.resolve([21, 8]),
    );
    expect(await service.java()).toEqual({ ok: true, value: { installed: [21, 8] } });
  });
});

describe('graphics', () => {
  const sandyBridge = [{ vendor: 0x8086, device: 0x0106, name: 'Intel(R) HD Graphics' }];

  it('a Windows computer with an old Intel chip runs up to 1.16.5, a Mac has no ceiling', () => {
    expect(graphicsOf('win32', sandyBridge)).toEqual({
      ceiling: '1.16.5',
      gpu: 'Intel(R) HD Graphics',
    });
    expect(graphicsOf('darwin', sandyBridge)).toEqual({ ceiling: null, gpu: null });
  });
});
