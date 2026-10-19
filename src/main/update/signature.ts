import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { createReadStream } from 'node:fs';

export const SIGNATURE_CONTEXT = 'mcmonitor-launcher-update/v1';
export const SIGNATURE_SUFFIX = '.sig';
export const MAX_SIGNATURE_FILE_BYTES = 512;

const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const PUBLIC_KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/;
const INSTALLER_NAME =
  /^mcmonitor-launcher-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(?:win-x64\.exe|mac-arm64\.zip)$/;

export interface SignedRelease {
  version: string;
  sha512: string;
}

export interface UpdateKeys {
  publicKey: string;
  privateKey: string;
}

export function isSha512Base64(value: unknown): value is string {
  return typeof value === 'string' && SHA512_BASE64.test(value);
}

export function signedMessage(release: SignedRelease): Buffer {
  return Buffer.from(`${SIGNATURE_CONTEXT}\n${release.version}\n${release.sha512}\n`, 'utf8');
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(base64url: string): string {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
}

export function publicKeyFromBase64(raw: string): KeyObject | null {
  if (!PUBLIC_KEY_BASE64.test(raw)) {
    return null;
  }
  try {
    return createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: toBase64Url(raw) },
      format: 'jwk',
    });
  } catch {
    return null;
  }
}

export function privateKeyFromBase64(pkcs8: string): KeyObject {
  const key = createPrivateKey({
    key: Buffer.from(pkcs8.trim(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('update signing key must be ed25519');
  }
  return key;
}

export function publicKeyOf(key: KeyObject): string {
  const publicKey = key.type === 'public' ? key : createPublicKey(key);
  const jwk = publicKey.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') {
    throw new Error('not an ed25519 key');
  }
  return fromBase64Url(jwk.x);
}

export function generateUpdateKeys(): UpdateKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKeyOf(publicKey),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

export function signRelease(release: SignedRelease, privateKey: KeyObject): string {
  if (!isSha512Base64(release.sha512)) {
    throw new Error('sha512 must be base64 of 64 bytes');
  }
  return sign(null, signedMessage(release), privateKey).toString('base64');
}

export function parseSignatureFile(text: string): string | null {
  const value = text.trim();
  return SIGNATURE_BASE64.test(value) ? value : null;
}

export function verifyRelease(
  release: SignedRelease,
  signature: string,
  publicKey: string,
): boolean {
  const key = publicKeyFromBase64(publicKey);
  const parsed = parseSignatureFile(signature);
  if (key === null || parsed === null || !isSha512Base64(release.sha512)) {
    return false;
  }
  try {
    return verify(null, signedMessage(release), key, Buffer.from(parsed, 'base64'));
  } catch {
    return false;
  }
}

export function versionFromInstallerName(name: string): string | null {
  return INSTALLER_NAME.exec(name)?.[1] ?? null;
}

export function sha512File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => {
        resolve(hash.digest('base64'));
      });
  });
}
