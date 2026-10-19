import { describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '@shared/ipc';
import { parseSettingsPatch } from '@shared/settings';
import { parsePlayers } from '@shared/players';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const openExternal = vi.fn((url: string) => Promise.resolve(url));

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {
    handle: (channel: string, run: (event: unknown, ...args: unknown[]) => unknown): void => {
      handlers.set(channel, run);
    },
    on: (): void => undefined,
  },
  shell: { openExternal },
}));

const { handleInvokes, UNTRUSTED_SENDER } = await import('./ipc');
const { openHttps } = await import('./external');
const { parseLaunchRequest, parseLaunchTarget } = await import('./launch/request');
const { checkLiveIds, checkReport, checkServerQuery, checkVote } = await import('./site/request');
const { parseFixRequest } = await import('./launch/crash-ipc');

const GIB = 1024 ** 3;

function sender(url: string, mainFrame = true): unknown {
  const main = { url };
  return { senderFrame: mainFrame ? main : { url }, sender: { mainFrame: main } };
}

function fromJson(json: string): unknown {
  return JSON.parse(json) as unknown;
}

describe('IPC: foreign sender', () => {
  it('no channel runs for a foreign frame or a foreign origin', async () => {
    const run = vi.fn(() => Promise.resolve(true));
    handleInvokes<{ openExternal: (url: string) => Promise<boolean> }>(
      IpcChannels.shell.invoke,
      { openExternal: run },
      { devServerUrl: undefined, untrusted: UNTRUSTED_SENDER },
    );
    const handle = handlers.get(IpcChannels.shell.invoke.openExternal);
    const forged = [
      sender('app://launcher/index.html', false),
      sender('app://launcher.evil/index.html'),
      sender('app://evil/index.html'),
      sender('app://user@launcher.evil/'),
      sender('https://launcher/index.html'),
      sender('file:///C:/index.html'),
      sender('about:blank'),
      sender('data:text/html,<script>1</script>'),
      sender('devtools://devtools/bundled/inspector.html'),
      sender('chrome-extension://abc/index.html'),
      sender(''),
      { senderFrame: null, sender: { mainFrame: { url: 'app://launcher/index.html' } } },
    ];
    for (const event of forged) {
      expect(await handle?.(event, 'https://ok.example')).toEqual(UNTRUSTED_SENDER);
    }
    expect(run).not.toHaveBeenCalled();
    expect(await handle?.(sender('app://launcher/index.html'), 'https://ok.example')).toBe(true);
  });
});

describe('IPC: openExternal', () => {
  it('opens only https; everything else is rejected without calling the system', async () => {
    const hostile: unknown[] = [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'file://evil/share/x.exe',
      'http://evil.example',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=calc',
      'mcmonitor://play/1',
      'app://launcher/index.html',
      '\\\\evil\\share\\x.exe',
      'C:\\Windows\\System32\\calc.exe',
      '',
      null,
      42,
      ['https://ok.example'],
      { href: 'https://ok.example' },
    ];
    for (const url of hostile) {
      expect(await openHttps(url)).toBe(false);
    }
    expect(openExternal).not.toHaveBeenCalled();
    expect(await openHttps('https://ok.example/путь')).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});

describe('IPC: garbage arguments', () => {
  it('launch: wrong types, __proto__ and extra fields', () => {
    const target = { kind: 'server', serverId: 1, minecraft: '1.21.11', address: 'play.example' };
    expect(parseLaunchTarget(fromJson('{"__proto__":{"kind":"server"}}')).ok).toBe(false);
    expect(parseLaunchTarget({ ...target, serverId: '1' }).ok).toBe(false);
    expect(parseLaunchTarget({ ...target, minecraft: '../../evil' }).ok).toBe(false);
    expect(parseLaunchTarget({ ...target, address: 'play.example --demo' }).ok).toBe(false);
    const parsed = parseLaunchRequest(
      {
        target: { ...target, extra: '--jvm' },
        account: { kind: 'nick', nick: 'Steve', token: 'x' },
        jvmArgs: '-javaagent:evil.jar',
      },
      16 * GIB,
    );
    expect(parsed).toEqual({
      ok: true,
      value: { target, account: { kind: 'nick', nick: 'Steve' } },
    });
    const launchId = '6f1c3b9e-1111-4222-8333-444455556666';
    const account = { kind: 'nick', nick: 'Steve' };
    expect(parseLaunchRequest({ target, account, launchId }, 16 * GIB)).toMatchObject({
      value: { launchId },
    });
    for (const bad of ['../x', 7, `${launchId} --demo`]) {
      const cleaned = parseLaunchRequest({ target, account, launchId: bad }, 16 * GIB);
      expect(cleaned).toEqual({ ok: true, value: { target, account } });
    }
    for (const nick of ['St eve', 'Steve"', '--demo', 'a'.repeat(17), 'Стив', 'x\u0000']) {
      expect(parseLaunchRequest({ target, account: { kind: 'nick', nick } }, 16 * GIB).ok).toBe(
        false,
      );
    }
  });

  it('site: requests with extra keys, huge arrays and wrong types', () => {
    expect(checkServerQuery(fromJson('{"__proto__":{"q":"x"}}')).ok).toBe(false);
    expect(checkServerQuery({ q: 'x', url: 'https://evil.example' }).ok).toBe(false);
    expect(checkServerQuery({ q: 'a\u0000' }).ok).toBe(false);
    expect(checkServerQuery({ mode: Array.from({ length: 100_000 }, () => 'pvp') }).ok).toBe(false);
    expect(checkLiveIds(Array.from({ length: 100_000 }, (_, index) => index + 1)).ok).toBe(false);
    expect(checkLiveIds([1, '2']).ok).toBe(false);
    expect(checkReport(1, { reason: 'spam', note: 'x', extra: 1 }).ok).toBe(false);
    expect(checkReport(1, { reason: 'spam', note: 'x'.repeat(100_000) }).ok).toBe(false);
    expect(checkVote(1, 'a\u202E').ok).toBe(false);
    expect(checkVote(1, { toString: () => 'x' }).ok).toBe(false);
  });

  it('settings, nicknames and crash fixes: only known fields', () => {
    expect(parseSettingsPatch(fromJson('{"__proto__":{"ramGb":64}}')).ok).toBe(false);
    expect(parseSettingsPatch({ constructor: { prototype: { x: 1 } } }).ok).toBe(false);
    expect(parseSettingsPatch({ jvmArgs: '-javaagent:evil.jar' }).ok).toBe(false);
    expect(parsePlayers({ nicks: Array.from({ length: 100_000 }, () => ({})) })).toBeNull();
    expect(parseFixRequest({ analysisId: '../x', fix: 0 }).ok).toBe(false);
    expect(parseFixRequest({ analysisId: 'x', fix: 1e9 }).ok).toBe(false);
    expect(parseFixRequest(fromJson('{"__proto__":{"fix":0}}')).ok).toBe(false);
    expect(({} as Record<string, unknown>).ramGb).toBeUndefined();
  });
});
