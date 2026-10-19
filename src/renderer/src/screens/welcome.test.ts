// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { MicrosoftState } from '@shared/microsoft';
import { mountScreen, openScreen as open, unmountScreen } from '../screen-testing';
import { emptyMicrosoftState, stubLauncher, TEST_USER, type Mounted, type Stub } from '../testing';

afterEach(unmountScreen);

function microsoft(patch: Partial<MicrosoftState> = {}): MicrosoftState {
  return { ...emptyMicrosoftState, seq: 1, available: true, ...patch };
}

function withMicrosoft(state: MicrosoftState): Stub {
  const stub = stubLauncher();
  stub.api.microsoft.state = vi.fn(() => Promise.resolve(state));
  return stub;
}

function live(stub: Stub): Promise<Mounted> {
  return mountScreen('/welcome', { stub, demo: false });
}

function buttons(app: Mounted['app']): string[] {
  return app.findAll('button').map((item) => item.text());
}

describe('sign-in screen', () => {
  it('shows three ways in and hides the licence when Microsoft sign-in is off', async () => {
    const { app } = await live(withMicrosoft(microsoft()));
    expect(app.find('.sidebar').exists()).toBe(false);
    expect(buttons(app)).toEqual(
      expect.arrayContaining([ru.welcome.mcSignIn, ru.welcome.licenseAdd, ru.welcome.continue]),
    );
    expect(app.find('input[type="password"]').exists()).toBe(false);
    unmountScreen();
    const off = await live(withMicrosoft(microsoft({ available: false })));
    expect(off.app.find('[data-license]').exists()).toBe(false);
    expect(buttons(off.app)).not.toContain(ru.welcome.licenseAdd);
  });

  it('waiting turns the button into cancel with a countdown and mutes the other ways', async () => {
    const stub = withMicrosoft(microsoft());
    const waiting = microsoft({
      seq: 2,
      login: { phase: 'waiting', expiresAt: '2026-10-03T12:01:12Z' },
    });
    stub.api.microsoft.login = vi.fn(() => Promise.resolve({ ok: true as const, value: waiting }));
    const { app } = await live(stub);
    await app.find('[data-license] button').trigger('click');
    await flushPromises();
    const license = app.find('[data-license]');
    expect(license.text()).toContain(fill(ru.welcome.left, { time: '1:12' }));
    expect(buttons(app)).not.toContain(ru.welcome.licenseAdd);
    expect(app.find('[data-mc="signed-out"] button').attributes('disabled')).toBeDefined();
    expect(app.find('.nick-submit').attributes('disabled')).toBeDefined();
    await license.find('button').trigger('click');
    expect(stub.api.microsoft.cancel).toHaveBeenCalled();
  });

  it('an error shows a title, one sentence and a retry button', async () => {
    const { app } = await live(withMicrosoft(microsoft({ error: { code: 'not_owned' } })));
    const note = app.find('[data-license] [role="alert"]');
    expect(note.find('b').text()).toBe(ru.microsoft.errors.not_owned.title);
    expect(note.text()).toContain(ru.microsoft.errors.not_owned.text);
    expect(app.find('[data-license] .lx-auth-btn').text()).toBe(ru.welcome.retryOther);
  });

  it('an invalid nickname — an error with a hint, a valid one — an account and the home screen', async () => {
    const { app, router } = await live(stubLauncher());
    const input = app.find(`input[aria-label="${ru.welcome.nickLabel}"]`);
    expect((input.element as HTMLInputElement).value).toBe('');
    await app.find('form.nick').trigger('submit');
    expect(app.find('#nick-error').text()).toBe(ru.welcome.nickError);
    expect(input.attributes('aria-invalid')).toBe('true');
    await input.setValue('New_Player');
    await app.find('form.nick').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');
    expect(app.find('.account-name').text()).toBe('New_Player');
  });

  it('a nickname pinned to an account: an error under the field, the button is off until the field changes', async () => {
    const stub = stubLauncher();
    stub.api.account.playCheck = vi.fn(() => Promise.resolve({ kind: 'nick_taken' as const }));
    const { app, router } = await live(stub);
    const input = app.find(`input[aria-label="${ru.welcome.nickLabel}"]`);
    await input.setValue('Test_User');
    await app.find('form.nick').trigger('submit');
    await flushPromises();
    expect(stub.api.account.playCheck).toHaveBeenCalledWith({
      serverId: null,
      nick: 'Test_User',
      auth: 'nick',
    });
    expect(app.find('#nick-error').text()).toBe(ru.welcome.nickTaken);
    expect(app.find('.nick-submit').attributes('disabled')).toBeDefined();
    expect(router.currentRoute.value.path).toBe('/welcome');
    expect(stub.players.stored.nicks).toEqual([]);

    await input.setValue('Free_Nick');
    expect(app.find('#nick-error').exists()).toBe(false);
    expect(app.find('.nick-submit').attributes('disabled')).toBeUndefined();
  });

  it('the site is down or does not know the check: the nickname is let in', async () => {
    const stub = stubLauncher();
    stub.api.account.playCheck = vi.fn(() => Promise.reject(new Error('ipc failed')));
    const { app, router } = await live(stub);
    await app.find(`input[aria-label="${ru.welcome.nickLabel}"]`).setValue('Free_Nick');
    await app.find('form.nick').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');
    expect(stub.players.stored.nicks).toEqual([{ id: 'nick-free_nick', nick: 'Free_Nick' }]);
  });

  it('after signing in, a slow profile shows that work goes on and does not hold the screen for long', async () => {
    const stub = stubLauncher();
    const { app, router, emitAccount } = await live(stub);
    stub.api.account.refresh = vi.fn(() => new Promise<never>(() => undefined));
    vi.useFakeTimers();
    emitAccount({
      change: 'signed-in',
      state: { seq: 5, encryptionAvailable: true, user: TEST_USER, connect: null, error: null },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(app.find('[data-mc="finishing"]').text()).toBe(ru.welcome.exchanging);
    expect(router.currentRoute.value.path).toBe('/welcome');
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/accounts');
  });

  it('terms and the policy open in the browser', async () => {
    const { app, api } = await open('/welcome');
    const links = app.findAll('.terms a');
    await links[1]?.trigger('click');
    expect(api.openExternal).toHaveBeenCalledWith('https://mc-mon.ru/privacy');
  });

  it("'Pulse' of the hour fills the right side, no text lies on it", async () => {
    const { app } = await open('/welcome');
    const scene = app.find('.login > .scene .landscape');
    expect(scene.attributes('data-scene')).toBe('pulse-15-day');
    expect(scene.attributes('data-motion')).toBe('parallax');
    expect(app.find('.login > .scene').text()).toBe('');
    expect(document.activeElement?.tagName).not.toBe('INPUT');
  });
});
