import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { IpcChannels } from '@shared/ipc';
import {
  normalizeSettings,
  parseSettingsPatch,
  type LauncherSettings,
  type SettingsPatch,
  type SettingsResult,
  type SettingsService,
} from '@shared/settings';
import {
  normalizePlayers,
  parsePlayers,
  type PlayersResult,
  type PlayersService,
  type StoredPlayers,
} from '@shared/players';
import { isUpdateVersion, MAX_SKIPPED_VERSIONS } from '@shared/update';
import { normalizeModChoices, type ModChoices } from '@shared/mods';
import { handleInvokes, UNTRUSTED_SENDER } from './ipc';

export const SETTINGS_FILE = 'settings.json';
const FILE_VERSION = 1;

export interface SettingsFileSystem {
  read: (file: string) => Promise<string>;
  write: (file: string, content: string) => Promise<void>;
}

export interface LauncherHints {
  trayNotified: boolean;
  leftInTrayNotified: boolean;
  moveDeclined: boolean;
}

export const MAX_REMEMBERED_FAVORITES = 10_000;

export interface LauncherUpdates {
  skipped: string[];
}

interface StoredFile {
  version: number;
  settings: LauncherSettings;
  hints: LauncherHints;
  updates: LauncherUpdates;
  players: StoredPlayers;
  favoritesCount: number | null;
  mods: ModChoices;
}

export type SettingsListener = (previous: LauncherSettings, next: LauncherSettings) => void;

const nodeFileSystem: SettingsFileSystem = {
  read: (file) => readFile(file, 'utf8'),
  write: async (file, content) => {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, file);
  },
};

function parseHints(value: unknown): LauncherHints {
  const source = typeof value === 'object' && value !== null ? value : {};
  const hints = source as {
    trayNotified?: unknown;
    leftInTrayNotified?: unknown;
    moveDeclined?: unknown;
  };
  return {
    trayNotified: hints.trayNotified === true,
    leftInTrayNotified: hints.leftInTrayNotified === true,
    moveDeclined: hints.moveDeclined === true,
  };
}

function parseUpdates(value: unknown): LauncherUpdates {
  const skipped = (value as { skipped?: unknown } | null | undefined)?.skipped;
  const versions = Array.isArray(skipped) ? skipped.filter(isUpdateVersion) : [];
  return { skipped: [...new Set(versions)].slice(-MAX_SKIPPED_VERSIONS) };
}

function parseFavoritesCount(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_REMEMBERED_FAVORITES
    ? value
    : null;
}

function parseStored(text: string): StoredFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    version: FILE_VERSION,
    settings: normalizeSettings(source.settings),
    hints: parseHints(source.hints),
    updates: parseUpdates(source.updates),
    players: normalizePlayers(source.players),
    favoritesCount: parseFavoritesCount(source.favoritesCount),
    mods: normalizeModChoices(source.mods),
  };
}

export class LauncherSettingsStore {
  private data: StoredFile = parseStored('');
  private saving: Promise<void> = Promise.resolve();
  private readonly fs: SettingsFileSystem;
  private readonly listeners = new Set<SettingsListener>();

  constructor(
    private readonly file: string,
    fs?: SettingsFileSystem,
  ) {
    this.fs = fs ?? nodeFileSystem;
  }

  async load(): Promise<void> {
    try {
      this.data = parseStored(await this.fs.read(this.file));
    } catch {
      this.data = parseStored('');
    }
  }

  get settings(): LauncherSettings {
    return { ...this.data.settings };
  }

  get hints(): LauncherHints {
    return { ...this.data.hints };
  }

  get skippedUpdates(): string[] {
    return [...this.data.updates.skipped];
  }

  get players(): StoredPlayers {
    return {
      nicks: this.data.players.nicks.map((record) => ({ ...record })),
      active: this.data.players.active === null ? null : { ...this.data.players.active },
    };
  }

  get favoritesCount(): number | null {
    return this.data.favoritesCount;
  }

  get modChoices(): ModChoices {
    return structuredClone(this.data.mods);
  }

  saveModChoices(choices: ModChoices): Promise<void> {
    this.data = { ...this.data, mods: normalizeModChoices(choices) };
    return this.save();
  }

  // The list itself is never written to disk: the sidebar skeleton needs only its length.
  rememberFavorites(count: number | null): Promise<void> {
    const next = parseFavoritesCount(count);
    if (next === this.data.favoritesCount) {
      return this.saving;
    }
    this.data = { ...this.data, favoritesCount: next };
    return this.save();
  }

  savePlayers(players: StoredPlayers): Promise<void> {
    this.data = { ...this.data, players: normalizePlayers(players) };
    return this.save();
  }

  async forgetMicrosoft(id: string): Promise<void> {
    const { active } = this.data.players;
    if (active?.kind === 'microsoft' && active.id === id) {
      await this.savePlayers({ ...this.data.players, active: null });
    }
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  update(patch: SettingsPatch): Promise<LauncherSettings> {
    const previous = this.settings;
    this.data = { ...this.data, settings: { ...this.data.settings, ...patch } };
    const saved = this.save().then(() => this.settings);
    const next = this.settings;
    for (const listener of this.listeners) {
      listener(previous, next);
    }
    return saved;
  }

  saveSkippedUpdates(versions: string[]): Promise<void> {
    this.data = { ...this.data, updates: parseUpdates({ skipped: versions }) };
    return this.save();
  }

  markHint(hint: keyof LauncherHints): Promise<void> {
    this.data = { ...this.data, hints: { ...this.data.hints, [hint]: true } };
    return this.save();
  }

  flush(): Promise<void> {
    return this.saving;
  }

  private save(): Promise<void> {
    const content = `${JSON.stringify(this.data, null, 2)}\n`;
    this.saving = this.saving.catch(() => undefined).then(() => this.fs.write(this.file, content));
    return this.saving;
  }
}

export function createSettingsService(store: LauncherSettingsStore): SettingsService {
  return {
    get: (): Promise<SettingsResult> => Promise.resolve({ ok: true, value: store.settings }),
    update: async (patch): Promise<SettingsResult> => {
      const parsed = parseSettingsPatch(patch);
      if (!parsed.ok) {
        return { ok: false, error: { code: 'invalid-request', field: parsed.field } };
      }
      return { ok: true, value: await store.update(parsed.value) };
    },
  };
}

export type MicrosoftLookup = (id: string) => Promise<boolean>;

export function createPlayersService(
  store: LauncherSettingsStore,
  hasMicrosoft: MicrosoftLookup = () => Promise.resolve(false),
): PlayersService {
  return {
    get: (): Promise<PlayersResult> => Promise.resolve({ ok: true, value: store.players }),
    save: async (players): Promise<PlayersResult> => {
      const parsed = parsePlayers(players);
      if (parsed === null) {
        return { ok: false, error: { code: 'invalid-request' } };
      }
      if (parsed.active?.kind === 'microsoft' && !(await hasMicrosoft(parsed.active.id))) {
        return { ok: false, error: { code: 'invalid-request' } };
      }
      await store.savePlayers(parsed);
      return { ok: true, value: store.players };
    },
  };
}

export function registerSettingsIpc(
  store: LauncherSettingsStore,
  devServerUrl: string | undefined,
  hasMicrosoft?: MicrosoftLookup,
): void {
  const service = createSettingsService(store);
  handleInvokes<SettingsService>(
    IpcChannels.settings.invoke,
    {
      get: () => service.get(),
      update: (patch) => service.update(patch as SettingsPatch),
    },
    {
      devServerUrl,
      untrusted: UNTRUSTED_SENDER,
      onError: (): SettingsResult => ({ ok: false, error: { code: 'failed' } }),
    },
  );
  const players = createPlayersService(store, hasMicrosoft);
  handleInvokes<PlayersService>(
    IpcChannels.players.invoke,
    {
      get: () => players.get(),
      save: (value) => players.save(value as StoredPlayers),
    },
    {
      devServerUrl,
      untrusted: UNTRUSTED_SENDER,
      onError: (): PlayersResult => ({ ok: false, error: { code: 'failed' } }),
    },
  );
}
