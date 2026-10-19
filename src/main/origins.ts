export const APP_SCHEME = 'app';
export const APP_HOST = 'launcher';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

interface Origin {
  protocol: string;
  host: string;
}

function parseOrigin(url: string): Origin | null {
  try {
    const parsed = new URL(url);
    return { protocol: parsed.protocol, host: parsed.host };
  } catch {
    return null;
  }
}

export function trustedOrigin(devServerUrl: string | undefined): string {
  if (devServerUrl === undefined) {
    return APP_ORIGIN;
  }
  const origin = parseOrigin(devServerUrl);
  if (origin === null) {
    throw new Error(`Invalid dev server URL: ${devServerUrl}`);
  }
  return `${origin.protocol}//${origin.host}`;
}

export function isTrustedUrl(url: string, devServerUrl: string | undefined): boolean {
  const origin = parseOrigin(url);
  if (origin === null) {
    return false;
  }
  return `${origin.protocol}//${origin.host}` === trustedOrigin(devServerUrl);
}
