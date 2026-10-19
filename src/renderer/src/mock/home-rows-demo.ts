import type { ServerRow } from '@shared/catalog';
import { topSlots, findServer, SERVER_IDS } from './servers';

export { demoScene, demoScenes } from './scenes-demo';

const HOUR = 3_600_000;

function base(id: number): ServerRow {
  const server = findServer(id);
  if (server === undefined) {
    throw new Error(`demo server ${String(id)} missing`);
  }
  return server;
}

const [diamond] = topSlots.diamond;
const [gold] = topSlots.gold;

export interface HeroDemo {
  caption: string;
  server: ServerRow;
  ping: number | null;
  installed: boolean;
  playedAt: string;
  durationSeconds: number;
}

const ago = (hours: number): string => new Date(Date.now() - hours * HOUR).toISOString();

export const heroDemos: HeroDemo[] = [
  {
    caption: 'taiga · day · direct · online · installed',
    server: { ...base(SERVER_IDS.northernEdge), cover: { scene: 'taiga', time: 'day' } },
    ping: 31,
    installed: true,
    playedAt: ago(26),
    durationSeconds: 8040,
  },
  {
    caption: 'village · sunset · own_launcher · offline · ping n/a · long name',
    server: {
      ...base(SERVER_IDS.technograd),
      name: 'ТехноГрад: Индустриальная эпоха, четвёртый сезон с модами и экономикой',
      status: 'offline',
      online: 0,
      cover: { scene: 'village', time: 'sunset' },
      launch: {
        kind: 'own_launcher',
        url: 'https://example.org/launcher',
        label: 'Скачать лаунчер сервера',
      },
    },
    ping: null,
    installed: false,
    playedAt: ago(80),
    durationSeconds: 2730,
  },
  {
    caption: 'bedwars · night · none · not installed',
    server: {
      ...base(SERVER_IDS.pixelCity),
      address: { host: 'mc.pixel-city.example', port: 25577 },
      cover: { scene: 'bedwars', time: 'night' },
      launch: { kind: 'none' },
    },
    ping: 54,
    installed: false,
    playedAt: ago(3),
    durationSeconds: 1500,
  },
];

export interface TopSlotDemo {
  caption: string;
  server: ServerRow;
}

export const topSlotDemos: TopSlotDemo[] =
  diamond === undefined || gold === undefined
    ? []
    : [
        {
          caption: 'diamond · village sunset · direct',
          server: { ...diamond, cover: { scene: 'village', time: 'sunset' } },
        },
        {
          caption: 'gold · taiga day · own_launcher',
          server: {
            ...gold,
            cover: { scene: 'taiga', time: 'day' },
            launch: {
              kind: 'own_launcher',
              url: 'https://example.org/launcher',
              label: 'Скачать лаунчер сервера',
            },
          },
        },
        {
          caption: 'diamond · bedwars night · none · offline · long text',
          server: {
            ...diamond,
            id: 9001,
            name: 'Небесные Острова: кланы, рейды и ярмарка выходного дня',
            description:
              'Летающие острова, кооперативные рейды по выходным, рынок без доната на силу и спокойные вечерние ивенты для всех',
            status: 'offline',
            online: 0,
            tags: ['skyblock', 'clans', 'economy', 'pvp'],
            cover: { scene: 'bedwars', time: 'night' },
            launch: { kind: 'none' },
          },
        },
      ];
