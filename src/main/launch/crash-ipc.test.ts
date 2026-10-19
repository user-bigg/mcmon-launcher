import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: {}, ipcMain: {} }));
const { parseFixRequest, parseAnalysisId } = await import('./crash-ipc');

describe('parsing requests to the crash service', () => {
  it('analysis id and fix number', () => {
    expect(parseFixRequest({ analysisId: '6a1f0e2d-9c8b-4a7f', fix: 1 })).toEqual({
      ok: true,
      value: { analysisId: '6a1f0e2d-9c8b-4a7f', fix: 1 },
    });
    expect(parseFixRequest({ analysisId: '6a1f0e2d-9c8b-4a7f', fix: 0, relaunch: true })).toEqual({
      ok: true,
      value: { analysisId: '6a1f0e2d-9c8b-4a7f', fix: 0, relaunch: true },
    });
    expect(parseFixRequest({ analysisId: '6a1f0e2d-9c8b-4a7f', fix: 0, relaunch: 'yes' }).ok).toBe(
      false,
    );
    expect(parseFixRequest({ analysisId: '../x', fix: 1 }).ok).toBe(false);
    expect(parseFixRequest({ analysisId: '6a1f0e2d-9c8b', fix: 1.5 }).ok).toBe(false);
    expect(parseFixRequest({ analysisId: '6a1f0e2d-9c8b', fix: -1 }).ok).toBe(false);
    expect(parseFixRequest({ analysisId: '6a1f0e2d-9c8b', fix: { type: 'disable-mod' } }).ok).toBe(
      false,
    );
    expect(parseFixRequest(null).ok).toBe(false);
    expect(parseAnalysisId('A'.repeat(10)).ok).toBe(false);
  });
});
