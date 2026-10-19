const MS_CLIENT_ID_ENV = 'MCMONITOR_MS_CLIENT_ID';

export const REDIRECT_HOST = '127.0.0.1';
export const REDIRECT_PORT = 3001;
export const REDIRECT_PATH = '/redirect';
// Microsoft ignores the port when it matches a localhost redirect address (RFC 8252, 7.3),
// so a free port works when the usual one is taken.
export function redirectUri(port: number): string {
  return `http://localhost:${String(port)}${REDIRECT_PATH}`;
}

export const MICROSOFT_SCOPES = ['XboxLive.signin', 'offline_access'] as const;

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
export const AUTHORIZE_ENDPOINT = `${AUTHORITY}/authorize`;
export const TOKEN_ENDPOINT = `${AUTHORITY}/token`;

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A packaged launcher takes the id from its build, so a variable in the user's environment
// cannot point the sign-in at someone else's application.
export function msClientId(
  packaged: boolean,
  env: NodeJS.ProcessEnv,
  built: string | undefined,
): string | null {
  const value = (packaged ? built : env[MS_CLIENT_ID_ENV])?.trim() ?? '';
  return CLIENT_ID.test(value) ? value : null;
}
