import { app, session } from 'electron';
import type { WebContents } from 'electron';
import { contentSecurityPolicy } from './csp';
import { isTrustedUrl } from './origins';

export function hardenApp(devServerUrl: string | undefined): void {
  app.on('web-contents-created', (_event, contents) => {
    restrictNavigation(contents, devServerUrl);
  });
}

export function applyDevCsp(devServerUrl: string): void {
  const csp = contentSecurityPolicy(devServerUrl);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(
        ([name]) => name.toLowerCase() !== 'content-security-policy',
      ),
    );
    callback({ responseHeaders: { ...headers, 'Content-Security-Policy': [csp] } });
  });
}

const TRUSTED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

export function isPermissionAllowed(
  permission: string,
  origin: string | undefined,
  devServerUrl: string | undefined,
): boolean {
  return (
    TRUSTED_PERMISSIONS.has(permission) &&
    origin !== undefined &&
    isTrustedUrl(origin, devServerUrl)
  );
}

export function restrictPermissions(devServerUrl: string | undefined): void {
  const current = session.defaultSession;
  current.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isPermissionAllowed(permission, details.requestingUrl, devServerUrl));
  });
  current.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, devServerUrl),
  );
  current.setDevicePermissionHandler(() => false);
}

function restrictNavigation(contents: WebContents, devServerUrl: string | undefined): void {
  const allowOnlyTrusted = (event: Electron.Event, url: string): void => {
    if (!isTrustedUrl(url, devServerUrl)) {
      event.preventDefault();
    }
  };
  contents.on('will-navigate', allowOnlyTrusted);
  contents.on('will-redirect', allowOnlyTrusted);
  contents.on('will-frame-navigate', (event) => {
    allowOnlyTrusted(event, event.url);
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
