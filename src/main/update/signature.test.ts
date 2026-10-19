import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UPDATE_PUBLIC_KEY } from '@shared/update-key';
import {
  generateUpdateKeys,
  parseSignatureFile,
  privateKeyFromBase64,
  publicKeyFromBase64,
  publicKeyOf,
  sha512File,
  signedMessage,
  signRelease,
  verifyRelease,
  versionFromInstallerName,
} from './signature';

const SHA512 = createHash('sha512').update('installer').digest('base64');
const RELEASE = { version: '0.2.0', sha512: SHA512 };
const SCRIPT = resolve(import.meta.dirname, '../../../scripts/update-signing.ts');

describe('ed25519 update signature', () => {
  const keys = generateUpdateKeys();
  const privateKey = privateKeyFromBase64(keys.privateKey);

  it('a signature with its own key passes, the public key is 32 bytes base64', () => {
    const signature = signRelease(RELEASE, privateKey);
    expect(Buffer.from(keys.publicKey, 'base64')).toHaveLength(32);
    expect(publicKeyOf(privateKey)).toBe(keys.publicKey);
    expect(verifyRelease(RELEASE, signature, keys.publicKey)).toBe(true);
    expect(verifyRelease(RELEASE, `${signature}\n`, keys.publicKey)).toBe(true);
  });

  it('a foreign key, a different file, a different version — do not pass', () => {
    const signature = signRelease(RELEASE, privateKey);
    const other = generateUpdateKeys();
    expect(verifyRelease(RELEASE, signature, other.publicKey)).toBe(false);
    const otherFile = createHash('sha512').update('installer2').digest('base64');
    expect(verifyRelease({ ...RELEASE, sha512: otherFile }, signature, keys.publicKey)).toBe(false);
    expect(verifyRelease({ ...RELEASE, version: '0.1.0' }, signature, keys.publicKey)).toBe(false);
  });

  it('garbage instead of a signature and key — false, not an exception', () => {
    expect(verifyRelease(RELEASE, 'not a signature', keys.publicKey)).toBe(false);
    expect(verifyRelease(RELEASE, '', keys.publicKey)).toBe(false);
    expect(verifyRelease(RELEASE, signRelease(RELEASE, privateKey), 'AAAA')).toBe(false);
    expect(verifyRelease({ ...RELEASE, sha512: 'abc' }, 'x', keys.publicKey)).toBe(false);
    expect(publicKeyFromBase64('x')).toBeNull();
    expect(parseSignatureFile(' \n')).toBeNull();
    expect(() => signRelease({ ...RELEASE, sha512: 'abc' }, privateKey)).toThrow();
  });

  it('the message binds version and hash, and the version is taken from the installer name', () => {
    expect(signedMessage(RELEASE).toString()).toBe(
      `mcmonitor-launcher-update/v1\n0.2.0\n${SHA512}\n`,
    );
    expect(versionFromInstallerName('mcmonitor-launcher-0.2.0-win-x64.exe')).toBe('0.2.0');
    expect(versionFromInstallerName('mcmonitor-launcher-26.2.0-beta.1-win-x64.exe')).toBe(
      '26.2.0-beta.1',
    );
    expect(versionFromInstallerName('mcmonitor-launcher-0.2.0-mac-arm64.zip')).toBe('0.2.0');
    expect(versionFromInstallerName('mcmonitor-launcher-0.2.0-win-x64.zip')).toBeNull();
    expect(versionFromInstallerName('mcmonitor-launcher-0.2.0-mac-arm64.dmg')).toBeNull();
  });

  it('the key in the app is a valid ed25519 key', () => {
    expect(publicKeyFromBase64(UPDATE_PUBLIC_KEY)).not.toBeNull();
  });
});

describe('scripts/update-sign and update-verify', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcmonitor-sign-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(args: string[], env: Record<string, string> = {}): { code: number; out: string } {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, UPDATE_SIGNING_KEY: '', ...env },
    });
    return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
  }

  it('a key is generated, a signature is created and verified, tampering with the file is caught', async () => {
    const keyFile = join(dir, 'update.key');
    const keygen = run(['keygen', keyFile]);
    expect(keygen.code).toBe(0);
    const publicKey = /public key for [^:]+: (\S+)/.exec(keygen.out)?.[1] ?? '';
    expect(publicKeyFromBase64(publicKey)).not.toBeNull();
    expect(run(['keygen', keyFile]).code).toBe(2);

    const installer = join(dir, 'mcmonitor-launcher-0.2.0-win-x64.exe');
    writeFileSync(installer, 'installer bytes');
    expect(run(['sign', installer, keyFile]).code).toBe(2);
    expect(run(['sign', installer, keyFile, '--public-key', publicKey]).code).toBe(0);
    expect(run(['verify', installer, '--public-key', publicKey]).code).toBe(0);
    expect(run(['verify', installer]).code).toBe(1);

    const signature = readFileSync(`${installer}.sig`, 'utf8').trim();
    expect(
      verifyRelease(
        { version: '0.2.0', sha512: await sha512File(installer) },
        signature,
        publicKey,
      ),
    ).toBe(true);

    writeFileSync(installer, 'installer bytes!');
    expect(run(['verify', installer, '--public-key', publicKey]).code).toBe(1);
  });

  it('key from the environment, without a key — a clear error', () => {
    const keys = generateUpdateKeys();
    const installer = join(dir, 'mcmonitor-launcher-0.3.0-win-x64.exe');
    writeFileSync(installer, 'x');
    expect(run(['sign', installer]).out).toMatch(/no private key/);
    const signed = run(['sign', installer, '--public-key', keys.publicKey], {
      UPDATE_SIGNING_KEY: keys.privateKey,
    });
    expect(signed.code).toBe(0);
    expect(run(['verify', installer, '--public-key', keys.publicKey]).code).toBe(0);
    expect(
      run(['verify', installer, '--public-key', keys.publicKey, '--version', '0.4.0']).code,
    ).toBe(1);
  });
});
