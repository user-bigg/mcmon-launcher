import { readFile, rm } from 'node:fs/promises';
import { isMicrosoftAccountId, MAX_MICROSOFT_ACCOUNTS } from '@shared/microsoft';
import { ENCRYPTED_FORMAT, OWNER_ONLY, type SecretCipher } from '../account/token-store';
import { withFsRetry } from '../launch/fs-retry';
import { writeJsonAtomic } from '../launch/json-cache';
import { isRecord } from '../site/guards';

export interface StoredMicrosoftAccount {
  id: string;
  uuid: string;
  nick: string;
  refreshToken: string | null;
}

export type LoadedMicrosoft =
  | { kind: 'loaded'; accounts: StoredMicrosoftAccount[] }
  | { kind: 'locked' }
  | { kind: 'unreadable' };

const EMPTY: LoadedMicrosoft = { kind: 'loaded', accounts: [] };

function parseAccount(value: unknown): StoredMicrosoftAccount | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, uuid, nick, refreshToken } = value;
  if (!isMicrosoftAccountId(id) || typeof uuid !== 'string' || typeof nick !== 'string') {
    return null;
  }
  return { id, uuid, nick, refreshToken: typeof refreshToken === 'string' ? refreshToken : null };
}

function parseAccounts(value: unknown): StoredMicrosoftAccount[] | null {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    return null;
  }
  return value.accounts
    .map(parseAccount)
    .filter((account): account is StoredMicrosoftAccount => account !== null)
    .slice(0, MAX_MICROSOFT_ACCOUNTS);
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

export class MicrosoftStore {
  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher,
  ) {}

  available(): boolean {
    try {
      return this.cipher.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  // Only a file that was read and turned out to be garbage is removed: a file that is busy or
  // unreadable right now still holds the accounts.
  async load(): Promise<LoadedMicrosoft> {
    let text: string;
    try {
      text = await withFsRetry(() => readFile(this.file, 'utf8'));
    } catch (error) {
      return isMissing(error) ? EMPTY : { kind: 'unreadable' };
    }
    const stored = jsonOrNull(text);
    if (
      !isRecord(stored) ||
      stored.format !== ENCRYPTED_FORMAT ||
      typeof stored.data !== 'string'
    ) {
      await this.clear();
      return EMPTY;
    }
    if (!this.available()) {
      return { kind: 'locked' };
    }
    const accounts = this.decrypt(stored.data);
    if (accounts === null) {
      await this.clear();
      return EMPTY;
    }
    return { kind: 'loaded', accounts };
  }

  async save(accounts: StoredMicrosoftAccount[]): Promise<boolean> {
    if (accounts.length === 0) {
      await this.clear();
      return true;
    }
    if (!this.available()) {
      return false;
    }
    let data: string;
    try {
      data = this.cipher.encryptString(JSON.stringify({ accounts })).toString('base64');
    } catch {
      return false;
    }
    await writeJsonAtomic(this.file, { format: ENCRYPTED_FORMAT, data }, { mode: OWNER_ONLY });
    return true;
  }

  private async clear(): Promise<void> {
    await withFsRetry(() => rm(this.file, { force: true }));
  }

  private decrypt(data: string): StoredMicrosoftAccount[] | null {
    try {
      return parseAccounts(JSON.parse(this.cipher.decryptString(Buffer.from(data, 'base64'))));
    } catch {
      return null;
    }
  }
}
