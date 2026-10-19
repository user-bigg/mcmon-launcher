import type { FetchLike } from '../launch/json-cache';
import { isRecord } from '../site/guards';
import { AUTHORIZE_ENDPOINT, MICROSOFT_SCOPES, TOKEN_ENDPOINT } from './config';
import { MicrosoftFailure, microsoftFailure } from './errors';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TOKEN_LENGTH = 16_384;

export interface AuthorizeParams {
  clientId: string;
  challenge: string;
  state: string;
  redirectUri: string;
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
}

export function httpsOnly(fetch: FetchLike, timeoutMs = REQUEST_TIMEOUT_MS): FetchLike {
  return async (url, init) => {
    if (URL.parse(url)?.protocol !== 'https:') {
      throw microsoftFailure('failed');
    }
    try {
      return await fetch(url, {
        ...init,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw microsoftFailure('offline');
    }
  };
}

export function authorizeUrl(params: AuthorizeParams): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', MICROSOFT_SCOPES.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return url.href;
}

function token(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
    ? value
    : null;
}

async function jsonOf(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return null;
  }
}

async function requestTokens(
  fetch: FetchLike,
  clientId: string,
  grant: Record<string, string>,
): Promise<MicrosoftTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: MICROSOFT_SCOPES.join(' '),
      ...grant,
    }).toString(),
  });
  const body = await jsonOf(response);
  if (!response.ok) {
    throw microsoftFailure(
      isRecord(body) && body.error === 'invalid_grant' ? 'relogin_required' : 'failed',
    );
  }
  const accessToken = isRecord(body) ? token(body.access_token) : null;
  const refreshToken = isRecord(body) ? token(body.refresh_token) : null;
  if (accessToken === null || refreshToken === null) {
    throw microsoftFailure('failed');
  }
  return { accessToken, refreshToken };
}

export async function exchangeCode(
  fetch: FetchLike,
  clientId: string,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<MicrosoftTokens> {
  try {
    return await requestTokens(fetch, clientId, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  } catch (error) {
    // A rejected code is a failed sign-in, not a revoked account.
    throw error instanceof MicrosoftFailure && error.code === 'relogin_required'
      ? microsoftFailure('failed')
      : error;
  }
}

export function refreshTokens(
  fetch: FetchLike,
  clientId: string,
  refreshToken: string,
): Promise<MicrosoftTokens> {
  return requestTokens(fetch, clientId, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}
