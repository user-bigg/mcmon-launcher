import { describe, expect, it } from 'vitest';
import { isHttpsUrl, urlHost } from './links';

describe('external links', () => {
  it('allows only https', () => {
    expect(isHttpsUrl('https://mc-mon.ru/server/x')).toBe(true);
    expect(isHttpsUrl('http://mc-mon.ru/')).toBe(false);
    expect(isHttpsUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('mc-mon.ru')).toBe(false);
    expect(isHttpsUrl(42)).toBe(false);
  });

  it('the host exists only for an https address', () => {
    expect(urlHost('https://technograd.example/launcher')).toBe('technograd.example');
    expect(urlHost('ftp://technograd.example/')).toBeNull();
  });
});
