import type { AccountUser } from '@shared/account';
import type { AlertItem } from '@shared/alerts';
import type { CrashAnalysis } from '@shared/crash';
import { serverFolderId } from '@shared/launch';
import type { MicrosoftAccount } from '@shared/microsoft';
import type { GameAccount, LibraryEntry, RecentPlay, StorageSummary } from '@shared/player';
import type { ActivePlayer } from '@shared/players';
import { ownedRefs } from './owner';
import { findServer, SERVER_IDS } from './servers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;
const GB = 1024 * MB;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

export const nicks: GameAccount[] = [
  { id: 'a1', name: 'Frostbyte', provider: 'nick', head: 'fox', skin: null },
];

export const licenses: MicrosoftAccount[] = [
  { id: 'a3', nick: 'Kotofey', uuid: '8667ba71-b85a-4004-af54-457a9734eed7', status: 'ready' },
];

export const activePlayer: ActivePlayer = { kind: 'nick', id: 'a1' };

export const mcAccount: AccountUser = {
  id: 1,
  name: 'frostbyte_mc',
  nick: { name: 'Frostbyte', changeAt: null },
  nicks: [
    { name: 'Frostbyte', avatar: true, skin: null, capeId: null },
    { name: 'Frost_PvP', avatar: false, skin: null, capeId: null },
  ],
  avatarUrl: null,
  skin: null,
  cape: null,
  createdAt: '2026-03-12T10:00:00Z',
  votesMonth: 18,
  favoritesCount: 4,
  hoursPlayed: 126,
  trusted: true,
  trustedReason: null,
  unreadAlerts: 0,
  ownedServers: ownedRefs,
};

export const favoriteIds: number[] = [
  SERVER_IDS.northernEdge,
  SERVER_IDS.emeraldValley,
  SERVER_IDS.pixelCity,
  SERVER_IDS.technograd,
];

export const voteAvailableIds: number[] = [SERVER_IDS.emeraldValley, SERVER_IDS.wasteland];

function alertServer(id: number): AlertItem['server'] {
  return { id, name: findServer(id)?.name ?? '' };
}

export function demoAlerts(now: Date): AlertItem[] {
  const at = (ms: number): string => new Date(now.getTime() - ms).toISOString();
  return [
    {
      id: 3,
      kind: 'watched_up',
      server: alertServer(SERVER_IDS.quietHarbor),
      at: at(40 * 60_000),
      read: false,
      title: 'Сервер снова работает',
    },
    {
      id: 2,
      kind: 'favorite_wipe',
      server: alertServer(SERVER_IDS.emeraldValley),
      at: at(5 * HOUR),
      read: false,
      title: 'Сегодня вайп: мир начнётся заново',
    },
    {
      id: 1,
      kind: 'server_removed',
      server: null,
      at: at(3 * DAY),
      read: true,
      title: 'Сервер, на который вы жаловались, убран из каталога',
    },
  ];
}

export const recentPlay: RecentPlay = {
  serverId: SERVER_IDS.northernEdge,
  playedAt: ago(DAY),
  durationSeconds: 2 * 3600 + 14 * 60,
};

function serverEntry(serverId: number, lastPlayedAt: string, sizeBytes: number): LibraryEntry {
  const server = findServer(serverId);
  if (server === undefined) {
    throw new Error(`mock: server ${String(serverId)} not found`);
  }
  const minecraft =
    server.launch.kind === 'direct' ? server.launch.minecraft : (server.versions?.to ?? '');
  return {
    id: serverFolderId(serverId),
    name: server.name,
    serverId,
    minecraft,
    lastPlayedAt,
    sizeBytes,
    iconUrl: server.icon_url,
    cover: server.cover,
  };
}

export const serverEntries: LibraryEntry[] = [
  serverEntry(SERVER_IDS.northernEdge, ago(DAY), 0.9 * GB),
  serverEntry(SERVER_IDS.emeraldValley, ago(3 * DAY), 0.7 * GB),
  serverEntry(SERVER_IDS.pixelCity, ago(7 * DAY), 0.6 * GB),
];

export const storage: StorageSummary = {
  path: 'D:\\Games\\MC Monitor',
  usedBytes: 4.5 * GB,
  freeBytes: 212 * GB,
  serversBytes: 2.2 * GB,
  sharedBytes: 2.3 * GB,
  savedBytes: 3.2 * GB,
};

export const settings = {
  ramGb: 6,
  ramMinGb: 2,
  ramMaxGb: 16,
  recommended: { from: 4, to: 8 },
  systemRamGb: 16,
  resolution: '1920x1080',
  resolutions: ['1280x720', '1600x900', '1920x1080', '2560x1440'],
  folder: 'D:\\Games\\MC Monitor',
  version: '0.1.0',
};

function todayAt(hours: number, minutes: number, seconds = 0): string {
  const date = new Date();
  date.setUTCHours(hours, minutes, seconds, 0);
  return date.toISOString();
}

export type CrashLogLevel = 'info' | 'warn' | 'error' | 'trace';

export interface CrashLogLine {
  at: string;
  level: CrashLogLevel;
  text: string;
}

export const crashes: CrashAnalysis[] = [
  {
    id: 'demo-crash-oom',
    at: todayAt(18, 44, 21),
    instance: serverFolderId(SERVER_IDS.emeraldValley),
    minecraft: '26.1.2',
    memoryMb: 2048,
    totalMemoryMb: 16384,
    javaMajor: 25,
    exit: { code: -805306369, signal: null },
    uptimeMs: (2 * 60 + 14) * 1000,
    cause: { code: 'out-of-memory', memoryMb: 2048, area: 'Java heap space' },
    rule: 'java-heap',
    evidence: 'java.lang.OutOfMemoryError: Java heap space',
    fixes: [
      { type: 'set-memory', mb: 4096 },
      { type: 'advice', advice: 'lower-render-distance' },
      { type: 'advice', advice: 'close-programs' },
      { type: 'report' },
    ],
    autoFixable: true,
    files: { log: true, crashReport: false, jvmReport: false },
  },
  {
    id: 'demo-crash-mods',
    at: todayAt(15, 10, 2),
    instance: serverFolderId(SERVER_IDS.northernEdge),
    minecraft: '1.21.1',
    memoryMb: 3072,
    totalMemoryMb: 16384,
    javaMajor: 21,
    exit: { code: 1, signal: null },
    uptimeMs: 18_000,
    cause: { code: 'mod-conflict', mod: 'Sodium', other: 'Canvas Renderer', mixin: false },
    rule: 'fabric-breaks',
    evidence:
      "Mod 'Sodium' (sodium) 0.6.0 is incompatible with any version of mod 'Canvas Renderer'",
    fixes: [
      { type: 'disable-mod', file: 'canvas-mc1.21.1-1.0.2850.jar' },
      { type: 'advice', advice: 'update-mod' },
      { type: 'open-folder', folder: 'mods' },
      { type: 'report' },
    ],
    autoFixable: true,
    files: { log: true, crashReport: true, jvmReport: false },
  },
];

export const crashLogs: Record<string, CrashLogLine[]> = {
  'demo-crash-oom': [
    {
      at: todayAt(18, 42, 7),
      level: 'info',
      text: '[Render thread/INFO]: Loaded 3 418 files, 24 mods',
    },
    {
      at: todayAt(18, 42, 31),
      level: 'info',
      text: '[Render thread/INFO]: Iris: loaded shaderpack Complementary',
    },
    {
      at: todayAt(18, 44, 18),
      level: 'warn',
      text: "[Server thread/WARN]: Can't keep up! Is the server overloaded? Running 2145ms behind",
    },
    {
      at: todayAt(18, 44, 21),
      level: 'error',
      text: '[Render thread/ERROR]: java.lang.OutOfMemoryError: Java heap space',
    },
    {
      at: todayAt(18, 44, 21),
      level: 'trace',
      text: '  at net.minecraft.client.renderer.chunk.SectionRenderDispatcher…',
    },
  ],
  'demo-crash-mods': [
    {
      at: todayAt(15, 9, 44),
      level: 'info',
      text: '[main/INFO]: Loading Minecraft 1.21.1 with Fabric Loader 0.16.10',
    },
    {
      at: todayAt(15, 10, 1),
      level: 'error',
      text: "[main/ERROR]: Mod 'Sodium' (sodium) 0.6.0 is incompatible with any version of mod 'Canvas Renderer'",
    },
    {
      at: todayAt(15, 10, 2),
      level: 'info',
      text: '[main/INFO]: Stopping! Exit code 1',
    },
  ],
};
