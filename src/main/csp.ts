import { APP_ORIGIN } from './origins';

export function contentSecurityPolicy(devServerUrl: string | undefined): string {
  const self = "'self'";
  const directives = new Map<string, string[]>([
    ['default-src', [self]],
    ['script-src', [self]],
    ['style-src', [self]],
    ['img-src', [self]],
    ['font-src', [self]],
    ['connect-src', [self]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
  ]);

  if (devServerUrl !== undefined) {
    const dev = new URL(devServerUrl);
    const ws = `ws://${dev.host}`;
    directives.get('style-src')?.push("'unsafe-inline'");
    directives.get('connect-src')?.push(dev.origin, ws);
    directives.get('img-src')?.push(APP_ORIGIN);
  }

  return Array.from(directives, ([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}
