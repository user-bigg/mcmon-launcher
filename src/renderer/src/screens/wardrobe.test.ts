// @vitest-environment happy-dom
import { flushPromises, type DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountState, AccountUser } from '@shared/account';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type {
  CapePreset,
  LookError,
  LookPresets,
  LookResult,
  SkinPreset,
  WornCape,
  WornSkin,
} from '@shared/look';
import type { SiteResult } from '@shared/site';
import { lookChange, lookErrorText, wornPresetId } from '../lib/wardrobe';
import { mountScreen, unmountScreen } from '../screen-testing';
import { stubLauncher, TEST_NOW, TEST_USER, type Mounted, type Stub } from '../testing';

vi.mock('../lib/figure', () => ({
  createFigure: (): Record<string, unknown> => ({
    setSkin: vi.fn(),
    setCape: vi.fn(),
    face: vi.fn(),
    setWalking: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }),
}));

afterEach(unmountScreen);

function skin(id: string, change: Partial<SkinPreset> = {}): SkinPreset {
  return {
    id,
    title: `Skin ${id}`,
    url: `app://launcher/cache/icons/${id}.png`,
    model: 'classic',
    tags: [],
    releasedAt: null,
    isNew: false,
    ...change,
  };
}

function cape(id: string, change: Partial<CapePreset> = {}): CapePreset {
  return {
    id,
    title: `Cape ${id}`,
    url: `app://launcher/cache/icons/${id}.png`,
    tags: [],
    releasedAt: null,
    isNew: false,
    ...change,
  };
}

const PLAID = skin('plaid', { tags: ['Casual'] });
const TOPHAT = skin('tophat', { tags: ['Halloween'], isNew: true, model: 'slim' });
const OLD = skin('old', { tags: ['Casual'], releasedAt: '2026-10-03' });
const WEB = cape('web', { isNew: true });
const MOON = cape('moon');
const PRESETS: LookPresets = { skins: [TOPHAT, PLAID, OLD], capes: [WEB, MOON] };

const WORN_PLAID: WornSkin = { id: null, url: PLAID.url, model: 'classic' };
const WORN_WEB: WornCape = { id: 'web', url: WEB.url };

function user(change: Partial<AccountUser> = {}): AccountUser {
  return {
    ...TEST_USER,
    nick: { name: 'Test_User', changeAt: null },
    skin: WORN_PLAID,
    cape: WORN_WEB,
    ...change,
  };
}

function state(who: AccountUser | null, seq = 5): AccountState {
  return { seq, encryptionAvailable: true, user: who, connect: null, error: null };
}

function presets(value: LookPresets = PRESETS): Promise<SiteResult<LookPresets>> {
  return Promise.resolve({ ok: true, value, stale: false, fetchedAt: TEST_NOW.toISOString() });
}

function refused(error: LookError): Promise<LookResult> {
  return Promise.resolve({ ok: false, error });
}

function worn(who: AccountUser, seq: number): Promise<LookResult> {
  return Promise.resolve({ ok: true, value: state(who, seq) });
}

function signedIn(who: AccountUser | null = user(), sets: LookPresets = PRESETS): Stub {
  const stub = stubLauncher();
  stub.api.account.state = vi.fn(() => Promise.resolve(state(who)));
  stub.api.site.lookPresets = vi.fn(() => presets(sets));
  return stub;
}

async function open(stub: Stub): Promise<Mounted> {
  const mounted = await mountScreen('/skins', { stub, demo: false });
  await flushPromises();
  return mounted;
}

function card(app: Mounted['app'], id: string): DOMWrapper<Element> {
  return app.find(`[data-preset="${id}"]`);
}

async function pick(app: Mounted['app'], id: string): Promise<void> {
  await card(app, id).trigger('click');
}

async function press(app: Mounted['app'], selector: string): Promise<void> {
  await app.find(selector).trigger('click');
  await flushPromises();
}

function figure(app: Mounted['app']): Record<string, string | undefined> {
  const {
    skin: shown,
    cape: back,
    side,
  } = (app.find('[data-figure]').element as HTMLElement).dataset;
  return { skin: shown, cape: back, side };
}

function saveShown(app: Mounted['app']): boolean {
  return app.find('[data-skins-save]').exists();
}

function saveDisabled(app: Mounted['app']): boolean {
  return !saveShown(app) || app.find('[data-skins-save]').attributes('disabled') !== undefined;
}

const FAILURES: { name: string; error: LookError; text: string }[] = [
  {
    name: '429',
    error: { code: 'rate_limited', retryAfterS: 60 },
    text: ru.skins.errors.rate_limited,
  },
  {
    name: '422',
    error: { code: 'invalid_skin', message: 'Этот скин больше недоступен. Выберите другой.' },
    text: 'Этот скин больше недоступен. Выберите другой.',
  },
  { name: 'no connection', error: { code: 'offline' }, text: ru.skins.errors.offline },
];

const NO_CAPE = '[data-preset-none]';

describe('skin and cape screen: who sees it', () => {
  it('a guest is sent to the account screen and the sets are not asked for', async () => {
    const stub = signedIn(null);
    const { app } = await open(stub);
    const notice = app.find('[data-skins="guest"]');
    expect(notice.text()).toContain(ru.skins.guestTitle);
    expect(notice.find('a').attributes('href')).toBe('/accounts');
    expect(notice.find('a').text()).toBe(ru.skins.guestAction);
    expect(stub.api.site.lookPresets).not.toHaveBeenCalled();
    expect(app.find('[data-figure]').exists()).toBe(false);
  });

  it('an account without a nickname is sent to pick one', async () => {
    const { app } = await open(signedIn(user({ nick: { name: null, changeAt: null } })));
    const notice = app.find('[data-skins="no-nick"]');
    expect(notice.text()).toContain(ru.skins.noNickTitle);
    expect(notice.find('a').attributes('href')).toBe('/accounts');
    expect(notice.find('a').text()).toBe(ru.skins.noNickAction);
  });

  it('the nav item opens the screen and has no "soon" mark', async () => {
    const { app } = await open(signedIn());
    const link = app.find('.sidebar a[href="/skins"]');
    expect(link.text()).toBe(ru.nav.skins);
    expect(link.attributes('aria-current')).toBe('page');
  });
});

describe('skin and cape screen: loading the sets', () => {
  it('shows a skeleton while the site has not answered', async () => {
    const stub = signedIn();
    stub.api.site.lookPresets = vi.fn(() => new Promise<SiteResult<LookPresets>>(() => undefined));
    const { app } = await open(stub);
    expect(app.find('[data-skins="loading"] [aria-busy="true"]').exists()).toBe(true);
    expect(app.find('[data-card]').exists()).toBe(false);
  });

  it('an error offers a retry, and the retry shows the sets', async () => {
    const stub = signedIn();
    stub.api.site.lookPresets = vi
      .fn<() => Promise<SiteResult<LookPresets>>>()
      .mockResolvedValueOnce({ ok: false, error: { code: 'offline' } })
      .mockImplementation(() => presets());
    const { app } = await open(stub);
    expect(app.find('[data-skins="error"]').text()).toContain(ru.state.offlineTitle);
    await press(app, '[data-skins="error"] button');
    expect(app.findAll('[data-grid="skins"] [data-card]')).toHaveLength(3);
  });

  it('empty sets say so on both tabs', async () => {
    const { app } = await open(
      signedIn(user({ skin: null, cape: null }), { skins: [], capes: [] }),
    );
    expect(app.find('[data-skins-empty]').text()).toBe(ru.skins.skinsEmpty);
    await app.find('[data-tab="capes"]').trigger('click');
    expect(app.find('[data-skins-empty]').text()).toBe(ru.skins.capesEmpty);
  });

  it('titles and counts come from the answer of the site', async () => {
    const { app } = await open(signedIn());
    expect(app.find('[data-tab="skins"]').text()).toBe(`${ru.skins.tabSkins}3`);
    expect(card(app, 'old').attributes('aria-label')).toBe('Skin old');
    expect(app.find('[data-worn="skin"]').text()).toBe('Skin plaid');
    expect(app.find('[data-worn="cape"]').text()).toBe('Cape web');
  });
});

describe('skin and cape screen: the worn look', () => {
  it('marks the worn skin by its texture and the worn cape by its id', async () => {
    const { app } = await open(signedIn());
    expect(card(app, 'plaid').attributes('aria-pressed')).toBe('true');
    expect(card(app, 'tophat').attributes('aria-pressed')).toBe('false');
    expect(figure(app)).toEqual({ skin: PLAID.url, cape: WEB.url, side: 'front' });
    await app.find('[data-tab="capes"]').trigger('click');
    expect(card(app, 'web').attributes('aria-pressed')).toBe('true');
  });

  it('"Wear" is offered only for a look that differs from the confirmed one', async () => {
    const bare = await open(signedIn(user({ skin: null, cape: null })));
    expect(saveShown(bare.app)).toBe(false);
    await pick(bare.app, 'tophat');
    expect(saveShown(bare.app)).toBe(true);
    await press(bare.app, '[data-skins-undo]');
    expect(saveShown(bare.app)).toBe(false);
    unmountScreen();
    const dressed = await open(signedIn());
    expect(saveShown(dressed.app)).toBe(false);
    await pick(dressed.app, 'plaid');
    expect(saveShown(dressed.app)).toBe(false);
    await dressed.app.find('[data-tab="capes"]').trigger('click');
    await pick(dressed.app, 'web');
    expect(saveShown(dressed.app)).toBe(false);
    await pick(dressed.app, 'moon');
    expect(saveShown(dressed.app)).toBe(true);
    await pick(dressed.app, 'web');
    expect(saveShown(dressed.app)).toBe(false);
  });

  it('a player without a skin wears the standard skin of the game the main process found', async () => {
    const stub = signedIn(user({ skin: null, cape: null }));
    stub.api.site.standardSkin = vi.fn(() =>
      Promise.resolve('app://launcher/cache/icons/steve.png'),
    );
    const { app } = await open(stub);
    const shown = app.find('[data-figure]').attributes();
    expect(shown['data-skin']).toBe('standard');
    expect(shown['data-standard']).toBe('app://launcher/cache/icons/steve.png');
  });

  it('the worn item and the tried one are marked differently, on both tabs at once', async () => {
    const { app } = await open(signedIn());
    const mark = (id: string): string | undefined => card(app, id).attributes('data-card-mark');
    expect([mark('plaid'), mark('tophat'), mark('old')]).toEqual(['worn', 'none', 'none']);
    await pick(app, 'tophat');
    expect([mark('plaid'), mark('tophat'), mark('old')]).toEqual(['worn', 'tried', 'none']);
    expect(card(app, 'plaid').attributes('aria-label')).toBe(`Skin plaid, ${ru.skins.wornMark}`);
    expect(card(app, 'tophat').attributes('aria-label')).toBe(
      `Skin tophat, ${ru.skins.triedMark}, ${ru.skins.newMark}`,
    );
    expect(card(app, 'tophat').attributes('aria-pressed')).toBe('true');
    expect(card(app, 'plaid').attributes('aria-pressed')).toBe('false');
    await app.find('[data-tab="capes"]').trigger('click');
    await pick(app, 'moon');
    expect([mark('web'), mark('moon')]).toEqual(['worn', 'tried']);
    await pick(app, 'moon');
    expect([mark('web'), mark('moon')]).toEqual(['worn', 'tried']);
    await press(app, '[data-skins-undo]');
    expect([mark('web'), mark('moon')]).toEqual(['worn', 'none']);
    await app.find('[data-tab="skins"]').trigger('click');
    expect([mark('plaid'), mark('tophat')]).toEqual(['worn', 'none']);
  });

  it('the line under the tabs always holds one message and never leaves its place', async () => {
    const { app } = await open(signedIn());
    const line = (): string => app.find('[data-skins-status]').text();
    expect(line()).toBe(ru.skins.skinsLead);
    await pick(app, 'tophat');
    expect(line()).toBe(ru.skins.tried);
    await press(app, '[data-skins-undo]');
    await app.find('[data-tab="capes"]').trigger('click');
    expect(line()).toBe(ru.skins.capesLead);
  });

  it('a player without a skin sees the standard figure and no reset button', async () => {
    const { app } = await open(signedIn(user({ skin: null, cape: null })));
    expect(figure(app)).toMatchObject({ skin: 'standard', cape: 'none' });
    expect(app.find('[data-figure]').attributes('data-standard')).toBe('plain');
    expect(app.find('[data-worn="skin"]').text()).toBe(ru.skins.standard);
    expect(app.find('[data-worn="cape"]').text()).toBe(ru.skins.noCape);
    expect(app.find('[data-skins-reset]').exists()).toBe(false);
  });

  it('the new mark is the word of the site, not a count of days here', async () => {
    const { app } = await open(signedIn());
    expect(card(app, 'tophat').find('[data-card-new]').exists()).toBe(true);
    expect(card(app, 'tophat').attributes('aria-label')).toBe(`Skin tophat, ${ru.skins.newMark}`);
    expect(card(app, 'old').find('[data-card-new]').exists()).toBe(false);
    expect(card(app, 'plaid').find('[data-card-new]').exists()).toBe(false);
    await app.find('[data-tab="capes"]').trigger('click');
    expect(card(app, 'web').find('[data-card-new]').exists()).toBe(true);
    expect(card(app, 'moon').find('[data-card-new]').exists()).toBe(false);
  });

  it('the capes tab turns the figure back, the skins tab turns it to the front', async () => {
    const { app } = await open(signedIn());
    await app.find('[data-tab="capes"]').trigger('click');
    expect(figure(app).side).toBe('back');
    await app.find('[data-figure-turn]').trigger('click');
    expect(figure(app).side).toBe('front');
    await app.find('[data-tab="skins"]').trigger('click');
    await app.find('[data-tab="capes"]').trigger('click');
    expect(figure(app).side).toBe('back');
  });

  it('a tag narrows the skins', async () => {
    const { app } = await open(signedIn());
    const chip = app.findAll('.chips button').find((item) => item.text() === 'Halloween');
    await chip?.trigger('click');
    expect(app.findAll('[data-grid="skins"] [data-card]')).toHaveLength(1);
    expect(card(app, 'tophat').exists()).toBe(true);
  });

  it('says quietly that a licence shows its own skin', async () => {
    const stub = signedIn();
    stub.api.microsoft.state = vi.fn(() =>
      Promise.resolve({
        seq: 3,
        available: true,
        encryptionAvailable: true,
        accounts: [{ id: 'ms', nick: 'Kotofey', uuid: 'u', status: 'ready' as const }],
        login: null,
        error: null,
      }),
    );
    const { app } = await open(stub);
    expect(app.find('[data-skins-license]').text()).toBe(ru.skins.licenseNote);
    unmountScreen();
    const plain = await open(signedIn());
    expect(plain.app.find('[data-skins-license]').exists()).toBe(false);
  });
});

describe('skin and cape screen: trying on and saving', () => {
  it('clicking through skins and capes sends nothing to the site', async () => {
    const stub = signedIn();
    const { app } = await open(stub);
    await pick(app, 'tophat');
    await pick(app, 'old');
    await app.find('[data-tab="capes"]').trigger('click');
    await pick(app, 'moon');
    await press(app, NO_CAPE);
    expect(figure(app)).toMatchObject({ skin: OLD.url, cape: 'none' });
    expect(app.find('[data-skins-status]').text()).toBe(ru.skins.tried);
    expect(stub.api.account.wear).not.toHaveBeenCalled();
    expect(stub.api.account.resetLook).not.toHaveBeenCalled();
  });

  it('"Wear" sends the skin once and shows it as saved', async () => {
    const stub = signedIn();
    stub.api.account.wear = vi.fn(() =>
      worn(user({ skin: { id: 'tophat', url: TOPHAT.url, model: 'slim' } }), 6),
    );
    const { app } = await open(stub);
    await pick(app, 'tophat');
    expect(saveDisabled(app)).toBe(false);
    await press(app, '[data-skins-save]');
    expect(stub.api.account.wear).toHaveBeenCalledTimes(1);
    expect(stub.api.account.wear).toHaveBeenCalledWith({ skin: 'tophat', nick: 'Test_User' });
    expect(app.find('[data-skins-status]').text()).toBe(ru.skins.saved);
    expect(card(app, 'tophat').attributes('aria-pressed')).toBe('true');
    expect(saveDisabled(app)).toBe(true);
    expect(app.find('[data-skins-undo]').exists()).toBe(false);
    expect(app.find('.sidebar [data-face]').attributes('data-face')).toBe(TOPHAT.url);
  });

  it('a cape: put on with its id, taken off with null, both by "Wear"', async () => {
    const stub = signedIn();
    stub.api.account.wear = vi
      .fn<() => Promise<LookResult>>()
      .mockImplementationOnce(() => worn(user({ cape: { id: 'moon', url: MOON.url } }), 6))
      .mockImplementationOnce(() => worn(user({ cape: null }), 7));
    const { app } = await open(stub);
    await app.find('[data-tab="capes"]').trigger('click');
    await pick(app, 'moon');
    await press(app, '[data-skins-save]');
    expect(stub.api.account.wear).toHaveBeenLastCalledWith({ cape: 'moon', nick: 'Test_User' });
    await pick(app, 'moon');
    expect(figure(app).cape).toBe(MOON.url);
    expect(saveShown(app)).toBe(false);
    await press(app, NO_CAPE);
    expect(figure(app).cape).toBe('none');
    await press(app, '[data-skins-save]');
    expect(stub.api.account.wear).toHaveBeenCalledTimes(2);
    expect(stub.api.account.wear).toHaveBeenLastCalledWith({ cape: null, nick: 'Test_User' });
    expect(app.find('[data-worn="cape"]').text()).toBe(ru.skins.noCape);
  });

  it('"No cape" is a tile of its own: first, not counted, tried on without a request', async () => {
    const stub = signedIn();
    const { app } = await open(stub);
    await app.find('[data-tab="capes"]').trigger('click');
    const tiles = app.findAll('[data-grid="capes"] [data-card]');
    const none = app.find(NO_CAPE);
    expect(tiles[0]?.element).toBe(none.element);
    expect(tiles).toHaveLength(3);
    expect(app.find('[data-tab="capes"]').text()).toBe(`${ru.skins.tabCapes}2`);
    expect(none.attributes('aria-label')).toBe(ru.skins.noCape);
    expect(none.attributes('data-card-mark')).toBe('none');
    expect(none.find('[data-card-blank]').exists()).toBe(true);
    await press(app, NO_CAPE);
    expect(app.find(NO_CAPE).attributes()).toMatchObject({
      'data-card-mark': 'tried',
      'aria-pressed': 'true',
      'aria-label': `${ru.skins.noCape}, ${ru.skins.triedMark}`,
    });
    expect(card(app, 'web').attributes('data-card-mark')).toBe('worn');
    expect(figure(app).cape).toBe('none');
    expect(app.find('[data-worn="cape"]').text()).toBe(ru.skins.noCape);
    expect(app.find('[data-skins-undo]').exists()).toBe(true);
    expect(saveShown(app)).toBe(true);
    expect(stub.api.account.wear).not.toHaveBeenCalled();
    await press(app, '[data-skins-undo]');
    expect(figure(app).cape).toBe(WEB.url);
    expect(app.find(NO_CAPE).attributes('data-card-mark')).toBe('none');
  });

  it('a player without a cape has "No cape" marked as worn and nothing to save there', async () => {
    const { app } = await open(signedIn(user({ cape: null })));
    await app.find('[data-tab="capes"]').trigger('click');
    const none = app.find(NO_CAPE);
    expect(none.attributes()).toMatchObject({
      'data-card-mark': 'worn',
      'aria-pressed': 'true',
      'aria-label': `${ru.skins.noCape}, ${ru.skins.wornMark}`,
    });
    await press(app, NO_CAPE);
    expect(saveShown(app)).toBe(false);
    await pick(app, 'moon');
    await press(app, NO_CAPE);
    expect(saveShown(app)).toBe(false);
    expect(app.find(NO_CAPE).attributes('data-card-mark')).toBe('worn');
  });

  it('a refused removal keeps the cape worn and the try-on in place', async () => {
    const stub = signedIn();
    stub.api.account.wear = vi.fn(() =>
      Promise.resolve<LookResult>({ ok: false, error: { code: 'offline' } }),
    );
    const { app } = await open(stub);
    await app.find('[data-tab="capes"]').trigger('click');
    await press(app, NO_CAPE);
    await press(app, '[data-skins-save]');
    expect(stub.api.account.wear).toHaveBeenCalledWith({ cape: null, nick: 'Test_User' });
    expect(app.find('[data-skins-error]').exists()).toBe(true);
    expect(card(app, 'web').attributes('data-card-mark')).toBe('worn');
    expect(app.find(NO_CAPE).attributes('data-card-mark')).toBe('tried');
    await press(app, '[data-skins-undo]');
    expect(figure(app).cape).toBe(WEB.url);
    expect(app.find(NO_CAPE).attributes('data-card-mark')).toBe('none');
  });

  it('the button is busy while the site answers and a second press does not go out', async () => {
    const stub = signedIn();
    let answer: (result: LookResult) => void = () => undefined;
    stub.api.account.wear = vi.fn(
      () =>
        new Promise<LookResult>((resolve) => {
          answer = resolve;
        }),
    );
    const { app } = await open(stub);
    await pick(app, 'tophat');
    await press(app, '[data-skins-save]');
    expect(app.find('[data-skins-save]').text()).toBe(ru.skins.saving);
    expect(saveDisabled(app)).toBe(true);
    answer({ ok: false, error: { code: 'failed' } });
    await flushPromises();
    expect(app.find('[data-skins-save]').text()).toBe(ru.skins.wear);
    expect(stub.api.account.wear).toHaveBeenCalledTimes(1);
  });
});

describe('skin and cape screen: a refused save', () => {
  it.each(FAILURES)(
    '$name on a skin: the worn skin is the confirmed one, the tried one stays on the figure',
    async ({ error, text }) => {
      const stub = signedIn();
      stub.api.account.wear = vi.fn(() => refused(error));
      const { app } = await open(stub);
      await pick(app, 'tophat');
      await press(app, '[data-skins-save]');
      expect(app.find('[data-skins-error]').text()).toBe(text);
      expect(figure(app).skin).toBe(TOPHAT.url);
      expect(app.find('.sidebar [data-face]').attributes('data-face')).toBe(PLAID.url);
      expect(saveDisabled(app)).toBe(false);
      await press(app, '[data-skins-save]');
      expect(stub.api.account.wear).toHaveBeenCalledTimes(2);
      await press(app, '[data-skins-undo]');
      expect(card(app, 'plaid').attributes('aria-pressed')).toBe('true');
      expect(app.find('[data-skins-error]').exists()).toBe(false);
    },
  );

  it.each(FAILURES)(
    '$name on a cape: the worn cape is the confirmed one and "Wear" works again',
    async ({ error, text }) => {
      const stub = signedIn();
      stub.api.account.wear = vi.fn(() => refused(error));
      const { app } = await open(stub);
      await app.find('[data-tab="capes"]').trigger('click');
      await pick(app, 'moon');
      await press(app, '[data-skins-save]');
      expect(app.find('[data-skins-error]').text()).toBe(text);
      expect(figure(app).cape).toBe(MOON.url);
      expect(saveDisabled(app)).toBe(false);
      await press(app, '[data-skins-undo]');
      expect(figure(app).cape).toBe(WEB.url);
      expect(card(app, 'web').attributes('aria-pressed')).toBe('true');
    },
  );

  it('a skin saved and a cape refused: only the cape is left to save', async () => {
    const stub = signedIn();
    stub.api.account.wear = vi.fn(() => {
      stub.emitAccount({
        change: 'changed',
        state: state(user({ skin: { id: 'tophat', url: TOPHAT.url, model: 'slim' } }), 6),
      });
      return refused({ code: 'rate_limited', retryAfterS: 20 });
    });
    const { app } = await open(stub);
    await pick(app, 'tophat');
    await app.find('[data-tab="capes"]').trigger('click');
    await pick(app, 'moon');
    await press(app, '[data-skins-save]');
    expect(stub.api.account.wear).toHaveBeenLastCalledWith({
      skin: 'tophat',
      cape: 'moon',
      nick: 'Test_User',
    });
    expect(app.find('[data-skins-error]').text()).toBe(fill(ru.skins.waitSeconds, { seconds: 20 }));
    await press(app, '[data-skins-save]');
    expect(stub.api.account.wear).toHaveBeenLastCalledWith({ cape: 'moon', nick: 'Test_User' });
  });

  it('a 429 is said calmly, other failures as an error', async () => {
    const stub = signedIn();
    stub.api.account.wear = vi
      .fn<() => Promise<LookResult>>()
      .mockImplementationOnce(() => refused({ code: 'rate_limited' }))
      .mockImplementation(() => refused({ code: 'failed' }));
    const { app } = await open(stub);
    await pick(app, 'tophat');
    await press(app, '[data-skins-save]');
    expect(app.find('[data-skins-error]').classes()).toContain('is-wait');
    expect(app.find('[data-skins-error] [data-icon="clock-history"]').exists()).toBe(true);
    expect(saveDisabled(app)).toBe(false);
    await press(app, '[data-skins-save]');
    expect(app.find('[data-skins-error]').classes()).toContain('is-failure');
    expect(app.find('[data-skins-error]').text()).toBe(ru.skins.errors.failed);
  });
});

describe('skin and cape screen: back to the standard look', () => {
  it('one press takes off the skin and the cape and drops the try-on', async () => {
    const stub = signedIn();
    stub.api.account.resetLook = vi.fn(() => worn(user({ skin: null, cape: null }), 6));
    const { app } = await open(stub);
    await pick(app, 'tophat');
    await press(app, '[data-skins-reset]');
    expect(stub.api.account.resetLook).toHaveBeenCalledTimes(1);
    expect(stub.api.account.wear).not.toHaveBeenCalled();
    expect(figure(app)).toMatchObject({ skin: 'standard', cape: 'none' });
    expect(app.find('[data-skins-status]').text()).toBe(ru.skins.saved);
    expect(app.find('[data-skins-reset]').exists()).toBe(false);
  });

  it('with nothing worn it only drops the try-on, without a request', async () => {
    const stub = signedIn(user({ skin: null, cape: null }));
    const { app } = await open(stub);
    await pick(app, 'tophat');
    await press(app, '[data-skins-reset]');
    expect(stub.api.account.resetLook).not.toHaveBeenCalled();
    expect(figure(app).skin).toBe('standard');
  });

  it.each(FAILURES)(
    '$name on one of the two requests: the screen shows what the site confirmed',
    async ({ error, text }) => {
      const stub = signedIn();
      stub.api.account.resetLook = vi.fn(() => {
        stub.emitAccount({ change: 'changed', state: state(user({ skin: null }), 6) });
        return refused(error);
      });
      const { app } = await open(stub);
      await press(app, '[data-skins-reset]');
      expect(app.find('[data-skins-error]').text()).toBe(text);
      expect(app.find('[data-worn="skin"]').text()).toBe(ru.skins.standard);
      expect(app.find('[data-worn="cape"]').text()).toBe('Cape web');
      expect(figure(app)).toMatchObject({ skin: 'standard', cape: WEB.url });
      await press(app, '[data-skins-reset]');
      expect(stub.api.account.resetLook).toHaveBeenCalledTimes(2);
    },
  );
});

describe('wardrobe helpers', () => {
  it('finds the worn preset by id, then by texture', () => {
    expect(wornPresetId(PRESETS.skins, WORN_PLAID)).toBe('plaid');
    expect(wornPresetId(PRESETS.capes, { id: 'moon', url: 'other' })).toBe('moon');
    expect(wornPresetId(PRESETS.skins, { id: null, url: 'gone' })).toBeNull();
    expect(wornPresetId(PRESETS.skins, null)).toBeNull();
  });

  it('a change holds only what differs from the confirmed look', () => {
    const saved = { skin: 'plaid', cape: 'web', capeWorn: true };
    expect(lookChange({ skin: undefined, cape: undefined }, saved)).toBeNull();
    expect(lookChange({ skin: 'plaid', cape: 'web' }, saved)).toBeNull();
    expect(lookChange({ skin: 'tophat', cape: undefined }, saved)).toEqual({ skin: 'tophat' });
    expect(lookChange({ skin: undefined, cape: null }, saved)).toEqual({ cape: null });
    expect(lookChange({ skin: 'tophat', cape: 'moon' }, saved)).toEqual({
      skin: 'tophat',
      cape: 'moon',
    });
    const offCatalog = { skin: null, cape: null, capeWorn: true };
    expect(lookChange({ skin: undefined, cape: null }, offCatalog)).toEqual({ cape: null });
    const bare = { skin: null, cape: null, capeWorn: false };
    expect(lookChange({ skin: undefined, cape: null }, bare)).toBeNull();
  });

  it('error texts: the sentence of the site for 422, own texts for the rest', () => {
    expect(lookErrorText({ code: 'invalid_skin', message: 'Сначала выберите ник.' })).toBe(
      'Сначала выберите ник.',
    );
    expect(lookErrorText({ code: 'invalid_skin' })).toBe(ru.skins.errors.invalid_skin);
    expect(lookErrorText({ code: 'rate_limited' })).toBe(ru.skins.errors.rate_limited);
    expect(lookErrorText({ code: 'rate_limited', retryAfterS: 60 })).toBe(
      ru.skins.errors.rate_limited,
    );
    expect(lookErrorText({ code: 'rate_limited', retryAfterS: 12 })).toBe(
      fill(ru.skins.waitSeconds, { seconds: 12 }),
    );
    expect(lookErrorText({ code: 'not_signed_in' })).toBe(ru.skins.errors.not_signed_in);
  });
});
