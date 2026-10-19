import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider';
import { describe, expect, it } from 'vitest';
import { UPDATE_BASE_URL } from '@shared/update';
import { installerRelease, releaseNotes, resolveUnderBase } from './release';

const LATEST = readFileSync(join(import.meta.dirname, 'fixtures/latest.yml'), 'utf8');
const SHA512 =
  'Q0ly/4VcMkhW3KPj3b11n0XYudx+v3GQltjEy9kK8PWf9xJBXL4A+hg9D5JYujSg5Efwro87vUqA3uwFCXRtlg==';

function parsed(text = LATEST): unknown {
  return parseUpdateInfo(text, 'latest.yml', new URL('latest.yml', UPDATE_BASE_URL));
}

const LATEST_MAC = readFileSync(join(import.meta.dirname, 'fixtures/latest-mac.yml'), 'utf8');

describe('latest-mac.yml', () => {
  it('takes the zip, not the disk image, with its .sig alongside', () => {
    const info = parseUpdateInfo(
      LATEST_MAC,
      'latest-mac.yml',
      new URL('latest-mac.yml', UPDATE_BASE_URL),
    );
    expect(installerRelease(info, UPDATE_BASE_URL, 'zip')).toEqual({
      version: '0.2.0',
      url: 'https://mc-mon.ru/downloads/launcher/mcmonitor-launcher-0.2.0-mac-arm64.zip',
      signatureUrl:
        'https://mc-mon.ru/downloads/launcher/mcmonitor-launcher-0.2.0-mac-arm64.zip.sig',
      sha512:
        'VfkSq7GApcCl1CRuwf//5BU2U/ezscjeLyzaOUbF8bfve/vjqAHe0pZ3mXXyf1SXgzO2ltZFE4K54PTYa+hcbg==',
    });
    expect(installerRelease(info, UPDATE_BASE_URL)).toBeNull();
  });
});

describe('latest.yml', () => {
  it('parses the same way as electron-updater: version, installer, sha512, .sig alongside', () => {
    expect(installerRelease(parsed(), UPDATE_BASE_URL)).toEqual({
      version: '0.2.0',
      url: 'https://mc-mon.ru/downloads/launcher/mcmonitor-launcher-0.2.0-win-x64.exe',
      signatureUrl: 'https://mc-mon.ru/downloads/launcher/mcmonitor-launcher-0.2.0-win-x64.exe.sig',
      sha512: SHA512,
    });
  });

  it('release notes — plain text without markup', () => {
    const info = parsed() as { releaseNotes: unknown };
    expect(releaseNotes(info.releaseNotes)).toBe(
      '0.2.0\n\nUpdates install when you quit the launcher\nPing & online in the catalog',
    );
    expect(releaseNotes([{ version: '0.2.0', note: '<p>One</p>' }, { note: 'Two' }])).toBe(
      'One\n\nTwo',
    );
    expect(releaseNotes(null)).toBeNull();
    expect(releaseNotes('<p> </p>')).toBeNull();
    expect(releaseNotes('x'.repeat(5000))?.length).toBe(2000);
  });

  it('installer only over https from our update address', () => {
    for (const url of [
      'https://evil.example/mcmonitor-launcher-0.2.0-win-x64.exe',
      'http://mc-mon.ru/downloads/launcher/a.exe',
      '../../a.exe',
      'https://user:pass@mc-mon.ru/downloads/launcher/a.exe',
      'a.exe?x=1',
    ]) {
      const text = LATEST.replace('url: mcmonitor-launcher-0.2.0-win-x64.exe', `url: '${url}'`);
      expect(installerRelease(parsed(text), UPDATE_BASE_URL)).toBeNull();
    }
    expect(resolveUnderBase('sub/a.exe', UPDATE_BASE_URL)).toBe(
      'https://mc-mon.ru/downloads/launcher/sub/a.exe',
    );
  });

  it('malformed entries are dropped: version, sha512, missing exe', () => {
    expect(
      installerRelease(
        parsed(LATEST.replace('version: 0.2.0', 'version: latest')),
        UPDATE_BASE_URL,
      ),
    ).toBeNull();
    expect(installerRelease(parsed(LATEST.replaceAll(SHA512, 'abc')), UPDATE_BASE_URL)).toBeNull();
    expect(
      installerRelease(
        parsed(LATEST.replace('win-x64.exe\n    sha512', 'win-x64.zip\n    sha512')),
        UPDATE_BASE_URL,
      ),
    ).toBeNull();
    expect(installerRelease(null, UPDATE_BASE_URL)).toBeNull();
  });

  it('versions like 26.2.0 and beta also pass', () => {
    const beta = LATEST.replaceAll('0.2.0', '26.2.0-beta.1');
    expect(installerRelease(parsed(beta), UPDATE_BASE_URL)?.version).toBe('26.2.0-beta.1');
  });

  it('the installer path cannot escape the update address by any workaround', () => {
    for (const path of [
      '//evil.example/a.exe',
      '\\\\evil.example\\a.exe',
      '/\\evil.example/a.exe',
      'https://mc-mon.ru/downloads/launcher/../evil.exe',
      '..%2fevil.exe',
      '%2e%2e/%2e%2e/evil.exe',
      'https://mc-mon.ru/downloads/launcher-evil/a.exe',
      'https://mc-mon.ru:444/downloads/launcher/a.exe',
      'https://mc-mon.ru.evil.example/downloads/launcher/a.exe',
      'https://mc-mon.ru@evil.example/downloads/launcher/a.exe',
      'a.exe#x',
      'file:///C:/a.exe',
      'javascript:alert(1)',
    ]) {
      const resolved = resolveUnderBase(path, UPDATE_BASE_URL);
      const inside = resolved === null || resolved.startsWith(UPDATE_BASE_URL);
      expect({ path, inside }).toEqual({ path, inside: true });
    }
  });
});
