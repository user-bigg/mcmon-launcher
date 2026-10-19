import type { App } from 'vue';

// Vue names the place of an error with a word in development and with a link ending in a
// code in a build. A handler or a watcher that throws leaves the screen it belongs to drawn.
const HARMLESS_PLACES = [
  'watcher getter',
  'watcher callback',
  'watcher cleanup function',
  'native event handler',
  'component event handler',
] as const;
const HARMLESS_CODES = /#runtime-[2-6]$/;

export function breaksRendering(info: string): boolean {
  return !(HARMLESS_PLACES as readonly string[]).includes(info) && !HARMLESS_CODES.test(info);
}

export function logError(error: unknown): void {
  console.error(error);
}

export function mountApp(app: App, root: Element, report: (mounted: boolean) => void): void {
  let started = false;
  let failed = false;
  app.config.errorHandler = (error): void => {
    logError(error);
    failed ||= !started;
  };
  try {
    app.mount(root);
  } catch (error) {
    logError(error);
    failed = true;
  }
  started = true;
  report(!failed && root.childNodes.length > 0);
}
