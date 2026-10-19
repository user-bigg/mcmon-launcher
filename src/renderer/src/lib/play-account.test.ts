import { describe, expect, it } from 'vitest';
import { gameNick, pickPlayAccount } from './play-account';

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

describe('the nickname of a signed-in player', () => {
  it('without an account, or on a site that pins nothing, the local nickname plays', () => {
    expect(gameNick('Kotofey', null)).toBe('Kotofey');
    expect(gameNick(null, null)).toBeNull();
  });

  it('signed in: only the pinned nickname, the local one is not used', () => {
    expect(gameNick('Kotofey', { name: 'Test_User', changeAt: null })).toBe('Test_User');
  });

  it('signed in with no nickname picked yet: nobody to play as, the local one is no fallback', () => {
    const picked = pickPlayAccount('nick', {
      nick: gameNick('Kotofey', { name: null, changeAt: null }),
      licenseId: 'ms-1',
    });
    expect(picked).toEqual({ ok: false, missing: 'nick' });
  });
});
