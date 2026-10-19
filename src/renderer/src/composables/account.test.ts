// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountEvent, AccountState, AccountUser } from '@shared/account';
import { contextOf, stubLauncher, TEST_USER, type Stub } from '../testing';
import { createAccounts, type AccountsStore } from './useAccounts';
import { createCatalog } from './useCatalog';
import { createFavorites, type FavoritesStore } from './useFavorites';

function state(seq: number, user: AccountUser | null): AccountState {
  return { seq, encryptionAvailable: true, user, connect: null, error: null };
}

interface Built {
  stub: Stub;
  accounts: AccountsStore;
  favorites: FavoritesStore;
  emit: (event: AccountEvent) => void;
}

function build(signedIn: boolean, local: number[], remote: number[]): Built {
  localStorage.setItem('mcmonitor.favorites', JSON.stringify(local));
  const stub = stubLauncher();
  const site = remote;
  stub.api.account.state = vi.fn(() => Promise.resolve(state(1, signedIn ? TEST_USER : null)));
  stub.api.site.favorites = vi.fn(() => Promise.resolve({ ok: true as const, value: [...site] }));
  stub.api.site.setFavorite = vi.fn((id: number, favorite: boolean) => {
    if (favorite && !site.includes(id)) {
      site.push(id);
    }
    return Promise.resolve({ ok: true as const, value: favorite });
  });
  const context = contextOf(stub);
  const accounts = createAccounts(context);
  const favorites = createFavorites(context, createCatalog(context), accounts);
  const emit = (event: AccountEvent): void => {
    stub.emitAccount(event);
  };
  return { stub, accounts, favorites, emit };
}

afterEach(() => {
  localStorage.clear();
});

describe('favorites and account', () => {
  it('without an account — local', async () => {
    const { favorites, stub } = build(false, [3], [9]);
    await flushPromises();
    expect(favorites.ids.value).toEqual([3]);
    await favorites.toggle(4);
    expect(favorites.ids.value).toEqual([3, 4]);
    expect(stub.api.site.setFavorite).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('mcmonitor.favorites') ?? '[]')).toEqual([3, 4]);
  });

  it('already signed in at startup — the site is the source, local data is not merged', async () => {
    const { favorites, stub } = build(true, [3], [9]);
    await flushPromises();
    expect(favorites.ids.value).toEqual([9]);
    expect(stub.api.site.setFavorite).not.toHaveBeenCalled();
  });

  it('signing in — local PUTs one by one, then the site becomes the source; toggling goes to the site', async () => {
    const { favorites, stub, emit } = build(false, [3, 9, 4], [9]);
    await flushPromises();
    emit({ change: 'signed-in', state: state(2, TEST_USER) });
    await flushPromises();
    expect(stub.api.site.setFavorite).toHaveBeenCalledTimes(2);
    expect(stub.api.site.setFavorite).toHaveBeenCalledWith(3, true);
    expect(stub.api.site.setFavorite).toHaveBeenCalledWith(4, true);
    expect(stub.api.site.favorites).toHaveBeenCalledTimes(1);
    expect(favorites.ids.value).toEqual([9, 3, 4]);
    await favorites.toggle(9);
    expect(stub.api.site.setFavorite).toHaveBeenLastCalledWith(9, false);
    expect(favorites.ids.value).toEqual([3, 4]);
  });

  it('a site error while toggling — rollback and an error code', async () => {
    const { favorites, stub } = build(true, [], [9]);
    await flushPromises();
    stub.api.site.setFavorite = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'offline' as const } }),
    );
    await favorites.toggle(5);
    expect(favorites.ids.value).toEqual([9]);
    expect(favorites.error.value).toEqual({ code: 'offline' });
  });

  it('the token is forgotten (401) — back to local', async () => {
    const { favorites, emit } = build(true, [3], [9]);
    await flushPromises();
    emit({ change: 'expired', state: state(3, null) });
    await flushPromises();
    expect(favorites.ids.value).toEqual([3]);
  });

  it('a stale event does not overwrite state', async () => {
    const { accounts, emit } = build(false, [], []);
    await flushPromises();
    emit({ change: 'signed-in', state: state(5, TEST_USER) });
    emit({ change: 'changed', state: state(4, null) });
    expect(accounts.mc.value?.name).toBe(TEST_USER.name);
  });
});

describe('nickname accounts in main storage', () => {
  it('restores nicknames and the active one, renaming and selection persist', async () => {
    const stub = stubLauncher();
    stub.players.stored = {
      nicks: [
        { id: 'nick-alex', nick: 'Alex' },
        { id: 'nick-steve', nick: 'Steve' },
      ],
      active: { kind: 'nick', id: 'nick-steve' },
    };
    const accounts = createAccounts(contextOf(stub));
    await flushPromises();
    expect(accounts.accounts.value.map((item) => item.name)).toEqual(['Alex', 'Steve']);
    expect(accounts.active.value?.name).toBe('Steve');
    expect(accounts.saveNick('Steve_2')).toBe(true);
    await flushPromises();
    expect(stub.players.stored).toEqual({
      nicks: [
        { id: 'nick-alex', nick: 'Alex' },
        { id: 'nick-steve', nick: 'Steve_2' },
      ],
      active: { kind: 'nick', id: 'nick-steve' },
    });
    const restarted = createAccounts(contextOf(stub));
    await flushPromises();
    expect(restarted.active.value?.name).toBe('Steve_2');
  });

  it('a nickname added before main responds is not lost, ids do not match', async () => {
    const stub = stubLauncher();
    stub.players.stored = {
      nicks: [{ id: 'nick-alex', nick: 'Bob' }],
      active: { kind: 'nick', id: 'nick-alex' },
    };
    const accounts = createAccounts(contextOf(stub));
    accounts.addNick('Steve');
    await flushPromises();
    expect(accounts.active.value?.name).toBe('Steve');
    expect(accounts.addNick('Alex')?.id).toBe('nick-alex-2');
    await flushPromises();
    expect(stub.players.stored.nicks.map((item) => item.nick)).toEqual(['Bob', 'Steve', 'Alex']);
    expect(stub.players.stored.active).toEqual({ kind: 'nick', id: 'nick-alex-2' });
  });
});
