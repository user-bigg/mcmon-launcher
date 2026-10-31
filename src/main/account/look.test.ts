import { describe, expect, it, vi } from 'vitest';
import type { AccountEvent } from '@shared/account';
import type { LookError } from '@shared/look';
import type { TelemetryDevice } from '@shared/telemetry';
import { emptyDevice } from '../device/collect';
import { MemoryCache } from '../site/cache';
import { SiteHttp, type Headers } from '../site/http';
import { createAccountApi } from './api';
import type { Loopback } from './loopback';
import { AccountManager } from './manager';
import type { LoadedSession, StoredSession } from './token-store';

const BASE = 'https://mc-mon.ru/api/launcher/v1';
const TOKEN = '12|mcml_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const SKIN = { url: 'https://mc-mon.ru/storage/skins/aa.png', model: 'slim' };
const CAPE = { id: 'cape-web', url: 'https://mc-mon.ru/storage/capes/bb.png' };
const ME = {
  id: 7,
  name: 'Player',
  avatar_url: null,
  trusted: true,
  nick: 'Test_User',
  nick_change_at: null,
};

type Route = (init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function refusal(code: string, status: number, message = code, headers: Headers = {}): Response {
  return json({ error: { code, message } }, status, headers);
}

const GONE = 'Этот скин больше недоступен. Выберите другой.';

interface Failure {
  name: string;
  route: Route;
  error: LookError;
}

const FAILURES: Failure[] = [
  {
    name: '429',
    route: () => refusal('rate_limited', 429, 'Too Many Attempts.', { 'Retry-After': '40' }),
    error: { code: 'rate_limited', retryAfterS: 40 },
  },
  {
    name: '422',
    route: () => refusal('invalid_skin', 422, GONE),
    error: { code: 'invalid_skin', message: GONE },
  },
  {
    name: 'no connection',
    route: (): Response => {
      throw new TypeError('fetch failed');
    },
    error: { code: 'offline' },
  },
];

function session(): StoredSession {
  return { token: TOKEN, user: { id: 7, name: 'Player', avatarUrl: null }, nick: null };
}

interface Setup {
  manager: AccountManager;
  events: AccountEvent[];
  calls: { key: string; body: unknown }[];
  writes: () => string[];
}

async function setup(routes: Record<string, Route>, signedIn = true): Promise<Setup> {
  const calls: { key: string; body: unknown }[] = [];
  let manager: AccountManager | null = null;
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const key = `${init.method ?? 'GET'} ${url.slice(BASE.length)}`;
    calls.push({ key, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const route = routes[key];
    try {
      return Promise.resolve(route === undefined ? refusal('not_found', 404) : route(init));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('failed'));
    }
  };
  const http = new SiteHttp({
    base: BASE,
    fetch,
    headers: (): Promise<Headers> => Promise.resolve({}),
    cache: new MemoryCache(),
    now: Date.now,
    sleep: (): Promise<void> => Promise.resolve(),
    log: vi.fn(),
    retryDelaysMs: [],
    auth: {
      token: (): string | null => manager?.token() ?? null,
      reject: (token, code): void => {
        manager?.reject(token, code);
      },
    },
  });
  const loaded: LoadedSession = signedIn
    ? { kind: 'session', session: session() }
    : { kind: 'none' };
  const created = new AccountManager({
    store: {
      available: (): boolean => true,
      load: (): Promise<LoadedSession> => Promise.resolve(loaded),
      save: (): Promise<boolean> => Promise.resolve(true),
      clear: (): Promise<void> => Promise.resolve(),
    },
    api: createAccountApi(http, (remote) => remote.replace('https://mc-mon.ru', 'app://cache')),
    connectPage: (): Promise<string | null> => Promise.resolve(null),
    openBrowser: (): Promise<boolean> => Promise.resolve(false),
    listen: (): Promise<Loopback> => Promise.reject(new Error('unused')),
    installId: (): Promise<string> => Promise.resolve('install'),
    device: (): Promise<TelemetryDevice> => Promise.resolve(emptyDevice()),
    deviceLabel: 'Windows',
    now: Date.now,
    log: vi.fn(),
  });
  manager = created;
  await created.state();
  await new Promise((resolve) => setImmediate(resolve));
  const events: AccountEvent[] = [];
  created.onEvent((event) => events.push(event));
  calls.length = 0;
  const writes = (): string[] => calls.map((call) => call.key).filter((key) => key !== 'GET /me');
  return { manager: created, events, calls, writes };
}

describe('worn skin and cape', () => {
  it('/me brings the worn skin and cape with local texture addresses', async () => {
    const { manager } = await setup({ 'GET /me': () => json({ ...ME, skin: SKIN, cape: CAPE }) });
    const user = (await manager.state()).user;
    expect(user?.skin).toEqual({
      id: null,
      url: 'app://cache/storage/skins/aa.png',
      model: 'slim',
    });
    expect(user?.cape).toEqual({ id: 'cape-web', url: 'app://cache/storage/capes/bb.png' });
  });

  it('a profile without a skin or of an older site means the standard look', async () => {
    const { manager } = await setup({ 'GET /me': () => json({ ...ME, skin: null }) });
    expect((await manager.state()).user).toMatchObject({ skin: null, cape: null });
  });
});

describe('wear', () => {
  it('a skin is one PUT with the preset id, and the renderer hears about it', async () => {
    const { manager, events, calls } = await setup({
      'PUT /me/skin': () => json({ skin: { id: 'plaid-shirt', ...SKIN } }),
    });
    const result = await manager.wear({ skin: 'plaid-shirt' });
    expect(calls).toEqual([{ key: 'PUT /me/skin', body: { preset: 'plaid-shirt' } }]);
    expect(result).toMatchObject({
      ok: true,
      value: { user: { skin: { id: 'plaid-shirt', model: 'slim' }, cape: null } },
    });
    expect(events.map((event) => event.state.user?.skin?.id)).toEqual(['plaid-shirt']);
  });

  it('a cape goes to its own address; null takes it off', async () => {
    const { manager, calls } = await setup({
      'PUT /me/cape': () => json({ cape: CAPE }),
      'DELETE /me/cape': () => json({ cape: null }),
    });
    expect(await manager.wear({ cape: 'cape-web' })).toMatchObject({
      ok: true,
      value: { user: { cape: { id: 'cape-web' } } },
    });
    expect(await manager.wear({ cape: null })).toMatchObject({
      ok: true,
      value: { user: { cape: null } },
    });
    expect(calls).toEqual([
      { key: 'PUT /me/cape', body: { preset: 'cape-web' } },
      { key: 'DELETE /me/cape', body: undefined },
    ]);
  });

  it('a refused skin does not stop the cape: the look is what the site confirmed', async () => {
    const { manager, writes } = await setup({
      'PUT /me/skin': () => refusal('invalid_skin', 422, GONE),
      'PUT /me/cape': () => json({ cape: CAPE }),
    });
    expect(await manager.wear({ skin: 'gone', cape: 'cape-web' })).toEqual({
      ok: false,
      error: { code: 'invalid_skin', message: GONE },
    });
    expect(writes()).toEqual(['PUT /me/skin', 'PUT /me/cape']);
    expect((await manager.state()).user).toMatchObject({ skin: null, cape: { id: 'cape-web' } });
  });

  it.each(FAILURES)(
    '$name on a skin: the worn skin stays, the next press goes out',
    async (failure) => {
      const { manager, writes } = await setup({
        'GET /me': () => json({ ...ME, skin: SKIN, cape: CAPE }),
        'PUT /me/skin': failure.route,
      });
      await manager.refresh(true);
      expect(await manager.wear({ skin: 'plaid-shirt' })).toEqual({
        ok: false,
        error: failure.error,
      });
      expect((await manager.state()).user).toMatchObject({
        skin: { model: 'slim' },
        cape: { id: 'cape-web' },
      });
      await manager.wear({ skin: 'plaid-shirt' });
      expect(writes()).toEqual(['PUT /me/skin', 'PUT /me/skin']);
    },
  );

  it.each(FAILURES)(
    '$name on a cape: the worn cape stays, the next press goes out',
    async (failure) => {
      const { manager, writes } = await setup({
        'GET /me': () => json({ ...ME, skin: SKIN, cape: CAPE }),
        'PUT /me/cape': failure.route,
        'DELETE /me/cape': failure.route,
      });
      await manager.refresh(true);
      expect(await manager.wear({ cape: 'cape-moon' })).toEqual({
        ok: false,
        error: failure.error,
      });
      expect(await manager.wear({ cape: null })).toEqual({ ok: false, error: failure.error });
      expect((await manager.state()).user?.cape).toMatchObject({ id: 'cape-web' });
      expect(writes()).toEqual(['PUT /me/cape', 'DELETE /me/cape']);
    },
  );

  it('a 429 on the skin leaves the cape, votes and favorites free to go', async () => {
    const { manager, writes } = await setup({
      'PUT /me/skin': () =>
        refusal('rate_limited', 429, 'Too Many Attempts.', { 'Retry-After': '40' }),
      'PUT /me/cape': () => json({ cape: CAPE }),
      'GET /me/favorites': () => json({ ids: [5] }),
    });
    await manager.wear({ skin: 'plaid-shirt' });
    expect(await manager.wear({ cape: 'cape-web' })).toMatchObject({ ok: true });
    expect(await manager.favorites()).toEqual({ ok: true, value: [5] });
    expect(writes()).toEqual(['PUT /me/skin', 'PUT /me/cape', 'GET /me/favorites']);
  });

  it('a long or marked-up refusal text is cut and kept as plain text', async () => {
    const { manager } = await setup({
      'PUT /me/skin': () => refusal('invalid_skin', 422, `<b>${'x'.repeat(300)}</b>`),
    });
    const result = await manager.wear({ skin: 'plaid-shirt' });
    const message = result.ok ? '' : (result.error.message ?? '');
    expect(message.startsWith('<b>xxx')).toBe(true);
    expect(Array.from(message)).toHaveLength(200);
  });

  it('401: the session is forgotten and the answer says to sign in', async () => {
    const { manager, events } = await setup({
      'PUT /me/skin': () => refusal('unauthenticated', 401),
    });
    expect(await manager.wear({ skin: 'plaid-shirt' })).toEqual({
      ok: false,
      error: { code: 'not_signed_in' },
    });
    expect((await manager.state()).user).toBeNull();
    expect(events.at(-1)?.change).toBe('expired');
  });

  it('an answer the launcher cannot read is a failure and /me is asked again', async () => {
    const { manager, calls } = await setup({
      'PUT /me/skin': () => json({ ok: true }),
      'GET /me': () => json({ ...ME, skin: SKIN }),
    });
    expect(await manager.wear({ skin: 'plaid-shirt' })).toEqual({
      ok: false,
      error: { code: 'failed' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls.map((call) => call.key)).toEqual(['PUT /me/skin', 'GET /me']);
    expect((await manager.state()).user?.skin?.model).toBe('slim');
  });

  it('a guest does not call the site', async () => {
    const { manager, calls } = await setup({}, false);
    expect(await manager.wear({ skin: 'plaid-shirt' })).toEqual({
      ok: false,
      error: { code: 'not_signed_in' },
    });
    expect(await manager.resetLook()).toEqual({ ok: false, error: { code: 'not_signed_in' } });
    expect(calls).toEqual([]);
  });
});

describe('a late /me', () => {
  it('does not bring back the look that a confirmed change has replaced', async () => {
    let held: Promise<Response> | null = null;
    const { manager } = await setup({
      'GET /me': () => held ?? json({ ...ME, skin: SKIN, cape: CAPE }),
      'PUT /me/skin': () => json({ skin: { id: 'tophat', url: SKIN.url, model: 'classic' } }),
    });
    await manager.refresh(true);
    let answer: (response: Response) => void = () => undefined;
    held = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const refreshing = manager.refresh(true);
    await manager.wear({ skin: 'tophat' });
    held = null;
    answer(json({ ...ME, skin: SKIN, cape: CAPE }));
    await refreshing;
    expect((await manager.state()).user?.skin).toMatchObject({ id: 'tophat', model: 'classic' });
    expect((await manager.state()).user?.cape).toMatchObject({ id: 'cape-web' });
    await manager.refresh(true);
    expect((await manager.state()).user?.skin).toMatchObject({ id: null, model: 'slim' });
  });
});

describe('resetLook', () => {
  it('takes off the skin and the cape with two requests', async () => {
    const { manager, calls } = await setup({
      'GET /me': () => json({ ...ME, skin: SKIN, cape: CAPE }),
      'DELETE /me/skin': () => json({ skin: null }),
      'DELETE /me/cape': () => json({ cape: null }),
    });
    await manager.refresh(true);
    calls.length = 0;
    const result = await manager.resetLook();
    expect(calls.map((call) => call.key)).toEqual(['DELETE /me/skin', 'DELETE /me/cape']);
    expect(result).toMatchObject({ ok: true, value: { user: { skin: null, cape: null } } });
  });

  it.each(FAILURES)(
    '$name on the skin: the cape still comes off, the skin stays',
    async (failure) => {
      const { manager, writes } = await setup({
        'GET /me': () => json({ ...ME, skin: SKIN, cape: CAPE }),
        'DELETE /me/skin': failure.route,
        'DELETE /me/cape': () => json({ cape: null }),
      });
      await manager.refresh(true);
      expect(await manager.resetLook()).toEqual({ ok: false, error: failure.error });
      expect(writes()).toEqual(['DELETE /me/skin', 'DELETE /me/cape']);
      expect((await manager.state()).user).toMatchObject({ skin: { model: 'slim' }, cape: null });
    },
  );

  it.each(FAILURES)('$name on the cape: the skin is off, the cape stays', async (failure) => {
    const { manager } = await setup({
      'GET /me': () => json({ ...ME, skin: SKIN, cape: CAPE }),
      'DELETE /me/skin': () => json({ skin: null }),
      'DELETE /me/cape': failure.route,
    });
    await manager.refresh(true);
    expect(await manager.resetLook()).toEqual({ ok: false, error: failure.error });
    expect((await manager.state()).user).toMatchObject({ skin: null, cape: { id: 'cape-web' } });
  });
});

describe('nicknames of the account', () => {
  const NICKS = [
    { name: 'Test_User', avatar: true, skin: null, cape: null },
    { name: 'Alt_Nick', avatar: false, skin: { id: 'tophat', ...SKIN }, cape: 'cape-web' },
  ];

  it('/me brings the list with the star first and each nickname own look', async () => {
    const { manager } = await setup({ 'GET /me': () => json({ ...ME, nicks: NICKS }) });
    expect((await manager.state()).user?.nicks).toEqual([
      { name: 'Test_User', avatar: true, skin: null, capeId: null },
      {
        name: 'Alt_Nick',
        avatar: false,
        skin: { id: 'tophat', url: 'app://cache/storage/skins/aa.png', model: 'slim' },
        capeId: 'cape-web',
      },
    ]);
  });

  it('a nickname other than the star is dressed at its own address, then /me is read again', async () => {
    const { manager, writes } = await setup({
      'GET /me': () => json({ ...ME, nicks: NICKS }),
      'PUT /me/nicks/Alt_Nick/skin': () => json({ name: 'Alt_Nick' }),
      'PUT /me/nicks/Alt_Nick/cape': () => json({ name: 'Alt_Nick' }),
    });
    expect(await manager.wear({ skin: 'tophat', cape: null, nick: 'Alt_Nick' })).toMatchObject({
      ok: true,
    });
    expect(writes()).toEqual(['PUT /me/nicks/Alt_Nick/skin', 'PUT /me/nicks/Alt_Nick/cape']);
  });

  it('the star nickname keeps the old addresses', async () => {
    const { manager, writes } = await setup({
      'GET /me': () => json({ ...ME, nicks: NICKS }),
      'PUT /me/skin': () => json({ skin: { id: 'plaid-shirt', ...SKIN } }),
    });
    await manager.wear({ skin: 'plaid-shirt', nick: 'test_user' });
    expect(writes()).toEqual(['PUT /me/skin']);
  });

  it('adding, letting go and taking the star; refusals come back as nickname errors', async () => {
    const { manager, writes } = await setup({
      'GET /me': () => json({ ...ME, nicks: NICKS }),
      'POST /me/nicks': () =>
        json({ name: 'New_Nick', avatar: false, skin: null, cape: null }, 201),
      'DELETE /me/nicks/Test_User': () => refusal('avatar_nick', 409),
      'PUT /me/avatar': () => json({ ...ME, nicks: NICKS }),
    });
    expect(await manager.addSiteNick('New_Nick')).toMatchObject({ ok: true });
    expect(await manager.removeSiteNick('Test_User')).toEqual({
      ok: false,
      error: { code: 'avatar_nick' },
    });
    expect(await manager.setAvatarNick('Alt_Nick')).toMatchObject({ ok: true });
    expect(writes()).toEqual(['POST /me/nicks', 'DELETE /me/nicks/Test_User', 'PUT /me/avatar']);
  });
});
