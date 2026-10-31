import { describe, expect, it } from 'vitest';
import { pickPlayAccount } from './play-account';

const both = { nick: 'Kotofey', licenseId: 'ms-1' };
const nickOnly = { nick: 'Kotofey', licenseId: null };
const licenseOnly = { nick: null, licenseId: 'ms-1' };

describe('who goes into the game', () => {
  it('a licence-only server takes the licence and nothing else', () => {
    expect(pickPlayAccount('license', both)).toEqual({
      ok: true,
      account: { kind: 'account', id: 'ms-1' },
    });
    expect(pickPlayAccount('license', nickOnly)).toEqual({ ok: false, missing: 'license' });
  });

  it('a server open to nicknames takes the nickname even when a licence is connected', () => {
    expect(pickPlayAccount('nick', both)).toEqual({
      ok: true,
      account: { kind: 'nick', nick: 'Kotofey' },
    });
  });

  it('a missing nickname is never replaced by the licence', () => {
    expect(pickPlayAccount('nick', licenseOnly)).toEqual({ ok: false, missing: 'nick' });
  });
});

describe('the row chosen in the account list', () => {
  it('a chosen licence plays on a server open to nicknames too', () => {
    expect(pickPlayAccount('nick', { ...both, licenseChosen: true })).toEqual({
      ok: true,
      account: { kind: 'account', id: 'ms-1' },
    });
  });
});
