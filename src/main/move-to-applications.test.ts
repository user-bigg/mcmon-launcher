import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }));

const { replacesInstalled, shouldOfferMove } = await import('./move-to-applications');

describe('the offer to move the launcher to Applications', () => {
  const offer = {
    packaged: true,
    platform: 'darwin' as const,
    cannotUpdateHere: true,
    declined: false,
    startedByLink: false,
  };

  it('is made only to a packaged macOS launcher that cannot update where it runs', () => {
    expect(shouldOfferMove(offer)).toBe(true);
    expect(shouldOfferMove({ ...offer, cannotUpdateHere: false })).toBe(false);
    expect(shouldOfferMove({ ...offer, startedByLink: true })).toBe(false);
    expect(shouldOfferMove({ ...offer, declined: true })).toBe(false);
    expect(shouldOfferMove({ ...offer, packaged: false })).toBe(false);
    expect(shouldOfferMove({ ...offer, platform: 'win32' })).toBe(false);
  });

  it('replaces a copy in Applications only when that copy is older', () => {
    expect(replacesInstalled('0.1.0', '0.2.0')).toBe(true);
    expect(replacesInstalled(null, '0.2.0')).toBe(true);
    expect(replacesInstalled('0.2.0', '0.2.0')).toBe(false);
    expect(replacesInstalled('0.3.0', '0.2.0')).toBe(false);
  });
});
