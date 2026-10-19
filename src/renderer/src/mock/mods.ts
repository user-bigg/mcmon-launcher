import {
  catalogView,
  newestMinecraft,
  NO_SERVER_MODS,
  serverKey,
  serverModsView,
  type CatalogMod,
  type ModCatalog,
  type ModChannel,
  type ModChoices,
  type ModFile,
  type ModGroup,
  type ModKind,
  type ModsResult,
  type ModsService,
  type ServerMods,
  type ServerModsSource,
} from '@shared/mods';
import type { SiteResult } from '@shared/site';
import { SERVER_IDS } from './servers';

const DEMO_VERSIONS = ['1.21.1', '26.1.2'] as const;
type DemoVersion = (typeof DEMO_VERSIONS)[number];

interface DemoMod {
  slug: string;
  modrinth: string;
  kind?: ModKind;
  title: string;
  short: string;
  summary: string;
  group: ModGroup;
  player?: boolean;
  server?: boolean;
  oftenForbidden?: boolean;
  requires?: string[];
  requiresOn?: Partial<Record<DemoVersion, string[]>>;
  credit?: string;
  version: string;
  size: number;
  channel?: ModChannel;
  options?: Record<string, string>;
}

function demoSha(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(8);
}

function demoFiles(item: DemoMod): ModFile[] {
  const kind = item.kind ?? 'mod';
  const extension = kind === 'mod' ? 'jar' : 'zip';
  return DEMO_VERSIONS.map((minecraft) => {
    const sha256 = demoSha(`${item.slug}-${minecraft}`);
    return {
      minecraft,
      loader: kind === 'mod' ? 'fabric' : null,
      loader_min: kind === 'mod' ? '0.16.0' : null,
      version: item.version,
      channel: item.channel ?? 'release',
      urls: [
        `https://cdn.modrinth.com/data/${item.modrinth}/versions/demo/${item.slug}.${extension}`,
        `https://mc-mon.ru/storage/mods/${sha256}.${extension}`,
      ],
      sha256,
      size: item.size,
      requires: item.requiresOn?.[minecraft] ?? item.requires ?? [],
    };
  });
}

function demoMod(item: DemoMod): CatalogMod {
  return {
    slug: item.slug,
    kind: item.kind ?? 'mod',
    title: item.title,
    short: item.short,
    summary: item.summary,
    group: item.group,
    player: item.player ?? true,
    server: item.server ?? false,
    often_forbidden: item.oftenForbidden ?? false,
    requires: item.requires ?? [],
    modrinth_id: item.modrinth,
    license: 'LGPL-3.0-only',
    source_url: null,
    credit: item.credit ?? null,
    options: item.options ?? null,
    files: demoFiles(item),
  };
}

const DEMO_MODS: DemoMod[] = [
  {
    slug: 'fabric-api',
    modrinth: 'P7dR8mSH',
    title: 'Fabric API',
    short: 'Fabric API',
    summary: 'Библиотека для других модов',
    group: 'optimization',
    player: false,
    version: '0.116.6',
    size: 2_310_000,
  },
  {
    slug: 'player-animator',
    modrinth: 'gedNE4y2',
    title: 'playerAnimator',
    short: 'Библиотека анимаций',
    summary: 'Библиотека для эмоций',
    group: 'cosmetics',
    player: false,
    version: '2.0.1',
    size: 140_000,
  },
  {
    slug: 'reeses-sodium-options',
    modrinth: 'Bh37bMuy',
    title: 'Reese’s Sodium Options',
    short: 'Настройки Sodium',
    summary: 'Меню настроек графики',
    group: 'optimization',
    player: false,
    version: '1.8.3',
    size: 480_000,
  },
  {
    slug: 'sodium',
    modrinth: 'AANobbMI',
    title: 'Sodium и Reese’s Sodium Options',
    short: 'Sodium',
    summary: 'Игра идёт плавнее, настройки графики понятнее',
    group: 'optimization',
    requires: ['reeses-sodium-options'],
    version: '0.6.13',
    size: 1_120_000,
  },
  {
    slug: 'entityculling',
    modrinth: 'NNAgCjsB',
    title: 'Entity Culling',
    short: 'Entity Culling',
    summary: 'Мобы и сундуки за стенами не тормозят игру',
    group: 'optimization',
    version: '1.7.4',
    size: 410_000,
  },
  {
    slug: 'immediatelyfast',
    modrinth: '5ZwdcRci',
    title: 'ImmediatelyFast',
    short: 'ImmediatelyFast',
    summary: 'Таблички, рамки и интерфейс меньше тормозят игру',
    group: 'optimization',
    version: '1.5.2',
    size: 420_000,
  },
  {
    slug: 'ferritecore',
    modrinth: 'uXXizFIs',
    title: 'FerriteCore',
    short: 'FerriteCore',
    summary: 'Игра занимает меньше памяти',
    group: 'optimization',
    version: '7.0.2',
    size: 160_000,
  },
  {
    slug: 'dynamic-fps',
    modrinth: 'LQ3K71Q1',
    title: 'Dynamic FPS',
    short: 'Dynamic FPS',
    summary: 'Свёрнутая игра почти не грузит компьютер',
    group: 'optimization',
    version: '3.9.4',
    size: 310_000,
  },
  {
    slug: 'badoptimizations',
    modrinth: 'g96Z4WVZ',
    title: 'BadOptimizations',
    short: 'BadOptimizations',
    summary: 'Игра идёт ещё чуть плавнее',
    group: 'optimization',
    version: '2.2.2',
    size: 90_000,
  },
  {
    slug: 'iris',
    modrinth: 'YL57xq9U',
    title: 'Iris',
    short: 'Шейдеры',
    summary: 'Можно включить шейдеры с живым светом и тенями',
    group: 'graphics',
    requires: ['sodium'],
    version: '1.8.8',
    size: 2_700_000,
  },
  {
    slug: 'entity-features',
    modrinth: 'BVzZfTc1',
    title: 'Entity Texture и Model Features',
    short: 'Модели мобов',
    summary: 'Мобы выглядят так, как задумал набор текстур',
    group: 'graphics',
    version: '6.2.9',
    size: 1_640_000,
  },
  {
    slug: 'continuity',
    modrinth: '1IjD5062',
    title: 'Continuity',
    short: 'Continuity',
    summary: 'Стёкла соединяются в цельные окна без швов',
    group: 'graphics',
    version: '3.0.0',
    size: 520_000,
  },
  {
    slug: 'lambdynamiclights',
    modrinth: 'yBW8D80W',
    title: 'LambDynamicLights',
    short: 'Свет в руке',
    summary: 'Факел в руке светит на ходу',
    group: 'graphics',
    version: '4.1.2',
    size: 930_000,
  },
  {
    slug: 'xaeros-minimap',
    modrinth: '1bokaNcj',
    title: 'Xaero’s Minimap',
    short: 'Миникарта',
    summary: 'В углу экрана видна карта местности',
    group: 'interface',
    oftenForbidden: true,
    version: '25.2.10',
    size: 3_400_000,
  },
  {
    slug: 'appleskin',
    modrinth: 'EsAfCjCV',
    title: 'AppleSkin',
    short: 'AppleSkin',
    summary: 'Видно, сколько сытости даёт еда',
    group: 'interface',
    version: '3.0.6',
    size: 120_000,
  },
  {
    slug: 'zoomify',
    modrinth: 'w7ThoJFB',
    title: 'Zoomify',
    short: 'Зум',
    summary: 'Можно приблизить вид, как в подзорную трубу',
    group: 'interface',
    version: '2.14.2',
    size: 330_000,
  },
  {
    slug: 'mouse-tweaks',
    modrinth: 'aC3cM3Vq',
    title: 'Mouse Tweaks',
    short: 'Mouse Tweaks',
    summary: 'Предметы удобнее перекладывать мышью',
    group: 'interface',
    version: '2.26.1',
    size: 110_000,
  },
  {
    slug: 'chat-heads',
    modrinth: 'Wb5oqrBJ',
    title: 'Chat Heads',
    short: 'Головы в чате',
    summary: 'Рядом с ником в чате видна голова игрока',
    group: 'interface',
    version: '0.13.9',
    size: 180_000,
  },
  {
    slug: '3dskinlayers',
    modrinth: 'zV5r3pPn',
    title: '3D Skin Layers',
    short: '3D-скины',
    summary: 'Одежда на скинах становится объёмной',
    group: 'cosmetics',
    version: '1.7.5',
    size: 260_000,
  },
  {
    slug: 'not-enough-animations',
    modrinth: 'MPCX6s5C',
    title: 'Not Enough Animations',
    short: 'Анимации',
    summary: 'Со стороны видно, как игрок ест и держит карту',
    group: 'cosmetics',
    version: '1.9.1',
    size: 300_000,
  },
  {
    slug: 'wavey-capes',
    modrinth: 'kYuIpRLv',
    title: 'Wavey Capes',
    short: 'Плащи',
    summary: 'Плащ развевается при движении',
    group: 'cosmetics',
    version: '1.6.1',
    size: 210_000,
  },
  {
    slug: 'simple-voice-chat',
    modrinth: '9eGKb6K1',
    title: 'Simple Voice Chat',
    short: 'Голосовой чат',
    summary: 'С игроками рядом можно говорить голосом',
    group: 'sound',
    server: true,
    version: '2.6.24',
    size: 2_200_000,
  },
  {
    slug: 'presence-footsteps',
    modrinth: 'rcTfTZr3',
    title: 'Presence Footsteps',
    short: 'Шаги',
    summary: 'Шаги звучат по-разному на камне, траве и дереве',
    group: 'sound',
    version: '1.11.1',
    size: 640_000,
  },
  {
    slug: 'emotecraft',
    modrinth: 'pZ2wrerK',
    title: 'Emotecraft',
    short: 'Эмоции',
    summary: 'Персонаж машет, танцует и кланяется',
    group: 'server',
    player: false,
    server: true,
    requires: ['fabric-api', 'player-animator'],
    requiresOn: { '1.21.1': ['fabric-api'] },
    version: '2.5.4',
    size: 4_300_000,
    channel: 'beta',
  },
  {
    slug: 'makeup-ultra-fast',
    modrinth: 'izsIPI7a',
    kind: 'shader_pack',
    title: 'MakeUp Ultra Fast',
    short: 'Лёгкие шейдеры',
    summary: 'Шейдеры для слабых компьютеров',
    group: 'graphics',
    player: false,
    requires: ['iris'],
    version: '9.4c',
    size: 1_100_000,
    options: { profile: 'low' },
  },
  {
    slug: 'complementary-reimagined',
    modrinth: 'HVnmMxH1',
    kind: 'shader_pack',
    title: 'Complementary Reimagined',
    short: 'Красивые шейдеры',
    summary: 'Живой свет, тени и вода',
    group: 'graphics',
    player: false,
    requires: ['iris'],
    credit: 'Complementary Reimagined от Complementary Development',
    version: 'r5.5.1',
    size: 1_900_000,
  },
];

export const demoModCatalog: ModCatalog = {
  updated_at: '2026-10-18T09:00:00Z',
  mods: DEMO_MODS.map(demoMod),
  shaders: { light: 'makeup-ultra-fast', beautiful: 'complementary-reimagined' },
};

export const demoModChoices: Readonly<ModChoices> = {
  enabled: ['sodium', 'xaeros-minimap', 'appleskin', '3dskinlayers', 'simple-voice-chat'],
  shaders: 'beautiful',
  optionalOff: {},
};

function fetched<T>(value: T): SiteResult<T> {
  return { ok: true, value, stale: false, fetchedAt: demoModCatalog.updated_at ?? '' };
}

function demoServerSource(serverId: number): ServerModsSource {
  const mods = demoServerMods[serverId];
  return { state: 'known', modpack: false, mods: mods ?? NO_SERVER_MODS };
}

export function demoModsService(): ModsService {
  let choices: ModChoices = structuredClone(demoModChoices);
  const current = (): Promise<ModsResult<ModChoices>> =>
    Promise.resolve({ ok: true, value: structuredClone(choices) });
  return {
    catalog: (minecraft) =>
      Promise.resolve(
        fetched(catalogView(demoModCatalog, choices, minecraft ?? newestMinecraft(demoModCatalog))),
      ),
    choices: current,
    setChoices: (patch): Promise<ModsResult<ModChoices>> => {
      choices = { ...choices, ...structuredClone(patch) };
      return current();
    },
    serverPlan: (query) =>
      Promise.resolve(
        fetched(serverModsView(query, demoServerSource(query.serverId), demoModCatalog, choices)),
      ),
    setServerOptional: (serverId, slug, on): Promise<ModsResult<ModChoices>> => {
      const key = serverKey(serverId);
      const off = (choices.optionalOff[key] ?? []).filter((item) => item !== slug);
      choices = {
        ...choices,
        optionalOff: { ...choices.optionalOff, [key]: on ? off : [...off, slug] },
      };
      return current();
    },
  };
}

export const demoServerMods: Readonly<Partial<Record<number, ServerMods>>> = {
  [SERVER_IDS.emeraldValley]: {
    required: ['simple-voice-chat'],
    optional: ['emotecraft'],
    forbidden: [],
  },
  [SERVER_IDS.northernEdge]: {
    required: [],
    optional: ['simple-voice-chat'],
    forbidden: ['xaeros-minimap'],
  },
};
