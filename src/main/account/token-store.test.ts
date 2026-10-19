import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENCRYPTED_FORMAT, PLAIN_FORMAT, TokenStore, type SecretCipher } from './token-store';

const TOKEN = '12|mcml_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const SESSION = { token: TOKEN, user: { id: 7, name: 'Игрок', avatarUrl: null }, nick: null };

function cipher(available = true): SecretCipher & { calls: number } {
  const state = {
    calls: 0,
    isEncryptionAvailable: (): boolean => available,
    encryptString: (plain: string): Buffer => {
      state.calls += 1;
      return Buffer.from([...Buffer.from(plain, 'utf8')].map((byte) => byte ^ 0x5a));
    },
    decryptString: (encrypted: Buffer): string =>
      Buffer.from([...encrypted].map((byte) => byte ^ 0x5a)).toString('utf8'),
  };
  return state;
}

let dir: string | undefined;

async function file(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'mcmon-account-'));
  return join(dir, 'account.json');
}

afterEach(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe('token storage', () => {
  it('writes only encrypted data with the ENC1 marker and reads it back', async () => {
    const path = await file();
    const store = new TokenStore(path, cipher());
    expect(await store.save(SESSION)).toBe(true);
    const raw = await readFile(path, 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ format: ENCRYPTED_FORMAT });
    expect(raw).not.toContain('mcml_');
    expect(raw).not.toContain('Игрок');
    expect(await store.load()).toEqual({ kind: 'session', session: SESSION });
  });

  it('keeps the pinned nickname, so an offline start still plays under it', async () => {
    const store = new TokenStore(await file(), cipher());
    const pinned = { ...SESSION, nick: { name: 'Test_User', changeAt: '2026-11-12T09:00:00Z' } };
    await store.save(pinned);
    expect(await store.load()).toEqual({ kind: 'session', session: pinned });
  });

  it('a file written before pinned nicknames still signs in', async () => {
    const path = await file();
    const plain = JSON.stringify({
      token: TOKEN,
      user: { id: 7, name: 'Игрок', avatar_url: null },
    });
    const data = cipher().encryptString(plain).toString('base64');
    await writeFile(path, JSON.stringify({ format: ENCRYPTED_FORMAT, data }));
    expect(await new TokenStore(path, cipher()).load()).toEqual({
      kind: 'session',
      session: SESSION,
    });
  });

  it('a write still in flight does not bring the file back after sign-out', async () => {
    const path = await file();
    const store = new TokenStore(path, cipher());
    const saving = store.save(SESSION);
    const clearing = store.clear();
    await Promise.all([saving, clearing]);
    await expect(readFile(path)).rejects.toThrow();
  });

  it('two writes in a row leave the later nickname on disk', async () => {
    const store = new TokenStore(await file(), cipher());
    const later = { ...SESSION, nick: { name: 'Later', changeAt: null } };
    await Promise.all([
      store.save({ ...SESSION, nick: { name: 'Earlier', changeAt: null } }),
      store.save(later),
    ]);
    expect(await store.load()).toEqual({ kind: 'session', session: later });
  });

  it('without encryption, does not save and does not fall back to plain text', async () => {
    const path = await file();
    const unavailable = cipher(false);
    const store = new TokenStore(path, unavailable);
    expect(await store.save(SESSION)).toBe(false);
    expect(unavailable.calls).toBe(0);
    await expect(readFile(path)).rejects.toThrow();
    expect(store.available()).toBe(false);
  });

  it('a RAW1 file or one without a marker is rejected and deleted', async () => {
    const path = await file();
    await writeFile(path, JSON.stringify({ format: PLAIN_FORMAT, data: TOKEN }));
    expect(await new TokenStore(path, cipher()).load()).toEqual({ kind: 'none' });
    await expect(readFile(path)).rejects.toThrow();
    await writeFile(path, JSON.stringify({ token: TOKEN }));
    expect(await new TokenStore(path, cipher()).load()).toEqual({ kind: 'none' });
  });

  it('encryption becomes unavailable — file stays, sign-in is unavailable', async () => {
    const path = await file();
    await new TokenStore(path, cipher()).save(SESSION);
    expect(await new TokenStore(path, cipher(false)).load()).toEqual({ kind: 'locked' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ format: ENCRYPTED_FORMAT });
  });

  it('decryption fails or the token is malformed — file is deleted', async () => {
    const path = await file();
    await writeFile(path, JSON.stringify({ format: ENCRYPTED_FORMAT, data: 'bm9wZQ==' }));
    expect(await new TokenStore(path, cipher()).load()).toEqual({ kind: 'none' });
    await expect(readFile(path)).rejects.toThrow();
    const store = new TokenStore(path, cipher());
    await store.save({ ...SESSION, token: 'not a token' });
    expect(await store.load()).toEqual({ kind: 'none' });
  });

  it('clear deletes the file', async () => {
    const path = await file();
    const store = new TokenStore(path, cipher());
    await store.save(SESSION);
    await store.clear();
    expect(await store.load()).toEqual({ kind: 'none' });
  });
});
