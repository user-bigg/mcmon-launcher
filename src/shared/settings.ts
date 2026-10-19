export const WHILE_GAME = ['tray', 'minimize', 'keep'] as const;
export const SPEED_LIMITS = ['none', 'mbps10', 'mbps5'] as const;
export const CHANNELS = ['stable', 'beta'] as const;

export type WhileGame = (typeof WHILE_GAME)[number];
export type SpeedLimit = (typeof SPEED_LIMITS)[number];
export type Channel = (typeof CHANNELS)[number];

export interface LauncherSettings {
  ramGb: number;
  autoMemory: boolean;
  resolution: string;
  fullscreen: boolean;
  whileGame: WhileGame;
  autostart: boolean;
  speed: SpeedLimit;
  crashReports: boolean;
  channel: Channel;
  autoDownload: boolean;
  joinServer: boolean;
}

export type SettingsPatch = Partial<LauncherSettings>;

export type SettingsResult =
  | { ok: true; value: LauncherSettings }
  | { ok: false; error: { code: 'invalid-request'; field: string } | { code: 'failed' } };

export interface SettingsService {
  get: () => Promise<SettingsResult>;
  update: (patch: SettingsPatch) => Promise<SettingsResult>;
}

export const MIN_RAM_GB = 1;
export const MAX_RAM_GB = 256;
const RESOLUTION_PATTERN = /^\d{3,5}x\d{3,5}$/;
const MIN_WINDOW = { width: 640, height: 480 } as const;
const MAX_WINDOW = { width: 7680, height: 4320 } as const;

function windowSize(resolution: string): { width: number; height: number } | null {
  if (!RESOLUTION_PATTERN.test(resolution)) {
    return null;
  }
  const [width = 0, height = 0] = resolution.split('x').map(Number);
  const fits =
    width >= MIN_WINDOW.width &&
    width <= MAX_WINDOW.width &&
    height >= MIN_WINDOW.height &&
    height <= MAX_WINDOW.height;
  return fits ? { width, height } : null;
}

export const DEFAULT_SETTINGS: Readonly<LauncherSettings> = {
  ramGb: 4,
  autoMemory: true,
  resolution: '1280x720',
  fullscreen: true,
  whileGame: 'tray',
  autostart: true,
  speed: 'none',
  crashReports: true,
  channel: 'stable',
  autoDownload: true,
  joinServer: true,
};

type Validator<T> = (value: unknown) => value is T;

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function oneOf<T extends string>(options: readonly T[]): Validator<T> {
  return (value): value is T => typeof value === 'string' && options.includes(value as T);
}

const VALIDATORS: { [K in keyof LauncherSettings]: Validator<LauncherSettings[K]> } = {
  ramGb: (value): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_RAM_GB &&
    value <= MAX_RAM_GB,
  autoMemory: isBoolean,
  resolution: (value): value is string => typeof value === 'string' && windowSize(value) !== null,
  fullscreen: isBoolean,
  whileGame: oneOf(WHILE_GAME),
  autostart: isBoolean,
  speed: oneOf(SPEED_LIMITS),
  crashReports: isBoolean,
  channel: oneOf(CHANNELS),
  autoDownload: isBoolean,
  joinServer: isBoolean,
};

export const SETTINGS_KEYS = Object.keys(VALIDATORS) as (keyof LauncherSettings)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSettingsKey(key: string): key is keyof LauncherSettings {
  return (SETTINGS_KEYS as string[]).includes(key);
}

function validField(key: keyof LauncherSettings, value: unknown): boolean {
  return VALIDATORS[key](value);
}

export type PatchParse = { ok: true; value: SettingsPatch } | { ok: false; field: string };

export function parseSettingsPatch(value: unknown): PatchParse {
  if (!isRecord(value)) {
    return { ok: false, field: 'patch' };
  }
  const patch: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (!isSettingsKey(key) || !validField(key, field)) {
      return { ok: false, field: key };
    }
    patch[key] = field;
  }
  return { ok: true, value: patch };
}

export interface GameWindow {
  fullscreen: boolean;
  width: number;
  height: number;
}

export function gameWindowOf(
  settings: Pick<LauncherSettings, 'fullscreen' | 'resolution'>,
): GameWindow {
  const size = windowSize(settings.resolution) ?? { width: 0, height: 0 };
  return { fullscreen: settings.fullscreen, ...size };
}

export function normalizeSettings(value: unknown): LauncherSettings {
  const source = isRecord(value) ? value : {};
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTINGS_KEYS) {
    if (validField(key, source[key])) {
      result[key] = source[key];
    }
  }
  return result as unknown as LauncherSettings;
}
