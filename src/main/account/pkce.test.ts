import { describe, expect, it } from 'vitest';
import { challengeOf, createPkce } from './pkce';

describe('PKCE', () => {
  it('challenge — base64url(sha256(verifier)) from the RFC 7636 example', () => {
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('verifier is 43 base64url characters, state follows the site rule, both are fresh each time', () => {
    const first = createPkce();
    const second = createPkce();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.challenge).toBe(challengeOf(first.verifier));
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.state).not.toBe(second.state);
  });
});
