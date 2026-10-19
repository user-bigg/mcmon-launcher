import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

function parse(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(';').map((directive) => {
      const [name = '', ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe('contentSecurityPolicy', () => {
  it('in a build, allows only its own origin, each directive in full', () => {
    const csp = parse(contentSecurityPolicy(undefined));
    expect(Object.fromEntries(csp)).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'"],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
      'frame-ancestors': ["'none'"],
    });
  });

  it('in development, adds the dev server and websocket for HMR', () => {
    const csp = parse(contentSecurityPolicy('http://localhost:5173/'));
    expect(csp.get('connect-src')).toEqual([
      "'self'",
      'http://localhost:5173',
      'ws://localhost:5173',
    ]);
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('img-src')).toEqual(["'self'", 'app://launcher']);
  });
});
