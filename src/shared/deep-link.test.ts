import { describe, expect, it } from 'vitest';
import { deepLinkFromArgv, parseDeepLink } from './deep-link';

describe('parseDeepLink', () => {
  it('accepts mcmonitor://play/<id>', () => {
    expect(parseDeepLink('mcmonitor://play/123')).toEqual({ kind: 'play', serverId: 123 });
    expect(parseDeepLink('mcmonitor://play/999999999999')).toEqual({
      kind: 'play',
      serverId: 999_999_999_999,
    });
  });

  it.each([
    'mcmonitor://play/../1',
    'mcmonitor://play/./1',
    'mcmonitor://play/%2e%2e/1',
    'mcmonitor://evil/1',
    'mcmonitor://PLAY/1',
    'MCMONITOR://play/1',
    'mcmonitor://play/1/',
    'mcmonitor://play/1?launch=x#x',
    'mcmonitor://play/1?src=cata log',
    'mcmonitor://play/1?src=<script>',
    'mcmonitor://play/1/?src=catalog',
    'mcmonitor://play/1#x',
    'mcmonitor://user@play/1',
    'mcmonitor://play:80/1',
    'mcmonitor://play/0',
    'mcmonitor://play/1234567890123',
    'mcmonitor://play/-1',
    'mcmonitor://play/1 --inspect',
    'mcmonitor://play/1"',
    'mcmonitor:play/1',
    'mcmonitor:///play/1',
    'https://play/1',
    '--inspect',
    '',
  ])('rejects %j', (raw) => {
    expect(parseDeepLink(raw)).toBeNull();
  });
});

describe('parseDeepLink with telemetry parameters', () => {
  const launch = '3f0c2a52-6f0e-4c1e-9a55-0d3a4d1b7c21';

  it('takes the launch id and the source', () => {
    expect(parseDeepLink(`mcmonitor://play/7?launch=${launch}&src=server_page`)).toEqual({
      kind: 'play',
      serverId: 7,
      launchId: launch,
      source: 'server_page',
    });
  });

  it('does not let a link claim a paid place: any page can open a link', () => {
    expect(parseDeepLink('mcmonitor://play/7?src=top_slot')).toEqual({
      kind: 'play',
      serverId: 7,
      source: 'other',
    });
    for (const source of ['catalog', 'server_page', 'home_popular', 'favorites', 'other']) {
      expect(parseDeepLink(`mcmonitor://play/7?src=${source}`)).toMatchObject({ source });
    }
  });

  it('ignores unknown parameters and a launch id that is not a UUID v4', () => {
    expect(parseDeepLink('mcmonitor://play/7?join=1&launch=123&x')).toEqual({
      kind: 'play',
      serverId: 7,
    });
    expect(parseDeepLink('mcmonitor://play/7?launch=3f0c2a52-6f0e-1c1e-9a55-0d3a4d1b7c21')).toEqual(
      { kind: 'play', serverId: 7 },
    );
  });

  it("turns a source outside the site's list into 'other'", () => {
    expect(parseDeepLink('mcmonitor://play/7?src=deeplink')).toMatchObject({ source: 'other' });
    expect(parseDeepLink('mcmonitor://play/7?src=home_hero')).toMatchObject({ source: 'other' });
  });

  it('never marks a link as a request of the site', () => {
    expect(parseDeepLink('mcmonitor://play/7?via=site')).toEqual({ kind: 'play', serverId: 7 });
  });

  it('refuses a link longer than the limit', () => {
    expect(parseDeepLink(`mcmonitor://play/7?x=${'a'.repeat(300)}`)).toBeNull();
  });
});

describe('deepLinkFromArgv', () => {
  it('takes the single argument with the mcmonitor:// scheme', () => {
    expect(
      deepLinkFromArgv([
        'C:\\\\MCMonitorLauncher.exe',
        '--allow-file-access-from-files',
        'mcmonitor://play/42',
      ]),
    ).toEqual({ kind: 'play', serverId: 42 });
  });

  it('without a link, with garbage, and with several links — nothing', () => {
    expect(deepLinkFromArgv(['app.exe'])).toBeNull();
    expect(deepLinkFromArgv(['app.exe', '--inspect', 'mcmonitor://evil/1'])).toBeNull();
    expect(deepLinkFromArgv(['app.exe', '--inspect=mcmonitor://play/1'])).toBeNull();
    expect(deepLinkFromArgv(['app.exe', 'mcmonitor://play/1', 'mcmonitor://play/2'])).toBeNull();
    expect(deepLinkFromArgv(['app.exe', 'mcmonitor://play/1', 'mcmonitor://play/1'])).toBeNull();
  });
});

describe('deep link with hostile input', () => {
  it.each([
    'mcmonitor://play/１２３',
    'mcmonitor://play/١٢٣',
    'mcmonitor://play/1\u0000',
    'mcmonitor://play/1%00',
    'mcmonitor://play/1\n',
    'mcmonitor://play/1\r\n--inspect=9229',
    'mcmonitor://play/1\u202E',
    'mcmonitor://play/\u200B1',
    'mcmonitor://play/1e3',
    'mcmonitor://play/0x1F',
    'mcmonitor://play/1.0',
    'mcmonitor://play/ 1',
    'mcmonitor://play/1 ',
    'mcmonitor://play/9007199254740993',
    `mcmonitor://play/${'1'.repeat(10_000)}`,
    `mcmonitor://play/1?${'a'.repeat(100_000)}`,
    'mcmonitor://play/%31',
    'mcmonitor://play\\1',
    'mcmonitor://play/1;calc.exe',
    'mcmonitor://play/1&calc',
    'mcmonitor://play/1|calc',
    'mcmonitor://play/${1}',
    'mcmonitor://play/{{1}}',
    'mcmonitor://play/__proto__',
  ])('rejects %j', (raw) => {
    expect(parseDeepLink(raw)).toBeNull();
  });

  it('extra arguments next to the link do not make it valid', () => {
    expect(deepLinkFromArgv(['app.exe', '--', 'mcmonitor://play/1 --inspect'])).toBeNull();
    expect(
      deepLinkFromArgv(['app.exe', '--', 'mcmonitor://play/1', 'MCMONITOR://play/2']),
    ).toBeNull();
    expect(deepLinkFromArgv(['app.exe', '--', `mcmonitor://play/${'9'.repeat(65)}`])).toBeNull();
    expect(deepLinkFromArgv(['app.exe', '--', 'mcmonitor://play/7'])).toEqual({
      kind: 'play',
      serverId: 7,
    });
  });
});
