import type { LoaderId } from './instance';
import type { TelemetryMod } from './mods';

export const TELEMETRY_SKINS = ['on', 'off', 'unavailable'] as const;
export type TelemetrySkins = (typeof TELEMETRY_SKINS)[number];

export type TelemetryLoader = LoaderId;
export type TelemetryAccount = 'nick' | 'microsoft';

export type LaunchTelemetryEvent =
  | {
      type: 'install.finished';
      at: string;
      minecraft: string;
      loader: TelemetryLoader;
      outcome: 'ok' | 'error';
      error_code: string | null;
      duration_s: number;
      bytes: number;
    }
  | {
      type: 'launch.started';
      at: string;
      server_id: number | null;
      minecraft: string;
      loader: TelemetryLoader;
      account: TelemetryAccount;
      ram_mb: number;
      java_major: number;
      nick?: string;
      launch_id?: string;
      skins?: TelemetrySkins;
      client_mod?: TelemetrySkins;
      mods?: TelemetryMod[];
    }
  | {
      type: 'launch.finished';
      at: string;
      server_id: number | null;
      outcome: 'ok' | 'crash' | 'exit';
      exit_code: number | null;
      duration_s: number;
      time_to_window_s: number | null;
    };

export const LAUNCH_TELEMETRY_TYPES = [
  'launch.started',
  'launch.finished',
  'install.finished',
] as const satisfies readonly LaunchTelemetryEvent['type'][];

export const APP_START_REASONS = ['user', 'autostart', 'deeplink', 'update'] as const;
export type AppStartReason = (typeof APP_START_REASONS)[number];

export const APP_ALIVE_STATES = ['foreground', 'background', 'playing'] as const;
export type AppAliveState = (typeof APP_ALIVE_STATES)[number];

export const TELEMETRY_SCREENS = [
  'home',
  'servers',
  'server',
  'library',
  'my_servers',
  'accounts',
  'settings',
  'welcome',
  'crash',
  'launch',
  'other',
] as const;
export type TelemetryScreen = (typeof TELEMETRY_SCREENS)[number];

export const PLAIN_ACTION_NAMES = [
  'copy_address',
  'favorite_add',
  'favorite_remove',
  'vote_open_site',
  'own_launcher_open',
  'top_slot_take',
  'top_slot_extend',
] as const;
export type PlainActionName = (typeof PLAIN_ACTION_NAMES)[number];

export const ACTION_NAMES = ['play', ...PLAIN_ACTION_NAMES, 'link_open', 'search', 'tab'] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

export const PLAY_SOURCES = [
  'catalog',
  'top_slot',
  'home_hero',
  'home_popular',
  'favorites',
  'server_page',
  'deeplink',
  'other',
] as const;
export type PlaySource = (typeof PLAY_SOURCES)[number];

export const LINK_KINDS = [
  'site',
  'discord',
  'telegram',
  'vk',
  'youtube',
  'tiktok',
  'description',
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const CATALOG_TABS = ['rating', 'online', 'new', 'favorites'] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

export const VOTE_OUTCOMES = ['ok', 'paused', 'captcha_required', 'error'] as const;
export type VoteOutcome = (typeof VOTE_OUTCOMES)[number];

export interface ScreenViewedEvent {
  type: 'screen.viewed';
  id?: string;
  at: string;
  screen: TelemetryScreen;
  server_id: number | null;
}

export interface ActionEvent {
  type: 'action';
  id?: string;
  at: string;
  name: ActionName;
  server_id: number | null;
  source?: PlaySource;
  kind?: LinkKind;
  tab?: CatalogTab;
  length?: number;
  results?: number;
  launch_id?: string;
}

export type BehaviorTelemetryEvent =
  | { type: 'app.started'; id?: string; at: string; reason: AppStartReason }
  | { type: 'app.closed'; id?: string; at: string; duration_s: number }
  | { type: 'app.alive'; id?: string; at: string; state: AppAliveState }
  | ScreenViewedEvent
  | ActionEvent
  | {
      type: 'vote.finished';
      id?: string;
      at: string;
      server_id: number;
      outcome: VoteOutcome;
    };

export const BEHAVIOR_TELEMETRY_TYPES = [
  'app.started',
  'app.closed',
  'app.alive',
  'screen.viewed',
  'action',
  'vote.finished',
] as const satisfies readonly BehaviorTelemetryEvent['type'][];

export type TelemetryEvent = LaunchTelemetryEvent | BehaviorTelemetryEvent;

export type TelemetryLane = 'launch' | 'behavior';

export type TrackedAction =
  | { name: 'play'; server_id: number; source: PlaySource; launch_id: string }
  | { name: PlainActionName; server_id: number | null }
  | { name: 'link_open'; server_id: number | null; kind: LinkKind }
  | { name: 'search'; server_id: null; length: number; results: number }
  | { name: 'tab'; server_id: null; tab: CatalogTab };

export type TrackedEvent =
  Omit<ScreenViewedEvent, 'at' | 'id'> | ({ type: 'action' } & TrackedAction);

export interface TelemetryApi {
  behavior: () => Promise<boolean>;
  track: (event: TrackedEvent) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export const isLaunchId = isUuid;

export function isBehaviorEvent(event: TelemetryEvent): event is BehaviorTelemetryEvent {
  return isBehaviorType(event.type);
}

export function isBehaviorType(type: TelemetryEventType): type is BehaviorTelemetryEvent['type'] {
  return (BEHAVIOR_TELEMETRY_TYPES as readonly string[]).includes(type);
}

export type TelemetrySink = (event: LaunchTelemetryEvent) => void;

export type TelemetryEventType = TelemetryEvent['type'];

export type TelemetryFieldOf<T extends TelemetryEventType> = Exclude<
  keyof Extract<TelemetryEvent, { type: T }>,
  'type'
>;

export type TelemetryField = {
  [T in TelemetryEventType]: TelemetryFieldOf<T>;
}[TelemetryEventType];

export const TELEMETRY_FIELDS = {
  'launch.started': [
    'at',
    'server_id',
    'minecraft',
    'loader',
    'account',
    'ram_mb',
    'java_major',
    'nick',
    'launch_id',
    'skins',
    'client_mod',
    'mods',
  ],
  'launch.finished': ['at', 'server_id', 'outcome', 'exit_code', 'duration_s', 'time_to_window_s'],
  'install.finished': ['at', 'minecraft', 'loader', 'outcome', 'error_code', 'duration_s', 'bytes'],
  'app.started': ['id', 'at', 'reason'],
  'app.closed': ['id', 'at', 'duration_s'],
  'app.alive': ['id', 'at', 'state'],
  'screen.viewed': ['id', 'at', 'screen', 'server_id'],
  action: [
    'id',
    'at',
    'name',
    'server_id',
    'source',
    'kind',
    'tab',
    'length',
    'results',
    'launch_id',
  ],
  'vote.finished': ['id', 'at', 'server_id', 'outcome'],
} as const satisfies { [T in TelemetryEventType]: readonly TelemetryFieldOf<T>[] };

// The site learns these fields together with the behavior events, so until the flag is on
// they are neither sent nor listed on the privacy screen.
export const BEHAVIOR_ONLY_FIELDS: readonly TelemetryField[] = ['launch_id'];

type UnlistedFields = {
  [T in TelemetryEventType]: Exclude<TelemetryFieldOf<T>, (typeof TELEMETRY_FIELDS)[T][number]>;
}[TelemetryEventType];

export const TELEMETRY_SCHEMA_COMPLETE: [UnlistedFields] extends [never] ? true : never = true;

export const TELEMETRY_VM = [
  'none',
  'parallels',
  'vmware',
  'virtualbox',
  'hyperv',
  'qemu',
  'apple',
  'unknown',
] as const;
export type TelemetryVm = (typeof TELEMETRY_VM)[number];

export const DEVICE_LIMITS = {
  text: 128,
  osBuild: 32,
  mac: 10,
  gpu: 4,
  displays: 8,
} as const;

export type DeviceNativeArch = 'x64' | 'arm64';

export interface DeviceGpu {
  vendor: number;
  device: number;
  name: string | null;
}

export interface DeviceDisplay {
  width: number;
  height: number;
  scale: number;
  label: string | null;
}

export interface DeviceProfile {
  cpu: string | null;
  cores: number | null;
  ram_gb: number | null;
  gpu: DeviceGpu[];
  system: { manufacturer: string | null; model: string | null };
  board: { manufacturer: string | null; model: string | null };
  bios: { vendor: string | null; version: string | null; date: string | null };
  displays: DeviceDisplay[];
  os_build: string | null;
  native_arch: DeviceNativeArch | null;
}

export interface TelemetryDevice {
  machine: string | null;
  volume: string | null;
  mac: string[];
  smbios: string | null;
  disk: string | null;
  baseboard: string | null;
  vm: TelemetryVm;
  profile?: DeviceProfile;
}

export interface TelemetryPacket {
  install: string;
  launcher: string;
  os: string;
  arch: string;
  device: TelemetryDevice;
  events: TelemetryEvent[];
}

export const TELEMETRY_BATCH_SIZE = 50;

export interface CrashUpload {
  launch_id?: string;
  server_id?: number;
  minecraft: string;
  loader: string;
  client_mod?: 'on';
  java_major?: number;
  exit_code?: number;
  duration_s: number;
  problem: string;
  log_tail: string;
  crash_report?: string;
}

export interface CrashReportPacket extends CrashUpload {
  install: string;
  launcher: string;
  os: string;
  arch: string;
}
