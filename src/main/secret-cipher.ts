import { safeStorage } from 'electron';
import type { SecretCipher } from './account/token-store';

// On Linux without a keyring safeStorage 'encrypts' with a constant key: that is plain text.
export function electronCipher(): SecretCipher {
  return {
    isEncryptionAvailable: (): boolean =>
      safeStorage.isEncryptionAvailable() &&
      !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
    encryptString: (plain): Buffer => safeStorage.encryptString(plain),
    decryptString: (encrypted): string => safeStorage.decryptString(encrypted),
  };
}
