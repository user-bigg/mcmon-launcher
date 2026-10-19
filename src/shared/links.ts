export const SITE_URL = 'https://mc-mon.ru';

export const SITE_LINKS = {
  terms: `${SITE_URL}/terms`,
  privacy: `${SITE_URL}/privacy`,
  promote: `${SITE_URL}/promote`,
  launcher: `${SITE_URL}/launcher`,
  rules: `${SITE_URL}/rules`,
  about: `${SITE_URL}/about`,
  logins: `${SITE_URL}/settings/logins`,
  cabinet: `${SITE_URL}/dashboard`,
  add_server: `${SITE_URL}/add`,
} as const;

export function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && URL.canParse(value) && new URL(value).protocol === 'https:';
}

export function urlHost(value: string): string | null {
  return isHttpsUrl(value) ? new URL(value).host : null;
}
