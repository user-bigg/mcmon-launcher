import { describe, expect, it, vi } from 'vitest';
import type { PlayCheck, PlayCheckQuery } from '@shared/account';
import type { CheckedPlay } from '../account/nick';
import { admit, openPlayGate, playCheckQuery } from './play-check';

const query: PlayCheckQuery = { serverId: 5, nick: 'Steve', auth: 'nick' };
const player = { nick: 'Steve', telemetry: 'nick', auth: null } as const;
const CODE = 'a'.repeat(32);

function checked(check: PlayCheck, code: string | null = null): CheckedPlay {
  return { check, code };
}

describe('play check before the game starts', () => {
  it('asks with the server id, the nick and the way of signing in', () => {
    const target = {
      kind: 'server',
      serverId: 5,
      minecraft: '26.2',
      address: 'mc.example.org',
    } as const;
    expect(playCheckQuery({ target, account: { kind: 'nick', nick: 'Steve' } }, player)).toEqual(
      query,
    );
    expect(
      playCheckQuery(
        { target, account: { kind: 'account', id: 'ms-1' } },
        { ...player, nick: 'Licensed' },
      ),
    ).toEqual({ serverId: 5, nick: 'Licensed', auth: 'microsoft' });
  });

  it('starts the game on ok and whenever the site said nothing useful', () => {
    expect(admit(checked({ kind: 'ok' }), 'Steve', 'nick')).toEqual({
      go: true,
      nick: 'Steve',
      code: null,
    });
    expect(admit(checked({ kind: 'unchecked' }), 'Steve', 'nick')).toEqual({
      go: true,
      nick: 'Steve',
      code: null,
    });
  });

  it('passes the code on to a game played by nickname and never to a licence', () => {
    expect(admit(checked({ kind: 'ok' }, CODE), 'Steve', 'nick')).toEqual({
      go: true,
      nick: 'Steve',
      code: CODE,
    });
    expect(admit(checked({ kind: 'ok' }, CODE), 'Licensed', 'microsoft')).toEqual({
      go: true,
      nick: 'Licensed',
      code: null,
    });
  });

  it('a nickname pinned to another account stops the launch', () => {
    expect(admit(checked({ kind: 'nick_taken' }), 'Steve', 'nick')).toEqual({
      go: false,
      error: { code: 'nick-taken' },
    });
  });

  it('a mismatch keeps the chosen nickname and has no code', () => {
    expect(
      admit(checked({ kind: 'nick_mismatch', nick: 'Test_User' }, 'c'.repeat(32)), 'Steve', 'nick'),
    ).toEqual({
      go: true,
      nick: 'Steve',
      code: null,
    });
  });

  it('a licence keeps its own name whatever the site says about nicknames', () => {
    expect(admit(checked({ kind: 'nick_taken' }), 'Licensed', 'microsoft')).toEqual({
      go: true,
      nick: 'Licensed',
      code: null,
    });
    expect(
      admit(checked({ kind: 'nick_mismatch', nick: 'Test_User' }), 'Licensed', 'microsoft'),
    ).toEqual({
      go: true,
      nick: 'Licensed',
      code: null,
    });
  });

  it('a ban refuses with its term and reason for any way of signing in', () => {
    const ban = { reason: 'гриф спавна', until: '2026-10-20T21:00:00Z', forever: false };
    const error = { code: 'banned', ...ban };
    expect(admit(checked({ kind: 'banned', ban }), 'Steve', 'nick')).toEqual({ go: false, error });
    expect(admit(checked({ kind: 'banned', ban }), 'Licensed', 'microsoft')).toEqual({
      go: false,
      error,
    });
  });

  it('the gate: no checker or a failed one lets the game start', async () => {
    const onRefused = vi.fn();
    const none = openPlayGate(undefined, query, onRefused);
    const broken = openPlayGate(() => Promise.reject(new Error('down')), query, onRefused);
    expect(await none.verdict).toEqual({ go: true, nick: 'Steve', code: null });
    expect(await broken.verdict).toEqual({ go: true, nick: 'Steve', code: null });
    expect(onRefused).not.toHaveBeenCalled();
    expect(broken.refusal()).toBeNull();
  });

  it('the gate: a checker that never answers is given up on after the deadline', async () => {
    vi.useFakeTimers();
    const onRefused = vi.fn();
    const gate = openPlayGate(() => new Promise(() => undefined), query, onRefused, 3000);
    let verdict: unknown = null;
    void gate.verdict.then((value) => {
      verdict = value;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(verdict).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(verdict).toEqual({ go: true, nick: 'Steve', code: null });
    expect(onRefused).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('the gate: a refusal is reported at once, before the verdict is awaited', async () => {
    const onRefused = vi.fn();
    const gate = openPlayGate(
      () => Promise.resolve(checked({ kind: 'nick_taken' })),
      query,
      onRefused,
    );
    expect(gate.refusal()).toBeNull();
    await gate.verdict;
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(gate.refusal()).toEqual({ code: 'nick-taken' });
  });
});
