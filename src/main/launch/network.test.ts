import { describe, expect, it } from 'vitest';
import { proxyFromPac } from './network';

describe('proxyFromPac', () => {
  it("takes the first HTTP(S) proxy from resolveProxy's response", () => {
    expect(proxyFromPac('DIRECT')).toBeNull();
    expect(proxyFromPac('PROXY proxy.corp:3128; DIRECT')).toBe('http://proxy.corp:3128');
    expect(proxyFromPac('HTTPS secure.corp:443')).toBe('https://secure.corp:443');
    expect(proxyFromPac('SOCKS5 socks.corp:1080; PROXY p:8080')).toBe('http://p:8080');
    expect(proxyFromPac('SOCKS5 socks.corp:1080')).toBeNull();
    expect(proxyFromPac('PROXY evil/path:80')).toBeNull();
  });
});
