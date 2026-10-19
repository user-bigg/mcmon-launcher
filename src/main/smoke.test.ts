import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, ipcMain: {}, BrowserWindow: {} }));

const { isSmokeRun } = await import('./smoke');

describe('isSmokeRun', () => {
  it('both the environment variable and the --smoke argument are required', () => {
    expect(isSmokeRun({ MCMONITOR_SMOKE: '1' }, ['exe', '--smoke'])).toBe(true);
    expect(isSmokeRun({ MCMONITOR_SMOKE: '1' }, ['exe'])).toBe(false);
    expect(isSmokeRun({}, ['exe', '--smoke'])).toBe(false);
  });
});
