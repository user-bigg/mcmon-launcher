import { describe, expect, it, vi } from 'vitest';
import {
  safeWindowUrl,
  windowConsoleLine,
  screenOfUrl,
  windowFailureReport,
  windowReportsEnabled,
  type WindowFailure,
  type WindowReportContext,
} from '@shared/window-failure';
import { WINDOW_REPORT_INTAKE, windowReporter } from './report';

const failure: WindowFailure = {
  kind: 'gone',
  reason: 'crashed',
  exitCode: -1073741819,
  errorCode: null,
  url: 'app://launcher/index.html?q=Ivan#/server/42?from=C:\\Users\\Ivan',
};
const context: WindowReportContext = {
  at: '2026-10-14T10:00:00.000Z',
  gameRunning: true,
  launcher: '0.1.0',
  os: 'windows',
  osRelease: '10.0.22631',
  arch: 'x64',
};

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('the report about a failed window', () => {
  it('names the failure, the screen and the system, and nothing personal', () => {
    const report = windowFailureReport(failure, context);
    expect(report).toEqual({
      type: 'window.failed',
      at: '2026-10-14T10:00:00.000Z',
      kind: 'gone',
      reason: 'crashed',
      exit_code: -1073741819,
      error_code: null,
      screen: 'server',
      game_running: true,
      launcher: '0.1.0',
      os: 'windows',
      os_release: '10.0.22631',
      arch: 'x64',
    });
    expect(JSON.stringify(report)).not.toMatch(/Ivan|Users|42/);
  });

  it.each([
    ['app://launcher/index.html', 'home'],
    ['app://launcher/index.html#/', 'home'],
    ['app://launcher/index.html#/my-servers', 'my-servers'],
    ['app://launcher/index.html#/launch/profile/secret-build', 'launch'],
    ['app://launcher/index.html#/Ivan%20Petrov', 'other'],
    ['not a url', 'home'],
  ])('the screen of %s is %s', (url, screen) => {
    expect(screenOfUrl(url)).toBe(screen);
  });

  it.each([
    ['app://launcher/index.html?q=a#/server/1', 'app://launcher/index.html'],
    ['http://localhost:5190/#/servers', 'http://localhost:5190/'],
    ['file:///C:/Users/Ivan/app/index.html', 'file:'],
    ['data:text/html,<p>x</p>', 'data:'],
    ['nonsense', 'invalid'],
  ])('the address %s is logged as %s', (url, safe) => {
    expect(safeWindowUrl(url)).toBe(safe);
  });
});

describe('a renderer console error in the log', () => {
  it('keeps the first line and cuts a long one', () => {
    expect(windowConsoleLine('TypeError: x is undefined\n    at C:\\Users\\Ivan\\app.js:1')).toBe(
      'window: console TypeError: x is undefined',
    );
    const long = windowConsoleLine('e'.repeat(1000));
    expect(long).toHaveLength('window: console '.length + 300);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('sending the report', () => {
  it('is off unless the build says on, and the site has no intake yet', () => {
    expect(windowReportsEnabled()).toBe(false);
    expect(windowReportsEnabled('')).toBe(false);
    expect(windowReportsEnabled('1')).toBe(false);
    expect(windowReportsEnabled('on')).toBe(true);
    expect(WINDOW_REPORT_INTAKE).toBeNull();
    expect(windowReporter(true, WINDOW_REPORT_INTAKE, () => context)).toBeNull();
    expect(
      windowReporter(
        false,
        () => Promise.resolve(),
        () => context,
      ),
    ).toBeNull();
  });

  it('goes out once and a failed send is dropped: no retry, nothing kept', async () => {
    const sender = vi.fn(() => Promise.reject(new Error('offline')));
    const report = windowReporter(true, sender, () => context);
    report?.(failure);
    await settle();
    await settle();
    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith(windowFailureReport(failure, context));
  });

  it('a sender that throws does not reach the recovery', () => {
    const report = windowReporter(
      true,
      () => {
        throw new Error('broken');
      },
      () => context,
    );
    expect(() => report?.(failure)).not.toThrow();
  });
});
