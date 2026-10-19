import { domainToASCII } from 'node:url';
import { describe, expect, it } from 'vitest';
import { displayHost, formatServerAddress, parseServerAddress } from './server-address';

describe('parseServerAddress', () => {
  it('a hostname without a port leaves the port empty so the client asks SRV itself', () => {
    expect(parseServerAddress('play.example.ru')).toEqual({ host: 'play.example.ru', port: null });
  });

  it('parses the port, case and surrounding spaces', () => {
    expect(parseServerAddress('  Play.Example.RU:25566 ')).toEqual({
      host: 'play.example.ru',
      port: 25566,
    });
    expect(parseServerAddress('localhost:1')).toEqual({ host: 'localhost', port: 1 });
    expect(parseServerAddress('mc.local:65535')).toEqual({ host: 'mc.local', port: 65535 });
  });

  it('IPv4 and IPv6 in square brackets', () => {
    expect(parseServerAddress('192.168.0.10:25565')).toEqual({ host: '192.168.0.10', port: 25565 });
    expect(parseServerAddress('[2001:db8::1]:25565')).toEqual({
      host: '[2001:db8::1]',
      port: 25565,
    });
    expect(parseServerAddress('[::1]')).toEqual({ host: '[::1]', port: null });
  });

  it('an underscore in a label and an FQDN with a trailing dot, as Minecraft accepts it', () => {
    expect(parseServerAddress('my_server.example.ru')).toEqual({
      host: 'my_server.example.ru',
      port: null,
    });
    expect(parseServerAddress('play.example.ru.:25566')).toEqual({
      host: 'play.example.ru',
      port: 25566,
    });
    expect(parseServerAddress('play.example.ru..')).toBeNull();
    expect(parseServerAddress('.')).toBeNull();
  });

  it.each([
    '',
    '   ',
    'play.example.ru:0',
    'play.example.ru:65536',
    'play.example.ru:abc',
    'play.example.ru:',
    'http://play.example.ru',
    'play.example.ru/path',
    'user@play.example.ru',
    'play example.ru',
    'play..example.ru',
    '-play.example.ru',
    'play-.example.ru',
    '2001:db8::1',
    '[2001:db8::1',
    '[not-ip]:25565',
    '999.1.1.1',
    '1.2.3',
    '127.1',
    '0x7f.0.0.1',
    '010.0.0.1',
    'play.example.ru#x',
    'play.example.ru?x',
    'play.example.ru\\x',
    'a'.repeat(64) + '.ru',
    'a.'.repeat(130) + 'ru',
  ])('rejects %j', (value) => {
    expect(parseServerAddress(value)).toBeNull();
  });
});

describe('formatServerAddress', () => {
  it('the port is written only if it is set', () => {
    expect(formatServerAddress({ host: 'play.example.ru', port: null })).toBe('play.example.ru');
    expect(formatServerAddress({ host: 'play.example.ru', port: 25565 })).toBe(
      'play.example.ru:25565',
    );
    expect(formatServerAddress({ host: '[::1]', port: 25565 })).toBe('[::1]:25565');
  });
});

describe('displayHost', () => {
  it.each([
    'майнкрафт.рф',
    'play.майнкрафт.рф',
    'bücher.de',
    'mañana.com',
    '例え.テスト',
    'κόσμος.gr',
  ])('%s from punycode is shown in Unicode', (unicode) => {
    expect(displayHost(domainToASCII(unicode))).toBe(unicode);
  });

  it('ASCII, IPv6 and broken punycode stay as is', () => {
    expect(displayHost('play.example.ru')).toBe('play.example.ru');
    expect(displayHost('::1')).toBe('::1');
    expect(displayHost('xn--!!!.ru')).toBe('xn--!!!.ru');
    expect(displayHost('xn--zzzzzzzzzzzzzz.ru')).toBe('xn--zzzzzzzzzzzzzz.ru');
  });

  it('a parsed IDN address is shown in Russian', () => {
    const parsed = parseServerAddress('майнкрафт.рф:25570');
    expect(parsed?.host).toBe('xn--80aa0aehiwrr.xn--p1ai');
    expect(parsed === null ? '' : displayHost(parsed.host)).toBe('майнкрафт.рф');
  });
});
