import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseServerAddress } from '@shared/server-address';
import {
  isPrivateIpv4,
  isPrivateIpv6,
  redactLines,
  redactText,
  serverWords,
  type RedactOptions,
} from './crash-redact';

const options: RedactOptions = {
  nick: 'Frostbyte',
  userName: 'Vasya Petrov',
  homeDir: 'C:\\Users\\Vasya Petrov',
  gameRoot: 'C:\\Users\\Vasya Petrov\\AppData\\Local\\MC Monitor\\game',
};

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, 'fixtures', 'crash', `${name}.txt`), 'utf8');
}

describe('a launcher-only server', () => {
  const address = parseServerAddress('Play.Example.ru:25570');
  const server = address === null ? [] : serverWords(address);

  it('its address in any case and every IP become <server>, clock times stay', () => {
    const text = [
      '[12:34:56] Connecting to play.example.ru, 25570',
      '--quickPlayMultiplayer PLAY.EXAMPLE.RU:25570',
      'Connection refused: play.example.ru/203.0.113.7:25570',
      'resolved [2001:db8::7]:25570',
    ].join('\n');
    const clean = redactText(text, { ...options, server });
    expect(clean.toLowerCase()).not.toContain('example');
    expect(clean).not.toMatch(/203\.0\.113|2001:db8/);
    expect(clean).toContain('[12:34:56] Connecting to <server>, 25570');
  });

  it('other servers keep their public addresses', () => {
    const text = 'Connecting to play.example.ru, 25570 (203.0.113.7)';
    expect(redactText(text, options)).toBe(text);
  });
});

describe('redacts personal data from reports', () => {
  it('matches player nickname case-insensitively, but not as part of other words', () => {
    expect(redactText('[Render thread/INFO]: Setting user: Frostbyte', options)).toBe(
      '[Render thread/INFO]: Setting user: <nick>',
    );
    expect(redactText('<FROSTBYTE> привет', options)).toBe('<<nick>> привет');
    expect(redactText('Frostbytes are cold', options)).toBe('Frostbytes are cold');
  });

  it('data folder and home folder, with both slash styles', () => {
    expect(
      redactText(
        'Mod file C:\\Users\\Vasya Petrov\\AppData\\Local\\MC Monitor\\game\\instances\\server-12\\mods\\a.jar',
        options,
      ),
    ).toBe('Mod file <game>\\instances\\server-12\\mods\\a.jar');
    expect(redactText('C:/Users/Vasya Petrov/Desktop/shot.png', options)).toBe(
      '~/Desktop/shot.png',
    );
  });

  it("other users' paths with a username on Windows, macOS and Linux", () => {
    const empty: RedactOptions = { nick: null, userName: null, homeDir: null, gameRoot: null };
    expect(redactText('D:\\Users\\petya\\mods\\x.jar', empty)).toBe(
      'D:\\Users\\<user>\\mods\\x.jar',
    );
    expect(redactText('/Users/vasya/Library/Application Support', empty)).toBe(
      '/Users/<user>/Library/Application Support',
    );
    expect(redactText('/home/vasya/.minecraft', empty)).toBe('/home/<user>/.minecraft');
  });

  it('tokens, UUIDs, launch arguments, JWT', () => {
    const empty: RedactOptions = { nick: null, userName: null, homeDir: null, gameRoot: null };
    const line =
      '--username Frostbyte --uuid 1f2e3d4c5b6a47988796a5b4c3d2e1f0 --accessToken 3f9c1b8e2d7a4c6b9e0f1a2b3c4d5e6f';
    const clean = redactText(line, empty);
    expect(clean).not.toMatch(/Frostbyte|1f2e3d4c|3f9c1b8e/);
    expect(
      redactText('Session ID is token:abc123:6a1f0e2d-9c8b-4a7f-b6e5-d4c3b2a1f0e9', empty),
    ).toBe('Session ID is token:<hidden>');
    expect(redactText('auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', empty)).toBe(
      'auth <token>',
    );
    expect(redactText('accessToken=abc.def-123&x=1', empty)).toBe('accessToken=<hidden>&x=1');
    expect(redactText('uuid 6a1f0e2d-9c8b-4a7f-b6e5-d4c3b2a1f0e9 joined', empty)).toBe(
      'uuid <uuid> joined',
    );
  });

  it('IP addresses and email, but not version numbers', () => {
    const empty: RedactOptions = { nick: null, userName: null, homeDir: null, gameRoot: null };
    expect(redactText('Connecting to 192.168.1.20, 25565', empty)).toBe(
      'Connecting to <ip>, 25565',
    );
    expect(redactText('forge-1.20.1-47.2.0.1.jar', empty)).toBe('forge-1.20.1-47.2.0.1.jar');
    expect(redactText('Minecraft 1.21.11 и 26.2', empty)).toBe('Minecraft 1.21.11 и 26.2');
    expect(redactText('mail vasya.petrov@example.ru', empty)).toBe('mail <email>');
  });

  it('hs_err: environment variables and command line', () => {
    const clean = redactLines(fixture('hs-err-insufficient').split('\n'), options).join('\n');
    expect(clean).not.toMatch(/Vasya|Petrov|Frostbyte|3f9c1b8e2d7a|1f2e3d4c5b6a/);
    expect(clean).toContain('USERNAME=<hidden>');
    expect(clean).toContain('There is insufficient memory for the Java Runtime Environment');
  });

  it('NeoForge 26.3.0.43, driver 21.40.11.03 and public server addresses are kept', () => {
    const empty: RedactOptions = { nick: null, userName: null, homeDir: null, gameRoot: null };
    expect(redactText('neoforge-26.3.0.43-beta-installer.jar', empty)).toBe(
      'neoforge-26.3.0.43-beta-installer.jar',
    );
    expect(redactText('NeoForge 26.3.0.43 loaded', empty)).toBe('NeoForge 26.3.0.43 loaded');
    expect(redactText('Driver version 21.40.11.03', empty)).toBe('Driver version 21.40.11.03');
    expect(redactText('Connecting to 203.0.113.10, 25565', empty)).toBe(
      'Connecting to 203.0.113.10, 25565',
    );
    expect(redactText('Connecting to play.example.ru, 25565', empty)).toBe(
      'Connecting to play.example.ru, 25565',
    );
    expect(redactText('lan 10.0.0.5 and 172.20.1.1 and 127.0.0.1.', empty)).toBe(
      'lan <ip> and <ip> and <ip>.',
    );
  });

  it('private IPv6 addresses, including compressed form', () => {
    expect(isPrivateIpv6('fe80::1c2b:3a4d')).toBe(true);
    expect(isPrivateIpv6('fd12:3456::1')).toBe(true);
    expect(isPrivateIpv6('::1')).toBe(true);
    expect(isPrivateIpv6('2a01:4f8::1')).toBe(false);
    expect(isPrivateIpv4('192.168.0.1')).toBe(true);
    expect(isPrivateIpv4('300.1.1.1')).toBe(false);
    const empty: RedactOptions = { nick: null, userName: null, homeDir: null, gameRoot: null };
    expect(redactText('bind fe80::1c2b:3a4d%eth0 at 12:34:56', empty)).toBe(
      'bind <ip> at 12:34:56',
    );
  });

  it('classpath entries with slashes and asset hashes are not turned into <token>', () => {
    const empty: RedactOptions = { nick: null, userName: null, homeDir: null, gameRoot: null };
    const frame = 'at com/mojang/blaze3d/systems/RenderSystem$GpuDeviceAccessor.lambda1';
    expect(redactText(frame, empty)).toBe(frame);
    const asset = 'assets/objects/ab/ab4f9c1b8e2d7a4c6b9e0f1a2b3c4d5e6f7a8b9c';
    expect(redactText(asset, empty)).toBe(asset);
    expect(redactText('token Zx9Kq2Lm7Pw4Rt8Yv1Bn6Hc3Js5Df0Ga2Wq9Er4Ty7', empty)).toBe(
      'token <token>',
    );
  });

  it('username with a space when there is no home folder in settings', () => {
    const named: RedactOptions = {
      nick: null,
      userName: 'Иван Петров',
      homeDir: null,
      gameRoot: null,
    };
    expect(redactText('C:\\Users\\Иван Петров\\AppData\\Roaming\\x.log', named)).toBe(
      'C:\\Users\\<user>\\AppData\\Roaming\\x.log',
    );
    const empty: RedactOptions = { nick: null, userName: null, homeDir: null, gameRoot: null };
    expect(redactText('C:\\Users\\John Smith\\Desktop\\a.png', empty)).toBe(
      'C:\\Users\\<user>\\Desktop\\a.png',
    );
  });

  it('nickname is a common word: does not wipe the log, only hides "Setting user"', () => {
    const plain: RedactOptions = {
      nick: 'Player',
      userName: 'main',
      homeDir: null,
      gameRoot: null,
    };
    expect(redactText('[Render thread/INFO]: Setting user: Player', plain)).toBe(
      '[Render thread/INFO]: Setting user: <nick>',
    );
    expect(redactText('[main/INFO]: Player moved wrongly', plain)).toBe(
      '[main/INFO]: Player moved wrongly',
    );
    const short: RedactOptions = { nick: 'Al', userName: null, homeDir: null, gameRoot: null };
    expect(redactText('Alpha Al', short)).toBe('Alpha Al');
  });

  it('truncates overly long lines', () => {
    const [line] = redactLines(['x'.repeat(2000)], options);
    expect(line?.length).toBe(500);
  });
});
