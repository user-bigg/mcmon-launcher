import { rm } from 'node:fs/promises';
import { readJson, writeJsonAtomic } from '../launch/json-cache';
import { isRecord } from '../site/guards';
import type { PinnedNick } from '@shared/account';
import {
  isLauncherToken,
  parsePinnedNick,
  parseSessionUser,
  sessionUserBody,
  type SessionUser,
} from './parse';

export const OWNER_ONLY = 0o600;
export const ENCRYPTED_FORMAT = 'ENC1';
export const PLAIN_FORMAT = 'RAW1';

export interface SecretCipher {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

export interface StoredSession {
  token: string;
  user: SessionUser;
  nick: PinnedNick | null;
}

export type LoadedSession =
  { kind: 'none' } | { kind: 'locked' } | { kind: 'session'; session: StoredSession };

function parseSession(value: unknown): StoredSession | null {
  if (!isRecord(value) || !isLauncherToken(value.token)) {
    return null;
  }
  const user = parseSessionUser(value.user);
  return user === null ? null : { token: value.token, user, nick: parsePinnedNick(value.pinned) };
}

export class TokenStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher,
  ) {}

  // Writes and the removal go one after another: a write still in flight must not bring the
  // file back after sign-out, and a later write must not land before an earlier one.
  private inOrder<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  available(): boolean {
    try {
      return this.cipher.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async load(): Promise<LoadedSession> {
    const stored = await readJson(this.file);
    if (stored === null) {
      return { kind: 'none' };
    }
    if (
      !isRecord(stored) ||
      stored.format !== ENCRYPTED_FORMAT ||
      typeof stored.data !== 'string'
    ) {
      await this.clear();
      return { kind: 'none' };
    }
    if (!this.available()) {
      return { kind: 'locked' };
    }
    const session = this.decrypt(stored.data);
    if (session === null) {
      await this.clear();
      return { kind: 'none' };
    }
    return { kind: 'session', session };
  }

  async save(session: StoredSession): Promise<boolean> {
    if (!this.available()) {
      return false;
    }
    let data: string;
    try {
      const plain = JSON.stringify({
        token: session.token,
        user: sessionUserBody(session.user),
        ...(session.nick === null
          ? {}
          : { pinned: { nick: session.nick.name, nick_change_at: session.nick.changeAt } }),
      });
      data = this.cipher.encryptString(plain).toString('base64');
    } catch {
      return false;
    }
    await this.inOrder(() =>
      writeJsonAtomic(this.file, { format: ENCRYPTED_FORMAT, data }, { mode: OWNER_ONLY }),
    );
    return true;
  }

  clear(): Promise<void> {
    return this.inOrder(() => rm(this.file, { force: true }));
  }

  private decrypt(data: string): StoredSession | null {
    try {
      return parseSession(JSON.parse(this.cipher.decryptString(Buffer.from(data, 'base64'))));
    } catch {
      return null;
    }
  }
}
