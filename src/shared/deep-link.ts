import { isValidServerId } from './launch';
import type { PlaySource } from './telemetry';

export const DEEP_LINK_SCHEME = 'mcmonitor';

export const SITE_PLAY_SOURCES = [
  'catalog',
  'server_page',
  'top_slot',
  'home_popular',
  'favorites',
  'other',
] as const satisfies readonly PlaySource[];
export type SitePlaySource = (typeof SITE_PLAY_SOURCES)[number];

// A link can be opened by any page, so it cannot claim a paid place: counts of launches from the
// places above the rating must not be forgeable from outside the site.
const PAID_SOURCES: readonly SitePlaySource[] = ['top_slot'];
export const SITE_PLAY_TTL_MS = 30_000;

// 'site' marks a request that came through the local port from the MC Monitor site: it starts
// at once. A link of the scheme can be opened by any page, so it never carries this mark.
// 'stale' is a request of the site that waited too long for a window: it only opens the server.
export interface DeepLink {
  kind: 'play';
  serverId: number;
  launchId?: string;
  source?: SitePlaySource;
  via?: 'site';
  stale?: true;
}

export interface DeepLinkDelivery {
  id: number;
  link: DeepLink;
}

const MAX_LINK_LENGTH = 256;
const PLAY_LINK = /^mcmonitor:\/\/play\/\d{1,12}(?:\?[A-Za-z0-9_.~=&-]*)?$/;
const PLAY_PATH = /^\/\d{1,12}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isSiteLaunchId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

export function sitePlaySource(value: unknown): SitePlaySource {
  return SITE_PLAY_SOURCES.find((item) => item === value) ?? 'other';
}

export function linkPlaySource(value: unknown): SitePlaySource {
  const source = sitePlaySource(value);
  return PAID_SOURCES.includes(source) ? 'other' : source;
}

function telemetryOf(params: URLSearchParams): Pick<DeepLink, 'launchId' | 'source'> {
  const launch = params.get('launch');
  const source = params.get('src');
  return {
    ...(isSiteLaunchId(launch) ? { launchId: launch } : {}),
    ...(source === null ? {} : { source: linkPlaySource(source) }),
  };
}

// URL.parse removes dot segments from the path ('play/../1' -> '/1'), so the raw string
// is checked separately.
export function parseDeepLink(raw: string): DeepLink | null {
  if (raw.length > MAX_LINK_LENGTH || !PLAY_LINK.test(raw)) {
    return null;
  }
  const url = URL.parse(raw);
  if (
    url?.protocol !== `${DEEP_LINK_SCHEME}:` ||
    url.host !== 'play' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    !PLAY_PATH.test(url.pathname)
  ) {
    return null;
  }
  const serverId = Number(url.pathname.slice(1));
  return isValidServerId(serverId)
    ? { kind: 'play', serverId, ...telemetryOf(url.searchParams) }
    : null;
}

export function deepLinkFromArgv(argv: readonly string[]): DeepLink | null {
  const prefix = `${DEEP_LINK_SCHEME}://`;
  const links = argv.filter((arg) => arg.toLowerCase().startsWith(prefix));
  const [link] = links;
  return links.length === 1 && link !== undefined ? parseDeepLink(link) : null;
}
