import { describe, expect, it } from 'vitest';
import { parseLaunchRequest, parseLaunchTarget, parseLogLines } from './request';

const GIB = 1024 ** 3;
const server = { kind: 'server', serverId: 123, minecraft: '1.21.11', address: 'play.example.ru' };
const account = { kind: 'nick', nick: 'Steve_01' };

describe('parseLaunchTarget', () => {
  it.each([
    [null, 'target'],
    [[], 'target'],
    [{ ...server, kind: 'other' }, 'kind'],
    [{ ...server, minecraft: '../1.21' }, 'minecraft'],
    [{ ...server, minecraft: 'a/b' }, 'minecraft'],
    [{ ...server, serverId: -1 }, 'serverId'],
    [{ ...server, serverId: 1.5 }, 'serverId'],
    [{ ...server, serverId: 1_000_000_000_000 }, 'serverId'],
    [{ ...server, address: 'http://evil' }, 'address'],
  ])('rejects %j at the field %s', (value, field) => {
    expect(parseLaunchTarget(value)).toEqual({
      ok: false,
      error: { code: 'invalid-request', field },
    });
  });
});

describe('parseLaunchRequest', () => {
  it('validates nickname and memory, rejects extra fields', () => {
    const parsed = parseLaunchRequest(
      { target: server, account: { ...account, token: 'x' }, memoryMb: 4096, extra: true },
      16 * GIB,
    );
    expect(parsed).toEqual({ ok: true, value: { target: server, account, memoryMb: 4096 } });
  });

  it('does not default memory; the service fills it in from the scale', () => {
    expect(parseLaunchRequest({ target: server, account }, 16 * GIB)).toEqual({
      ok: true,
      value: { target: server, account },
    });
  });

  it('server join reaches the service, minimize-to-tray comes from its own settings', () => {
    expect(
      parseLaunchRequest(
        { target: server, account, joinServer: false, minimizeOnStart: false },
        16 * GIB,
      ),
    ).toEqual({
      ok: true,
      value: { target: server, account, joinServer: false },
    });
  });

  it('the server flag passes as a boolean only; the player choice is read in main', () => {
    expect(
      parseLaunchRequest(
        { target: server, account, serverSkins: false, withoutMods: true },
        16 * GIB,
      ),
    ).toEqual({
      ok: true,
      value: { target: server, account, serverSkins: false },
    });
    expect(parseLaunchRequest({ target: server, account, serverSkins: 0 }, 16 * GIB)).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'serverSkins' },
    });
    expect(parseLaunchRequest({ target: server, account, serverModpack: true }, 16 * GIB)).toEqual({
      ok: true,
      value: { target: server, account, serverModpack: true },
    });
    expect(parseLaunchRequest({ target: server, account, serverModpack: 1 }, 16 * GIB)).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'serverModpack' },
    });
    expect(parseLaunchRequest({ target: server, account, launcherOnly: true }, 16 * GIB)).toEqual({
      ok: true,
      value: { target: server, account, launcherOnly: true },
    });
    expect(parseLaunchRequest({ target: server, account, launcherOnly: false }, 16 * GIB)).toEqual({
      ok: true,
      value: { target: server, account },
    });
    expect(parseLaunchRequest({ target: server, account, launcherOnly: 'yes' }, 16 * GIB)).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'launcherOnly' },
    });
  });

  it('account carries only an id, no tokens; main fetches those', () => {
    expect(
      parseLaunchRequest(
        { target: server, account: { kind: 'account', id: 'ms-1', token: 'secret' } },
        16 * GIB,
      ),
    ).toEqual({ ok: true, value: { target: server, account: { kind: 'account', id: 'ms-1' } } });
  });

  it.each([
    [{ target: server, account: { kind: 'nick', nick: 'ab' } }, 'nick'],
    [{ target: server, account: { kind: 'nick', nick: 'Стив' } }, 'nick'],
    [{ target: server, account: { kind: 'nick', nick: 'a'.repeat(17) } }, 'nick'],
    [{ target: server, account: { kind: 'microsoft', nick: 'Steve' } }, 'account'],
    [{ target: server, account: { kind: 'account', id: '../x' } }, 'account'],
    [{ target: server, player: { kind: 'offline', nick: 'Steve' } }, 'account'],
    [{ target: server, account, joinServer: 'yes' }, 'joinServer'],
    [{ target: server, account, memoryMb: 512 }, 'memoryMb'],
    [{ target: server, account, memoryMb: 64 * 1024 }, 'memoryMb'],
    [{ target: server, account, memoryMb: '4096' }, 'memoryMb'],
    [{ target: server, account, memoryMb: Number.NaN }, 'memoryMb'],
    [{ target: server, account, memoryMb: Number.POSITIVE_INFINITY }, 'memoryMb'],
    [{ target: server, account, memoryMb: 16 * 1024 }, 'memoryMb'],
  ])('rejects %j at the field %s', (value, field) => {
    expect(parseLaunchRequest(value, 16 * GIB)).toEqual({
      ok: false,
      error: { code: 'invalid-request', field },
    });
  });
});

describe('launch name for the tray', () => {
  it('keeps a trimmed name of one line, no longer than the limit', () => {
    const parsed = parseLaunchRequest(
      { target: server, account, name: '  Cube\n Island  ' },
      16 * GIB,
    );
    expect(parsed).toMatchObject({ ok: true, value: { name: 'Cube Island' } });
    const long = parseLaunchRequest({ target: server, account, name: 'x'.repeat(500) }, 16 * GIB);
    expect(long.ok && long.value.name).toHaveLength(80);
  });

  it('drops a name that is not a string instead of refusing the launch', () => {
    for (const name of [5, null, '   ', { a: 1 }]) {
      const parsed = parseLaunchRequest({ target: server, account, name }, 16 * GIB);
      expect(parsed.ok).toBe(true);
      expect(parsed.ok && parsed.value).not.toHaveProperty('name');
    }
  });
});

describe('parseLogLines', () => {
  it('defaults to 200 lines, caller sets the limit', () => {
    expect(parseLogLines(undefined, 2000)).toEqual({ ok: true, value: 200 });
    expect(parseLogLines(50, 2000)).toEqual({ ok: true, value: 50 });
    expect(parseLogLines(5000, 2000).ok).toBe(false);
    expect(parseLogLines(0, 2000).ok).toBe(false);
  });
});

describe('serverId', () => {
  it('accepts 12 digits, matching the instance folder name', () => {
    const value = { ...server, serverId: 999_999_999_999 };
    expect(parseLaunchTarget(value)).toEqual({ ok: true, value });
  });
});
