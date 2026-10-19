import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MicrosoftEvent } from '@shared/microsoft';
import type { SecretCipher } from '../account/token-store';
import type { FetchLike } from '../launch/json-cache';
import { microsoftHandlers } from './ipc';
import { microsoftFailure } from './errors';
import { MicrosoftManager, type MicrosoftAccountStore } from './manager';
import { decideRedirect, type RedirectListener, type RedirectOutcome } from './redirect';
import { MicrosoftStore, type LoadedMicrosoft } from './store';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, BrowserWindow: {} }));

const UUID = '0123456789abcdef0123456789abcdef';
const ACCOUNT_ID = `ms-${UUID}`;
const SECRETS = {
  microsoft: 'ms-access-token-AAAAAAAAAAAAAAAA',
  refresh: 'ms-refresh-token-BBBBBBBBBBBBBBBB',
  xbox: 'xbox-user-token-CCCCCCCCCCCCCCCC',
  xsts: 'xsts-token-DDDDDDDDDDDDDDDDDDDD',
  minecraft: 'eyJhbGciOiJIUzI1NiJ9.minecraft-token-EEEEEEEE.signature',
};

const cipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain, 'utf8').map((byte) => byte ^ 0x5a) as Buffer,
  decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ 0x5a)).toString('utf8'),
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchStub: FetchLike = (url) => {
  const xbox = { Token: SECRETS.xbox, DisplayClaims: { xui: [{ uhs: 'hash' }] } };
  const replies: Record<string, unknown> = {
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token': {
      access_token: SECRETS.microsoft,
      refresh_token: SECRETS.refresh,
    },
    'https://user.auth.xboxlive.com/user/authenticate': xbox,
    'https://xsts.auth.xboxlive.com/xsts/authorize': { ...xbox, Token: SECRETS.xsts },
    'https://api.minecraftservices.com/authentication/login_with_xbox': {
      access_token: SECRETS.minecraft,
      expires_in: 86_400,
    },
    'https://api.minecraftservices.com/entitlements/mcstore': {
      items: [{ name: 'game_minecraft' }],
    },
    'https://api.minecraftservices.com/minecraft/profile': { id: UUID, name: 'Steve_MS' },
  };
  return Promise.resolve(json(replies[url]));
};

describe('Microsoft game accounts', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function setup(
    wrap: (store: MicrosoftStore) => MicrosoftAccountStore = (store) => store,
  ): Promise<{
    manager: MicrosoftManager;
    file: string;
    fetch: ReturnType<typeof vi.fn<FetchLike>>;
    events: MicrosoftEvent[];
    answer: (query: (state: string) => string, fetchMode?: string) => void;
  }> {
    dir ??= await mkdtemp(join(tmpdir(), 'mcmonitor-microsoft-'));
    const file = join(dir, 'microsoft.json');
    const fetch = vi.fn<FetchLike>(fetchStub);
    let settle: (outcome: RedirectOutcome) => void = () => undefined;
    let expected = '';
    let portTaken = false;
    const manager = new MicrosoftManager({
      clientId: '00000000-0000-4000-8000-000000000000',
      store: wrap(new MicrosoftStore(file, cipher)),
      fetch,
      openBrowser: (): Promise<boolean> => Promise.resolve(true),
      listen: async ({ state }): Promise<RedirectListener> => {
        if (portTaken) {
          throw microsoftFailure('port_busy');
        }
        portTaken = true;
        await Promise.resolve();
        expected = state;
        const result = new Promise<RedirectOutcome>((resolve) => {
          settle = resolve;
        });
        const close = (): Promise<void> => {
          portTaken = false;
          return Promise.resolve();
        };
        return { port: 3001, result, close };
      },
      now: (): number => Date.parse('2026-10-13T09:00:00Z'),
      log: (): void => undefined,
    });
    const events: MicrosoftEvent[] = [];
    manager.onEvent((event) => events.push(event));
    const answer = (query: (state: string) => string, fetchMode?: string): void => {
      const decision = decideRedirect(
        { method: 'GET', url: `/redirect?${query(expected)}`, host: 'localhost:3001', fetchMode },
        { state: expected, port: 3001, used: false },
      );
      if (decision.outcome !== null) {
        settle(decision.outcome);
      }
    };
    return { manager, file, fetch, events, answer };
  }

  async function signIn(): Promise<Awaited<ReturnType<typeof setup>>> {
    const context = await setup();
    await context.manager.login();
    context.answer((state) => `code=auth-code&state=${state}`);
    await vi.waitFor(() => {
      expect(context.events.at(-1)?.change).toBe('signed-in');
    });
    return context;
  }

  it('keeps every token out of IPC answers, events and the file on disk', async () => {
    const { manager, file, events } = await signIn();
    const handlers = microsoftHandlers(manager);
    const seen = JSON.stringify([
      events,
      await handlers.state(),
      await handlers.login(),
      await handlers.cancel(),
      await readFile(file, 'utf8'),
    ]);
    for (const secret of Object.values(SECRETS)) {
      expect(seen).not.toContain(secret);
    }
    expect(seen).toContain('Steve_MS');
    expect((await manager.gameAuth(ACCOUNT_ID)).accessToken).toBe(SECRETS.minecraft);
  });

  it('cancels the sign-in when the returned state differs', async () => {
    const { manager, fetch, events, answer } = await setup();
    await manager.login();
    answer(() => 'code=auth-code&state=someone-else', 'no-cors');
    expect((await manager.state()).login).toMatchObject({ phase: 'waiting' });
    answer(() => 'code=auth-code&state=someone-else', 'navigate');
    await vi.waitFor(() => {
      expect(events.at(-1)?.change).toBe('failed');
    });
    const state = await manager.state();
    expect(state.error).toEqual({ code: 'state_mismatch' });
    expect(state.login).toBeNull();
    expect(state.accounts).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts sign-ins one after another, so a second click never finds the port taken', async () => {
    const { manager, events } = await setup();
    const [first, second, cancelled] = await Promise.all([
      manager.login(),
      manager.login(),
      manager.cancel(),
    ]);
    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(cancelled.login).toBeNull();
    expect(events.map((event) => event.state.error)).not.toContainEqual({ code: 'port_busy' });
  });

  it('keeps the accounts when the file cannot be read this time', async () => {
    const { file } = await signIn();
    const saved = await readFile(file, 'utf8');
    let reads = 0;
    const { manager } = await setup((store) => ({
      available: (): boolean => store.available(),
      save: (accounts): Promise<boolean> => store.save(accounts),
      load: (): Promise<LoadedMicrosoft> => {
        reads += 1;
        return reads === 1 ? Promise.resolve({ kind: 'unreadable' }) : store.load();
      },
    }));
    expect(await manager.login()).toEqual({ ok: false, error: { code: 'storage_failed' } });
    expect(await readFile(file, 'utf8')).toBe(saved);
    expect((await manager.state()).accounts).toMatchObject([{ id: ACCOUNT_ID, status: 'ready' }]);
    expect(await new MicrosoftStore(join(file, '..'), cipher).load()).toEqual({
      kind: 'unreadable',
    });
  });

  it('erases the stored keys when the account is removed', async () => {
    const { manager, file } = await signIn();
    await manager.remove(ACCOUNT_ID);
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(manager.gameAuth(ACCOUNT_ID)).rejects.toMatchObject({ code: 'not_found' });
    expect((await manager.state()).accounts).toEqual([]);
  });
});
