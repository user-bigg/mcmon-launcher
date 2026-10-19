import type { ServerCard, ServerList, ServerRow } from '@shared/catalog';
import type { InstallEstimate, PingSample } from '@shared/player';
import type { ReportReason } from '@shared/report';
import { POPULAR_COUNT } from '../lib/home-pick';
import iconCity from '../assets/pixel/icon-city.svg';
import iconCrystal from '../assets/pixel/icon-crystal.svg';
import iconEmerald from '../assets/pixel/icon-emerald.svg';
import iconFire from '../assets/pixel/icon-fire.svg';
import iconGear from '../assets/pixel/icon-gear.svg';
import iconGrass from '../assets/pixel/icon-grass.svg';
import iconHeart from '../assets/pixel/icon-heart.svg';
import iconIsland from '../assets/pixel/icon-island.svg';
import iconPeak from '../assets/pixel/icon-peak.svg';
import iconSkull from '../assets/pixel/icon-skull.svg';
import iconSword from '../assets/pixel/icon-sword.svg';
import iconTower from '../assets/pixel/icon-tower.svg';

type RowInput = Pick<
  ServerRow,
  | 'id'
  | 'slug'
  | 'name'
  | 'description'
  | 'tags'
  | 'versions'
  | 'online'
  | 'max_players'
  | 'rank'
  | 'weekly_trend'
  | 'votes_month'
  | 'icon_url'
  | 'cover'
  | 'launch'
> &
  Partial<ServerRow>;

function row(input: RowInput): ServerRow {
  return {
    address: { host: `play.${input.slug.replace(/-/g, '')}.example`, port: 25565 },
    edition: 'java',
    status: 'online',
    points: 0,
    unstable: false,
    is_verified: true,
    wipe_label: null,
    topSlot: null,
    access: { license: true, nick: true },
    site_url: `https://mc-mon.ru/server/${input.slug}`,
    ...input,
  };
}

export const SERVER_IDS = {
  pixelCity: 101,
  northernEdge: 102,
  emeraldValley: 103,
  technograd: 104,
  cubeIsland: 105,
  moonCrystal: 106,
  wasteland: 107,
  ravenCastle: 108,
  meridian: 109,
  quietHarbor: 110,
  fireRidge: 201,
  steelBlade: 202,
} as const;

export const servers: ServerRow[] = [
  row({
    id: SERVER_IDS.pixelCity,
    slug: 'pixel-city',
    name: 'Пиксель-Сити',
    description: 'BedWars, SkyWars, Мардер · турнир в сб',
    tags: ['minigames', 'bedwars'],
    versions: { from: '1.21.4', to: '26.2' },
    online: 3412,
    max_players: 5000,
    rank: 1,
    points: 128400,
    weekly_trend: 8,
    votes_month: 256300,
    icon_url: iconCity,
    cover: { scene: 'bedwars', time: 'night' },
    launch: { kind: 'direct', minecraft: '26.2' },
  }),
  row({
    id: SERVER_IDS.northernEdge,
    slug: 'severny-predel',
    name: 'Северный Предел',
    description: 'Ролевое выживание с кланами и данжами',
    tags: ['rpg'],
    versions: { from: '1.21.1', to: '1.21.1' },
    online: 2310,
    max_players: 3000,
    rank: 2,
    unstable: true,
    weekly_trend: 11,
    votes_month: 340,
    icon_url: iconPeak,
    cover: { scene: 'taiga', time: 'day' },
    launch: { kind: 'direct', minecraft: '1.21.1' },
  }),
  row({
    id: SERVER_IDS.emeraldValley,
    slug: 'emerald-valley',
    name: 'Изумрудная Долина',
    description: 'Выживание с экономикой',
    tags: ['survival', 'economy'],
    versions: { from: '26.1.2', to: '26.1.2' },
    online: 1284,
    max_players: 2000,
    rank: 3,
    weekly_trend: -2,
    votes_month: 95,
    icon_url: iconEmerald,
    cover: { scene: 'village', time: 'sunset' },
    wipe_label: 'вайп через 2 дня',
    launch: { kind: 'direct', minecraft: '26.1.2' },
  }),
  row({
    id: SERVER_IDS.technograd,
    slug: 'technograd',
    name: 'ТехноГрад',
    description: 'Индустриальная сборка · 148 модов',
    tags: ['industrial', 'modded'],
    versions: { from: '1.20.1', to: '1.20.1' },
    online: 967,
    max_players: 1500,
    rank: 4,
    weekly_trend: 12,
    votes_month: 410,
    icon_url: iconGear,
    cover: { scene: 'village', time: 'sunset' },
    address: { host: 'play.technograd.example', port: 25565 },
    launch: {
      kind: 'own_launcher',
      url: 'https://technograd.example/launcher',
      label: 'Скачать лаунчер сервера',
    },
  }),
  row({
    id: SERVER_IDS.cubeIsland,
    slug: 'cube-island',
    name: 'Кубический Остров',
    description: 'Скайблок без модов и доната на ресурсы',
    tags: ['skyblock', 'vanilla'],
    versions: { from: '1.21.4', to: '1.21.4' },
    online: 758,
    max_players: 1200,
    rank: 5,
    weekly_trend: null,
    votes_month: 260,
    icon_url: iconIsland,
    cover: { scene: 'village', time: 'sunset' },
    launch: { kind: 'direct', minecraft: '1.21.4' },
  }),
  row({
    id: SERVER_IDS.moonCrystal,
    slug: 'moon-crystal',
    name: 'Лунный Кристалл',
    description: 'Магическая сборка · 92 мода',
    tags: ['magic', 'modded'],
    versions: { from: '1.16.5', to: '1.16.5' },
    online: 541,
    max_players: 1000,
    rank: 6,
    weekly_trend: -6,
    votes_month: 70,
    icon_url: iconCrystal,
    cover: { scene: 'bedwars', time: 'night' },
    launch: {
      kind: 'own_launcher',
      url: 'https://mooncrystal.example/download',
      label: 'Скачать лаунчер сервера',
    },
  }),
  row({
    id: SERVER_IDS.wasteland,
    slug: 'pustosh',
    name: 'Пустошь',
    description: 'Анархия без правил и вайпов',
    tags: ['anarchy'],
    access: { license: true, nick: false },
    versions: { from: '26.1', to: '26.1' },
    online: 412,
    max_players: 1000,
    rank: 7,
    weekly_trend: 3,
    votes_month: 510,
    icon_url: iconSkull,
    cover: { scene: 'village', time: 'sunset' },
    launch: { kind: 'direct', minecraft: '26.1' },
  }),
  row({
    id: SERVER_IDS.ravenCastle,
    slug: 'raven-castle',
    name: 'Замок Ворона',
    description: 'Ролевой сервер на Fabric · 38 модов',
    tags: ['roleplay', 'modded'],
    access: { license: true, nick: true },
    versions: { from: '1.20.1', to: '1.20.1' },
    online: 233,
    max_players: 500,
    rank: 8,
    weekly_trend: 9,
    votes_month: 30,
    icon_url: iconTower,
    cover: { scene: 'bedwars', time: 'night' },
    launch: {
      kind: 'own_launcher',
      url: 'https://ravencastle.example/launcher',
      label: 'Скачать лаунчер сервера',
    },
  }),
  row({
    id: SERVER_IDS.meridian,
    slug: 'meridian',
    name: 'Меридиан',
    description: 'Ванильное выживание',
    tags: ['survival', 'vanilla'],
    versions: { from: '26.2', to: '26.2' },
    online: 156,
    max_players: 300,
    rank: 9,
    weekly_trend: 48,
    votes_month: 180,
    icon_url: iconGrass,
    cover: { scene: 'taiga', time: 'day' },
    launch: { kind: 'direct', minecraft: '26.2' },
  }),
  row({
    id: SERVER_IDS.quietHarbor,
    slug: 'quiet-harbor',
    name: 'Тихая Гавань',
    description: 'Мирное выживание',
    tags: ['peaceful', 'survival'],
    versions: { from: '1.21.4', to: '26.2' },
    online: 89,
    max_players: 200,
    rank: null,
    unstable: true,
    weekly_trend: 2,
    votes_month: 15,
    icon_url: iconHeart,
    cover: { scene: 'taiga', time: 'day' },
    launch: { kind: 'none' },
  }),
];

export const topSlots: ServerList['topSlots'] = {
  diamond: [
    row({
      id: SERVER_IDS.fireRidge,
      slug: 'ognennaya-gryada',
      name: 'Огненная Гряда',
      description:
        'Открытие третьего сезона 3 октября: новые арены, клановые войны, без доната на силу.',
      tags: ['pvp', 'clans'],
      versions: { from: '26.1.2', to: '26.1.2' },
      online: 1040,
      max_players: 2000,
      rank: 0,
      weekly_trend: 7,
      votes_month: 200,
      icon_url: iconFire,
      cover: { scene: 'village', time: 'sunset' },
      topSlot: { tier: 'diamond' },
      launch: { kind: 'direct', minecraft: '26.1.2' },
    }),
  ],
  gold: [
    row({
      id: SERVER_IDS.steelBlade,
      slug: 'stalnoy-klinok',
      name: 'Стальной Клинок',
      description: 'PvP-арены и турниры каждую неделю',
      tags: ['pvp'],
      versions: { from: '26.1', to: '26.1' },
      online: 640,
      max_players: 1000,
      rank: 0,
      weekly_trend: 3,
      votes_month: 90,
      icon_url: iconSword,
      cover: { scene: 'taiga', time: 'day' },
      topSlot: { tier: 'gold' },
      launch: { kind: 'direct', minecraft: '26.1' },
    }),
  ],
};

export const votesTop: ServerRow[] = servers
  .toSorted((a, b) => b.votes_month - a.votes_month)
  .slice(0, POPULAR_COUNT);

export const catalog: ServerList = {
  data: servers,
  topSlots,
  topSlotsFree: { diamond: 0, gold: 1 },
  meta: { page: 1, per_page: 30, total: 5832 },
};

export const catalogLive = {
  online: 214560,
  updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
};

const MB = 1024 * 1024;

export const installEstimates: Partial<Record<number, InstallEstimate>> = {
  [SERVER_IDS.wasteland]: { downloadBytes: 620 * MB, cachedBytes: 412 * MB },
  [SERVER_IDS.emeraldValley]: { downloadBytes: 412 * MB, cachedBytes: 0 },
  [SERVER_IDS.cubeIsland]: { downloadBytes: 950 * MB, cachedBytes: 412 * MB },
  [SERVER_IDS.meridian]: { downloadBytes: 640 * MB, cachedBytes: 412 * MB },
};

const allServers = [...servers, ...topSlots.diamond, ...topSlots.gold];

export function findServer(id: number): ServerRow | undefined {
  return allServers.find((server) => server.id === id);
}

export const pings: Record<number, PingSample> = {
  [SERVER_IDS.pixelCity]: { ms: 24 },
  [SERVER_IDS.northernEdge]: { ms: 31 },
  [SERVER_IDS.emeraldValley]: { ms: 18 },
  [SERVER_IDS.technograd]: { ms: 42 },
  [SERVER_IDS.cubeIsland]: { ms: 27 },
  [SERVER_IDS.moonCrystal]: { ms: 55 },
  [SERVER_IDS.wasteland]: { ms: 64 },
  [SERVER_IDS.ravenCastle]: { ms: 38 },
  [SERVER_IDS.meridian]: { ms: 21 },
  [SERVER_IDS.quietHarbor]: { ms: null },
  [SERVER_IDS.fireRidge]: { ms: 29 },
  [SERVER_IDS.steelBlade]: { ms: 33 },
};

export function pingOf(id: number): PingSample {
  return pings[id] ?? { ms: null };
}

const DAY_SHAPE = [
  70.1, 73.4, 79.7, 82.9, 87.0, 94.6, 98.1, 95.0, 100.8, 102.1, 97.3, 100.5, 96.9, 97.5, 93.9, 94.0,
  87.0, 81.1, 78.7, 72.1, 67.2, 65.7, 55.3, 50.8, 47.1, 43.6, 32.8, 30.7, 24.8, 19.9, 17.9, 14.0,
  15.7, 11.8, 13.9, 10.9, 12.4, 19.5, 21.8, 24.4, 23.1, 31.0, 34.4, 41.7, 45.7, 52.1, 58.1, 62.2,
  67.8,
];

const HALF_HOUR = 30 * 60 * 1000;

function dayChart(server: ServerRow, now: number): ServerCard['chart_24h'] {
  const peak = Math.round(server.online * 1.46);
  const low = Math.round(server.online * 0.24);
  const start = now - (DAY_SHAPE.length - 1) * HALF_HOUR;
  return DAY_SHAPE.map((y, index) => ({
    at: new Date(start + index * HALF_HOUR).toISOString(),
    online: Math.round(low + ((102.1 - y) / (102.1 - 10.9)) * (peak - low)),
  }));
}

const about: Partial<Record<number, string>> = {
  [SERVER_IDS.wasteland]: [
    'Анархия на чистой версии 26.1: без правил, без приватов и без вайпов с запуска в 2024 году. Карта растёт третий год, у спавна — руины первых баз.',
    'Сервер требует лицензию Minecraft: читы и запасные аккаунты отсеиваются на входе, античит работает на стороне сервера.',
    '- Мир 60 000 × 60 000 блоков, граница не сдвигается\n- Команды `/kill` и `/stats`, больше никаких',
  ].join('\n\n'),
};

function aboutFor(server: ServerRow): string {
  return about[server.id] ?? server.description;
}

export function serverCard(id: number, now: number = Date.now()): ServerCard | undefined {
  const server = findServer(id);
  if (server === undefined) {
    return undefined;
  }
  const chart = dayChart(server, Math.floor(now / HALF_HOUR) * HALF_HOUR);
  const peak = chart.reduce((best, point) => (point.online > best.online ? point : best));
  return {
    ...server,
    description_md: aboutFor(server),
    downtimes: [],
    rules_md: '',
    links: {
      site: server.site_url,
      discord: 'https://discord.gg/example',
      telegram: 'https://t.me/example',
      vk: 'https://vk.com/example',
      youtube: 'https://youtube.com/@example',
      tiktok: 'https://www.tiktok.com/@example',
    },
    language: 'ru',
    added_at: '2024-03-14T09:00:00Z',
    uptime_30d: server.rank === null ? 0.72 : server.unstable ? 0.91 : 0.987,
    uptime_90d: null,
    chart_24h: chart,
    peak_24h: peak,
    last_outage: null,
    votes: { month: 2184, today: 96 },
    report: { mine: null, allowed: true },
  };
}

export const reportReasons: ReportReason[] = [
  { code: 'donation_fraud', label: 'Обман с донатом' },
  { code: 'wrong_address', label: 'Адрес ведёт на другой сервер' },
  { code: 'fake_stats', label: 'Подозрительный онлайн или голоса' },
  { code: 'forbidden', label: 'Оскорбления или запрещённое' },
  { code: 'other', label: 'Другое' },
];
