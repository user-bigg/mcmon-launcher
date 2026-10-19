import { createHash, randomBytes } from 'node:crypto';

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

export type RandomBytes = (size: number) => Buffer;

const VERIFIER_BYTES = 32;
const STATE_BYTES = 24;

export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function createPkce(random: RandomBytes = randomBytes): Pkce {
  const verifier = random(VERIFIER_BYTES).toString('base64url');
  return {
    verifier,
    challenge: challengeOf(verifier),
    state: random(STATE_BYTES).toString('base64url'),
  };
}
