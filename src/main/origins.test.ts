import { describe, expect, it } from 'vitest';
import { APP_INDEX_URL, isTrustedUrl, trustedOrigin } from './origins';

describe('isTrustedUrl', () => {
  it('in production, only app://launcher is trusted', () => {
    expect(isTrustedUrl(APP_INDEX_URL, undefined)).toBe(true);
    expect(isTrustedUrl('app://launcher/assets/x.js', undefined)).toBe(true);
    expect(isTrustedUrl('app://other/index.html', undefined)).toBe(false);
    expect(isTrustedUrl('https://mcmonitor.example/', undefined)).toBe(false);
    expect(isTrustedUrl('file:///index.html', undefined)).toBe(false);
  });

  it('in development, only the dev server is trusted', () => {
    const dev = 'http://localhost:5173/';
    expect(trustedOrigin(dev)).toBe('http://localhost:5173');
    expect(isTrustedUrl('http://localhost:5173/index.html', dev)).toBe(true);
    expect(isTrustedUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isTrustedUrl(APP_INDEX_URL, dev)).toBe(false);
  });

  it('does not throw on garbage input', () => {
    expect(isTrustedUrl('', undefined)).toBe(false);
    expect(isTrustedUrl('not a url', undefined)).toBe(false);
  });
});
