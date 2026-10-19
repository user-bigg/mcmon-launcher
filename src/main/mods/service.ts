import { isValidServerId, isValidVersionId } from '@shared/launch';
import {
  catalogView,
  isModSlug,
  isShaderChoice,
  MAX_ENABLED_MODS,
  MAX_SERVER_MOD_SLUGS,
  newestMinecraft,
  serverKey,
  serverModsView,
  type ModCatalog,
  type ModChoices,
  type ModChoicesPatch,
  type ModsCatalogView,
  type ModsResult,
  type ModsService,
  type ServerModsQuery,
  type ServerModsSource,
  type ServerModsView,
} from '@shared/mods';
import type { SiteResult } from '@shared/site';
import type { InvokeHandlers } from '../ipc';

export interface ModChoicesStore {
  readonly modChoices: ModChoices;
  saveModChoices: (choices: ModChoices) => Promise<void>;
}

export interface ModsParts {
  catalog: () => Promise<SiteResult<ModCatalog>>;
  serverMods: (serverId: number) => Promise<ServerModsSource>;
  store: ModChoicesStore;
}

const INVALID = { ok: false, error: { code: 'invalid-request' } } as const;
const INVALID_SITE = { ok: false, error: { code: 'invalid-request' } } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slugs(value: unknown, max: number): string[] | null {
  return Array.isArray(value) && value.length <= max && value.every(isModSlug)
    ? [...new Set(value)]
    : null;
}

export function checkChoicesPatch(value: unknown): ModChoicesPatch | null {
  if (!isRecord(value)) {
    return null;
  }
  const patch: ModChoicesPatch = {};
  if (value.enabled !== undefined) {
    const enabled = slugs(value.enabled, MAX_ENABLED_MODS);
    if (enabled === null) {
      return null;
    }
    patch.enabled = enabled;
  }
  if (value.shaders !== undefined) {
    if (!isShaderChoice(value.shaders)) {
      return null;
    }
    patch.shaders = value.shaders;
  }
  return patch;
}

export function checkServerModsQuery(value: unknown): ServerModsQuery | null {
  if (!isRecord(value) || !isValidServerId(value.serverId)) {
    return null;
  }
  const { minecraft } = value;
  return typeof minecraft === 'string' && isValidVersionId(minecraft)
    ? { serverId: value.serverId, minecraft }
    : null;
}

function withOptional(
  choices: ModChoices,
  serverId: number,
  slug: string,
  on: boolean,
): ModChoices {
  const key = serverKey(serverId);
  const current = choices.optionalOff[key] ?? [];
  const next = on ? current.filter((item) => item !== slug) : [...new Set([...current, slug])];
  const others = Object.entries(choices.optionalOff).filter(([item]) => item !== key);
  const optionalOff = Object.fromEntries(
    next.length === 0 ? others : [...others, [key, next.slice(0, MAX_SERVER_MOD_SLUGS)]],
  );
  return { ...choices, optionalOff };
}

export function createModsService(parts: ModsParts): InvokeHandlers<ModsService> {
  const { store } = parts;
  const saved = async (choices: ModChoices): Promise<ModsResult<ModChoices>> => {
    await store.saveModChoices(choices);
    return { ok: true, value: store.modChoices };
  };
  return {
    catalog: async (minecraft): Promise<SiteResult<ModsCatalogView>> => {
      if (
        minecraft !== undefined &&
        (typeof minecraft !== 'string' || !isValidVersionId(minecraft))
      ) {
        return INVALID_SITE;
      }
      const catalog = await parts.catalog();
      if (!catalog.ok) {
        return catalog;
      }
      const version = minecraft ?? newestMinecraft(catalog.value);
      return { ...catalog, value: catalogView(catalog.value, store.modChoices, version) };
    },
    choices: () => Promise.resolve({ ok: true, value: store.modChoices }),
    setChoices: async (value): Promise<ModsResult<ModChoices>> => {
      const patch = checkChoicesPatch(value);
      return patch === null ? INVALID : saved({ ...store.modChoices, ...patch });
    },
    serverPlan: async (value): Promise<SiteResult<ServerModsView>> => {
      const query = checkServerModsQuery(value);
      if (query === null) {
        return INVALID_SITE;
      }
      const [catalog, source] = await Promise.all([
        parts.catalog(),
        parts.serverMods(query.serverId),
      ]);
      if (!catalog.ok) {
        return catalog;
      }
      return {
        ...catalog,
        value: serverModsView(query, source, catalog.value, store.modChoices),
      };
    },
    setServerOptional: async (serverId, slug, on): Promise<ModsResult<ModChoices>> => {
      if (!isValidServerId(serverId) || !isModSlug(slug) || typeof on !== 'boolean') {
        return INVALID;
      }
      return saved(withOptional(store.modChoices, serverId, slug, on));
    },
  };
}
