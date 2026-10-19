import type { ServerCard } from '@shared/catalog';
import type { OwnedServerDetails, OwnedServerRef } from '@shared/owner';
import iconGear from '../assets/pixel/icon-gear.svg';
import iconTower from '../assets/pixel/icon-tower.svg';
import { moscowDate } from '../lib/time';
import { SERVER_IDS, serverCard } from './servers';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const OWNED_IDS = { technograd: SERVER_IDS.technograd, kubograd: 190 } as const;

export const ownedRefs: OwnedServerRef[] = [
  { id: OWNED_IDS.technograd, name: 'ТехноГрад', status: 'up' },
  { id: OWNED_IDS.kubograd, name: 'Кубоград', status: 'down' },
];

const icons: Partial<Record<number, string>> = {
  [OWNED_IDS.technograd]: iconGear,
  [OWNED_IDS.kubograd]: iconTower,
};

export function ownedIcon(id: number): string | null {
  return icons[id] ?? null;
}

function at(now: number, ago: number): string {
  return new Date(now - ago).toISOString();
}

function technograd(now: number): OwnedServerDetails {
  const expire = at(now, -3 * DAY);
  const outage = now - 15 * HOUR - 30 * MINUTE;
  return {
    id: OWNED_IDS.technograd,
    name: 'ТехноГрад',
    status: 'up',
    downSince: null,
    online: 967,
    slots: 1500,
    version: '1.20.1',
    checkedAt: at(now, 2 * MINUTE),
    rank: null,
    rankWeekAgo: null,
    votesMonth: 2184,
    points: 1250,
    pointsExpireAt: expire,
    uptime30d: 0.987,
    topSlot: { tier: 'gold', endsAt: at(now, -5 * DAY) },
    attention: {
      kind: 'points_expire',
      at: at(now, 9 * HOUR),
      title: `Энергия закончится ${moscowDate(expire)}`,
    },
    onlineAvgDay: 742,
    onlineAvgPrevDay: 698,
    onlinePeakDay: { value: 1412, at: at(now, 22 * HOUR) },
    downtimes30d: 4,
    votesMonthChange: 12,
    sources7d: { launcherLaunches: 4218, addressCopies: 2906, siteClicks: 1140, widgetVotes: 388 },
    votifier: { ok: true, lastErrorAt: null },
    reviews: { total: 132, fresh: 3 },
    complaints: { total: 0, fresh: 0 },
    events: [
      {
        id: 4,
        kind: 'points_expire',
        server: null,
        at: at(now, 9 * HOUR),
        read: false,
        title: 'Энергия закончится через 3 дня',
      },
      {
        id: 3,
        kind: 'up',
        server: null,
        at: new Date(outage + 9 * MINUTE).toISOString(),
        read: true,
        title: 'Сервер снова работает',
      },
      {
        id: 2,
        kind: 'down',
        server: null,
        at: new Date(outage).toISOString(),
        read: true,
        title: 'Сервер не отвечает',
      },
    ],
  };
}

function kubograd(now: number): OwnedServerDetails {
  const since = at(now, 62 * MINUTE);
  return {
    id: OWNED_IDS.kubograd,
    name: 'Кубоград',
    status: 'down',
    downSince: since,
    online: null,
    slots: 200,
    version: '1.21.4',
    checkedAt: at(now, 2 * MINUTE),
    rank: 58,
    rankWeekAgo: 55,
    votesMonth: 214,
    points: 90,
    pointsExpireAt: null,
    topSlot: null,
    uptime30d: 0.912,
    attention: null,
    onlineAvgDay: 38,
    onlineAvgPrevDay: 41,
    onlinePeakDay: { value: 74, at: at(now, 21 * HOUR) },
    downtimes30d: 11,
    votesMonthChange: -8,
    sources7d: { launcherLaunches: 96, addressCopies: 212, siteClicks: 41, widgetVotes: 17 },
    votifier: { ok: false, lastErrorAt: at(now, 2 * DAY) },
    reviews: { total: 14, fresh: 0 },
    complaints: { total: 2, fresh: 1 },
    events: [
      { id: 6, kind: 'down', server: null, at: since, read: false, title: 'Сервер не отвечает' },
      {
        id: 5,
        kind: 'rank_drop',
        server: null,
        at: at(now, 2 * DAY),
        read: true,
        title: 'Место в рейтинге: 55 → 58',
      },
    ],
  };
}

export function ownedServers(now: number): OwnedServerDetails[] {
  return [technograd(now), kubograd(now)];
}

function technogradCard(now: number): ServerCard | undefined {
  const card = serverCard(OWNED_IDS.technograd, now);
  const outage = now - 15 * HOUR - 30 * MINUTE;
  return card === undefined
    ? undefined
    : {
        ...card,
        downtimes: [
          { from: new Date(outage).toISOString(), to: new Date(outage + 9 * MINUTE).toISOString() },
        ],
      };
}

function kubogradCard(now: number): ServerCard | undefined {
  const base = serverCard(SERVER_IDS.ravenCastle, now);
  if (base === undefined) {
    return undefined;
  }
  const since = now - 62 * MINUTE;
  return {
    ...base,
    id: OWNED_IDS.kubograd,
    slug: 'kubograd',
    name: 'Кубоград',
    address: { host: 'play.kubograd.example', port: 25565 },
    icon_url: iconTower,
    status: 'offline',
    online: 0,
    down_since: new Date(since).toISOString(),
    chart_24h: base.chart_24h.map((point) => ({
      at: point.at,
      online: Date.parse(point.at) >= since ? 0 : Math.round(point.online / 4),
    })),
    downtimes: [{ from: new Date(since).toISOString(), to: null }],
  };
}

export function ownedCard(id: number, now: number): ServerCard | undefined {
  if (id === OWNED_IDS.technograd) {
    return technogradCard(now);
  }
  return id === OWNED_IDS.kubograd ? kubogradCard(now) : undefined;
}
