import type { LaunchError } from '@shared/launch';

export const HIDDEN = '<hidden>';

const ACCESS_TOKEN_ARGUMENT = /(--accessToken[\s=]+)["']?[^\s"']+["']?/gi;
const SESSION_TOKEN = /\btoken:[^\s:)]+/gi;
const MIN_SECRET_LENGTH = 8;

function withoutValues(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) {
      result = result.replaceAll(secret, HIDDEN);
    }
  }
  return result;
}

// The game and the JVM print their own command line (old versions log 'Session ID is
// token:…', a JVM crash prints java_command), so the token is removed both by its value and by
// the places where it is known to appear.
export function scrubSecrets(text: string, secrets: readonly string[] = []): string {
  return withoutValues(text, secrets)
    .replace(ACCESS_TOKEN_ARGUMENT, `$1${HIDDEN}`)
    .replace(SESSION_TOKEN, `token:${HIDDEN}`);
}

function mayHoldSecret(text: string, secrets: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('accesstoken') ||
    lower.includes('token:') ||
    secrets.some((secret) => text.includes(secret))
  );
}

// latin1 maps every byte to one character and back, so game output in any ASCII-compatible
// encoding survives the round trip untouched.
export function scrubBytes(chunk: Buffer, secrets: readonly string[]): Buffer {
  const text = chunk.toString('latin1');
  return mayHoldSecret(text, secrets) ? Buffer.from(scrubSecrets(text, secrets), 'latin1') : chunk;
}

export function scrubLaunchError(error: LaunchError, secrets: readonly string[]): LaunchError {
  return 'message' in error ? { ...error, message: scrubSecrets(error.message, secrets) } : error;
}
