import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { behaviorTelemetry, loadInstallId, siteApiBase, userAgent } from './config';

describe('client settings', () => {
  it('API address: a packaged build uses the live one, development takes an https one from the env', () => {
    const env = { MCMONITOR_API_BASE: 'https://staging.example/api/launcher/v1/' };
    expect(siteApiBase(true, env)).toBe('https://mc-mon.ru/api/launcher/v1');
    expect(siteApiBase(false, env)).toBe('https://staging.example/api/launcher/v1');
    expect(siteApiBase(false, {})).toBe('https://mc-mon.ru/api/launcher/v1');
    expect(() => siteApiBase(false, { MCMONITOR_API_BASE: 'http://staging.example/' })).toThrow();
  });

  it('behavior telemetry is off unless set to on; a packaged build ignores the environment', () => {
    const on = { MCMONITOR_TELEMETRY_BEHAVIOR: 'on' };
    expect(behaviorTelemetry(false, {}, undefined)).toBe(false);
    expect(behaviorTelemetry(false, { MCMONITOR_TELEMETRY_BEHAVIOR: '1' }, 'on')).toBe(false);
    expect(behaviorTelemetry(false, on, '')).toBe(true);
    expect(behaviorTelemetry(true, on, '')).toBe(false);
    expect(behaviorTelemetry(true, on, undefined)).toBe(false);
    expect(behaviorTelemetry(true, {}, 'on')).toBe(true);
  });

  it('User-Agent matches the site API', () => {
    expect(userAgent('0.1.0', 'win32', 'x64')).toBe('MCMonitorLauncher/0.1.0 (Windows x64)');
    expect(userAgent('0.1.0', 'darwin', 'arm64')).toBe('MCMonitorLauncher/0.1.0 (macOS arm64)');
  });

  it('the install uuid is created once and persisted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcmon-install-'));
    try {
      const file = join(dir, 'install.json');
      const id = await loadInstallId(file);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await loadInstallId(file)).toBe(id);
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ id });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
