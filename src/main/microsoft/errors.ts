import type { LaunchError } from '@shared/launch';
import type { MicrosoftError, MicrosoftErrorCode } from '@shared/microsoft';

export class MicrosoftFailure extends Error {
  constructor(readonly code: MicrosoftErrorCode) {
    super(code);
    this.name = 'MicrosoftFailure';
  }
}

export function microsoftFailure(code: MicrosoftErrorCode): MicrosoftFailure {
  return new MicrosoftFailure(code);
}

// Messages of foreign errors may quote a response body, so only our own codes leave this module.
export function microsoftCodeOf(error: unknown): MicrosoftErrorCode {
  return error instanceof MicrosoftFailure ? error.code : 'failed';
}

export function microsoftRejected(code: MicrosoftErrorCode): { ok: false; error: MicrosoftError } {
  return { ok: false, error: { code } };
}

export function launchErrorOf(code: MicrosoftErrorCode): LaunchError {
  if (code === 'relogin_required' || code === 'not_found') {
    return { code: 'account-relogin' };
  }
  if (code === 'offline') {
    return { code: 'network', url: null, reason: 'connection' };
  }
  return { code: 'account-failed', reason: code };
}
