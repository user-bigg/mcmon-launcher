import { randomUUID } from 'node:crypto';
import { SITE_API_BASE, SITE_API_ENV } from '@shared/site';
import { readJson, writeJsonAtomic } from '../launch/json-cache';
import { isRecord } from './guards';

export const TELEMETRY_BEHAVIOR_ENV = 'MCMONITOR_TELEMETRY_BEHAVIOR';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function siteApiBase(packaged: boolean, env: NodeJS.ProcessEnv): string {
  const override = packaged ? undefined : env[SITE_API_ENV]?.trim();
  if (override === undefined || override === '') {
    return SITE_API_BASE;
  }
  const url = URL.parse(override);
  if (url?.protocol !== 'https:' || url.search !== '' || url.hash !== '' || url.username !== '') {
    throw new Error(`${SITE_API_ENV} must be an https URL without query`);
  }
  return url.href.replace(/\/+$/, '');
}

// A packaged launcher takes the flag from its build, so a variable in the user's environment
// cannot turn the sending on.
export function behaviorTelemetry(
  packaged: boolean,
  env: NodeJS.ProcessEnv,
  built: string | undefined,
): boolean {
  return (packaged ? built : env[TELEMETRY_BEHAVIOR_ENV]) === 'on';
}

export function osName(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return 'Windows';
  }
  return platform === 'darwin' ? 'macOS' : 'Linux';
}

export function telemetryOs(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return 'windows';
  }
  return platform === 'darwin' ? 'macos' : 'linux';
}

export function userAgent(version: string, platform: NodeJS.Platform, arch: string): string {
  return `MCMonitorLauncher/${version} (${osName(platform)} ${arch})`;
}

export async function loadInstallId(
  file: string,
  create: () => string = randomUUID,
): Promise<string> {
  const stored = await readJson(file);
  if (isRecord(stored) && typeof stored.id === 'string' && UUID.test(stored.id)) {
    return stored.id;
  }
  const id = create();
  await writeJsonAtomic(file, { id });
  return id;
}
