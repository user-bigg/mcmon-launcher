// @vitest-environment happy-dom
import { flushPromises, type DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountState, AccountUser, PinnedNick } from '@shared/account';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { SERVER_IDS } from '../mock/servers';
import { openScreen, unmountScreen } from '../screen-testing';
import {
  emptyMicrosoftState,
  mountAt,
  stubLauncher,
  TEST_USER,
  testCard,
  withCard,
  type Mounted,
  type Stub,
} from '../testing';

let mounted: Mounted | undefined;

afterEach(unmountScreen);

afterEach(() => {
  mounted?.app.unmount();
  mounted = undefined;
  document.body.replaceChildren();
  localStorage.clear();
});

function state(patch: Partial<AccountState> = {}): AccountState {
  return { seq: 1, encryptionAvailable: true, user: null, connect: null, error: null, ...patch };
}

async function open(path: string, stub: Stub): Promise<Mounted> {
  mounted = await mountAt(path, { stub, demo: false });
  return mounted;
}

function button(app: Mounted['app'], text: string): DOMWrapper<Element> {
  const found = app.findAll('button').find((item) => item.text().includes(text));
  if (found === undefined) {
    throw new Error(`button ${text} missing`);
  }
  return found;
}

describe('signing into an MC Monitor account', () => {
  it("'Sign in via the site' → waiting for the browser, a manual code, and cancel", async () => {
    const stub = stubLauncher();
    const waiting = state({
      seq: 2,
      connect: { phase: 'waiting', expiresAt: '2026-10-03T12:05:00Z' },
    });
    stub.api.account.connect = vi.fn(() => Promise.resolve({ ok: true as const, value: waiting }));
    stub.api.account.submitCode = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'invalid_code' as const } }),
    );
    const { app } = await open('/accounts', stub);
    await button(app, ru.welcome.mcSignIn).trigger('click');
    await flushPromises();
    const connect = app.find('[data-login="wait"]');
    expect(connect.text()).toContain(ru.welcome.waiting);
    expect(connect.text()).toContain(fill(ru.welcome.left, { time: '5:00' }));
    await button(app, ru.welcome.reopen).trigger('click');
    expect(stub.api.account.reopen).toHaveBeenCalledTimes(1);
    expect(stub.api.account.connect).toHaveBeenCalledTimes(1);
    await button(app, ru.welcome.manual).trigger('click');
    await app.find('[data-login="wait"] input').setValue('abcd-ef23');
    await app.find('[data-login="wait"] form').trigger('submit');
    await flushPromises();
    expect(stub.api.account.submitCode).toHaveBeenCalledWith('abcd-ef23');
    expect(app.find('[data-login="wait"] [role="alert"]').text()).toBe(
      ru.welcome.codeErrors.invalid,
    );
    await button(app, ru.welcome.cancel).trigger('click');
    expect(stub.api.account.cancel).toHaveBeenCalled();
    expect(app.find('input[type="password"]').exists()).toBe(false);
  });

  it("after signing in: name, votes, favorites, 'Vote ×2', sign out", async () => {
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => Promise.resolve(state({ user: TEST_USER })));
    stub.api.site.favorites = vi.fn(() => Promise.resolve({ ok: true as const, value: [1, 2] }));
    stub.api.account.logout = vi.fn(() =>
      Promise.resolve({ ok: true as const, value: state({ seq: 2 }) }),
    );
    const { app } = await open('/accounts', stub);
    expect(app.find('[data-mc="signed-in"]').text()).toContain(TEST_USER.name);
    expect(app.find('[data-mc="reason"]').exists()).toBe(false);
    expect(app.find('[data-mc="votes"] dt').text()).toBe(ru.accounts.mcVotes);
    expect(app.find('[data-mc="votes"] dd').text()).toBe('4');
    expect(stub.api.account.refresh).toHaveBeenCalled();
    await button(app, ru.accounts.signOut).trigger('click');
    await flushPromises();
    expect(stub.api.account.logout).toHaveBeenCalled();
    expect(app.find('[data-mc="signed-out"]').exists()).toBe(true);
  });

  it('an untrusted account shows only the reason from the site, nothing when it is null', async () => {
    const reason = 'Подтвердите почту';
    const withReason = stubLauncher();
    withReason.api.account.state = vi.fn(() =>
      Promise.resolve(state({ user: { ...TEST_USER, trusted: false, trustedReason: reason } })),
    );
    const first = await open('/accounts', withReason);
    expect(first.app.find('[data-mc="reason"]').text()).toBe(reason);
    unmountScreen();
    const silent = stubLauncher();
    silent.api.account.state = vi.fn(() =>
      Promise.resolve(state({ user: { ...TEST_USER, trusted: false, trustedReason: null } })),
    );
    const second = await open('/accounts', silent);
    expect(second.app.find('[data-mc="reason"]').exists()).toBe(false);
  });

  it('own votes for the month: the number, a dash while the site has not answered', async () => {
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() =>
      Promise.resolve(state({ user: { ...TEST_USER, votesMonth: 18, hoursPlayed: null } })),
    );
    const { app } = await open('/accounts', stub);
    const values = app.findAll('.stats dd').map((item) => item.text());
    expect(values).toEqual(['18', '2', '—']);
  });

  it('without encryption sign-in is unavailable and explained', async () => {
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => Promise.resolve(state({ encryptionAvailable: false })));
    const { app } = await open('/accounts', stub);
    expect(app.find('[data-mc="signed-out"]').text()).toContain(ru.account.noEncryption);
    expect(button(app, ru.welcome.mcSignIn).attributes('disabled')).toBeDefined();
  });
});

const LOCAL_PLAYERS = {
  nicks: [{ id: 'nick-local', nick: 'Local_Nick' }],
  active: { kind: 'nick' as const, id: 'nick-local' },
};

function pinnedUser(nick: PinnedNick | null): AccountUser {
  return { ...TEST_USER, nick };
}

function signedIn(nick: PinnedNick | null): Stub {
  const stub = stubLauncher();
  const signed = state({ user: pinnedUser(nick) });
  stub.players.stored = LOCAL_PLAYERS;
  stub.api.account.state = vi.fn(() => Promise.resolve(signed));
  stub.api.account.refresh = vi.fn(() => Promise.resolve({ ok: true as const, value: signed }));
  return stub;
}

describe('nickname pinned to the account', () => {
  it('the card is the site account; its nickname plays from the list and is managed on the site', async () => {
    const stub = signedIn({ name: 'Test_User', changeAt: null });
    const { app } = await open('/accounts', stub);
    expect(app.find('[data-mc="nick"]').text()).toBe(TEST_USER.name);
    expect(app.find('[data-mc="change"]').exists()).toBe(false);
    expect(app.find('form.nick').exists()).toBe(false);
    expect(app.find('[data-who="nick"]').text()).toBe(`${ru.accounts.whereNick}Test_User`);
    expect(app.find('.switcher .account-name').text()).toBe('Test_User');
  });

  it("the catalog filter 'fits my account' follows who goes into the game, not the local nickname", async () => {
    const pinned = signedIn({ name: 'Test_User', changeAt: null });
    pinned.players.stored = { nicks: [], active: null };
    const first = await open('/accounts', pinned);
    await first.router.push('/servers');
    await flushPromises();
    expect(button(first.app, ru.catalog.accountFits).attributes('aria-pressed')).toBe('true');
  });

  it('a site without pinned nicknames: the site name, the local nickname plays', async () => {
    const { app } = await open('/accounts', signedIn(null));
    expect(app.find('[data-mc="nick"]').text()).toBe(TEST_USER.name);
    expect(app.find('[data-mc="change"]').exists()).toBe(false);
    expect(app.find('form.nick').exists()).toBe(false);
    expect(app.find('[data-who="nick"]').text()).toBe(`${ru.accounts.whereNick}Local_Nick`);
  });

  it('signing out brings the local nickname back', async () => {
    const stub = signedIn({ name: 'Test_User', changeAt: null });
    stub.api.account.logout = vi.fn(() =>
      Promise.resolve({ ok: true as const, value: state({ seq: 2 }) }),
    );
    const { app } = await open('/accounts', stub);
    await button(app, ru.accounts.signOut).trigger('click');
    await flushPromises();
    expect(app.find('[data-who="nick"]').text()).toBe(`${ru.accounts.whereNick}Local_Nick`);
    expect(stub.players.stored.nicks.map((item) => item.nick)).toEqual(['Local_Nick', 'Test_User']);
  });

  it('signed in without a site nickname: the game goes under the nickname from the list', async () => {
    const stub = signedIn({ name: null, changeAt: null });
    withCard(stub, testCard({ access: { license: true, nick: true } }));
    const { app } = await open(`/server/${String(SERVER_IDS.wasteland)}`, stub);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    expect(stub.api.launch.launch).toHaveBeenCalledWith(
      expect.objectContaining({ account: { kind: 'nick', nick: 'Local_Nick' } }),
    );
  });
});

describe('vote on the server page', () => {
  it("a guest — 'Vote on the site' opens /votes#vote", async () => {
    const stub = stubLauncher();
    withCard(stub, testCard());
    const { app } = await open(`/server/${String(SERVER_IDS.wasteland)}`, stub);
    await button(app, ru.serverPage.voteOnSite).trigger('click');
    expect(stub.api.openExternal).toHaveBeenCalledWith(`${testCard().site_url}/votes#vote`);
    expect(stub.api.site.vote).not.toHaveBeenCalled();
  });

  it('with an account: a pause from my_vote with a countdown, the button is disabled', async () => {
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => Promise.resolve(state({ user: TEST_USER })));
    withCard(stub, testCard({ my_vote: { can_vote_at: '2026-10-03T17:30:00Z' } }));
    const { app } = await open(`/server/${String(SERVER_IDS.wasteland)}`, stub);
    const vote = app.find('[data-vote]');
    expect(vote.text()).toContain(ru.serverPage.voteAccepted);
    const action = vote.find('.vote-action');
    expect(action.text()).toBe(fill(ru.serverPage.voteAgainIn, { time: '6\u00a0ч' }));
    expect(action.attributes('disabled')).toBeDefined();
  });

  it("with an account: a vote with the active account's nickname and 'Vote ×2'", async () => {
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => Promise.resolve(state({ user: TEST_USER })));
    withCard(stub, testCard({ my_vote: { can_vote_at: null } }));
    stub.api.site.vote = vi.fn().mockResolvedValueOnce({
      ok: true,
      value: { nextVoteAt: '2026-10-04T12:00:00Z', weight: 2 },
    });
    const { app, router } = await open('/welcome', stub);
    await app.find('.nick input').setValue('Steve_01');
    await app.find('.nick').trigger('submit');
    await router.push(`/server/${String(SERVER_IDS.wasteland)}`);
    await flushPromises();
    expect(app.find('[data-vote]').text()).toContain(ru.serverPage.voteWeight);
    expect(app.find('[data-vote]').text()).toContain(
      fill(ru.serverPage.voteNick, { nick: 'Steve_01' }),
    );
    await button(app, ru.serverPage.vote).trigger('click');
    await flushPromises();
    expect(stub.api.site.vote).toHaveBeenCalledWith(SERVER_IDS.wasteland, 'Steve_01');
    expect(app.find('[data-vote]').text()).toContain(ru.serverPage.voteAccepted);
    expect(app.find('.vote-action').text()).toBe(
      fill(ru.serverPage.voteAgainIn, { time: '24\u00a0ч' }),
    );
  });

  it('an offline server: a down status and voting disabled with a label', async () => {
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => Promise.resolve(state({ user: TEST_USER })));
    withCard(stub, testCard({ status: 'offline', my_vote: { can_vote_at: null } }));
    const { app, router } = await open('/welcome', stub);
    await app.find('.nick input').setValue('Steve_01');
    await app.find('.nick').trigger('submit');
    await router.push(`/server/${String(SERVER_IDS.wasteland)}`);
    await flushPromises();
    expect(app.find('[data-vote]').text()).toContain(ru.serverPage.voteOffline);
    expect(app.find('.stats .dot').classes()).toContain('is-down');
    expect(button(app, ru.serverPage.vote).attributes('disabled')).toBeDefined();
  });

  it('captcha_required — the first vote is confirmed on the site, with a button', async () => {
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => Promise.resolve(state({ user: TEST_USER })));
    withCard(stub, testCard({ edition: 'bedrock', my_vote: { can_vote_at: null } }));
    stub.api.site.vote = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'captcha_required' as const } }),
    );
    const { app, router } = await open('/welcome', stub);
    await app.find('.nick input').setValue('Steve_01');
    await app.find('.nick').trigger('submit');
    await router.push(`/server/${String(SERVER_IDS.wasteland)}`);
    await flushPromises();
    await button(app, ru.serverPage.vote).trigger('click');
    await flushPromises();
    expect(app.find('.vote-error').text()).toBe(ru.account.errors.captcha_required);
    await app.find('.vote-site').trigger('click');
    expect(stub.api.openExternal).toHaveBeenCalledWith(`${testCard().site_url}/votes#vote`);
  });

  it('vote_paused — human text with Moscow time', async () => {
    const stub = stubLauncher();
    stub.api.account.state = vi.fn(() => Promise.resolve(state({ user: TEST_USER })));
    withCard(stub, testCard({ edition: 'bedrock', my_vote: { can_vote_at: null } }));
    stub.api.site.vote = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'vote_paused' as const, nextVoteAt: '2026-10-04T09:15:00Z' },
      }),
    );
    const { app, router } = await open('/welcome', stub);
    await app.find('.nick input').setValue('Steve_01');
    await app.find('.nick').trigger('submit');
    await router.push(`/server/${String(SERVER_IDS.wasteland)}`);
    await flushPromises();
    await button(app, ru.serverPage.vote).trigger('click');
    await flushPromises();
    expect(app.find('[role="alert"]').text()).toBe(
      fill(ru.account.errors.vote_paused, { time: '12:15' }),
    );
  });
});

describe('nickname account after a restart', () => {
  it('the nickname from sign-in is saved in main and greets again on the home screen', async () => {
    const stub = stubLauncher();
    const first = await open('/welcome', stub);
    await first.app.find('.nick input').setValue('ArtDirector');
    await first.app.find('.nick-submit').trigger('click');
    await flushPromises();
    expect(stub.players.stored).toEqual({
      nicks: [{ id: 'nick-artdirector', nick: 'ArtDirector' }],
      active: { kind: 'nick', id: 'nick-artdirector' },
      picked: true,
    });
    first.app.unmount();
    document.body.replaceChildren();
    const again = await open('/', stub);
    expect(again.app.find('h1').text()).toContain('ArtDirector');
    expect(again.app.find('.account').attributes('aria-label')).toContain('ArtDirector');
  });
});

describe('account screen', () => {
  it('says who goes to nickname servers and who to licence servers', async () => {
    const { app } = await openScreen('/accounts');
    expect(app.find('[data-who="nick"]').text()).toBe(`${ru.accounts.whereNick}Frostbyte`);
    expect(app.find('[data-who="license"]').text()).toBe(`${ru.accounts.whereLicense}Kotofey`);
    expect(app.find('.landscape').exists()).toBe(false);
  });

  it('with no accounts the field adds the first nickname, an invalid one is not saved', async () => {
    const stub = stubLauncher();
    stub.players.stored = { nicks: [], active: null };
    const { app } = await open('/accounts', stub);
    const input = app.find('.nick input');
    await input.setValue('ab');
    await app.find('.nick').trigger('submit');
    expect(app.find('#nick-error').text()).toBe(ru.welcome.nickError);
    await input.setValue('First_Nick');
    await app.find('.nick').trigger('submit');
    await flushPromises();
    expect(app.find('form.nick').exists()).toBe(false);
    expect(app.find('.switcher .account-name').text()).toBe('First_Nick');
  });

  it('after signing out — sign in via MC Monitor, without a password field', async () => {
    const { app } = await openScreen('/accounts');
    const signOut = app.findAll('button').find((item) => item.text() === ru.accounts.signOut);
    await signOut?.trigger('click');
    expect(app.find('[data-mc="signed-out"]').text()).toContain(ru.welcome.mcSignIn);
    expect(app.find('input[type="password"]').exists()).toBe(false);
  });

  it('a sign-in error keeps the licence row and its disconnect button, an expired one is marked', async () => {
    const stub = stubLauncher();
    const license = { id: 'ms-1', nick: 'Frostbyte', uuid: 'u', status: 'needs-login' as const };
    stub.api.microsoft.state = vi.fn(() =>
      Promise.resolve({
        ...emptyMicrosoftState,
        available: true,
        accounts: [license],
        error: { code: 'timeout' as const },
      }),
    );
    const { app } = await open('/accounts', stub);
    const section = app.find('section[data-license]');
    expect(section.text()).toContain(ru.microsoft.errors.timeout.title);
    expect(app.find('[data-who="all"]').text()).toContain('Frostbyte');
    expect(app.find('[data-who="all"]').text()).toContain(ru.accounts.needsLogin);
    await button(app, ru.accounts.licenseRemove).trigger('click');
    expect(stub.api.microsoft.remove).toHaveBeenCalledWith('ms-1');
  });
});
