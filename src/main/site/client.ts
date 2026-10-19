import type { ServerCard, ServerList, ServerRow } from '@shared/catalog';
import type { CapePreset, LookPresets, SkinPreset } from '@shared/look';
import type { Scene } from '@shared/scenes';
import type { ServerLive, ServerQuery, SiteError, SiteMeta, SiteResult } from '@shared/site';
import type { ModCatalog } from '@shared/mods';
import type { SkinModTable } from '@shared/skin-mod';
import type { TelemetryLane, TelemetryPacket } from '@shared/telemetry';
import type { Fetched, Posted, SiteReader } from './http';
import { parseCapePresets, parseSkinPresets } from './look';
import {
  parseLive,
  parseLiveBatch,
  parseMeta,
  parseScenes,
  parseServerCard,
  parseServerList,
  withoutPersonal,
  type ParsedScene,
} from './parse';
import { parseModCatalog } from './mods';
import { parseSkinMod } from './skin-mod';

const MINUTE = 60_000;
const LIST_TTL_MS = 20_000;
const META_TTL_MS = 60 * MINUTE;
const SCENES_TTL_MS = 24 * 60 * MINUTE;
const SKIN_MOD_TTL_MS = 60 * MINUTE;
const LOOK_PRESETS_TTL_MS = 10 * MINUTE;
const MODS_TTL_MS = 10 * MINUTE;
const LIVE_PARALLEL = 4;

export interface SiteClientOptions {
  http: SiteReader;
  log: (message: string) => void;
  localIcon: (remote: string | null) => string | null;
  skinHosts?: ReadonlySet<string>;
  liveBatch?: boolean;
}

function result<T>(fetched: Fetched<T>): SiteResult<T> {
  return fetched.ok
    ? {
        ok: true,
        value: fetched.value,
        stale: fetched.stale,
        fetchedAt: new Date(fetched.fetchedAt).toISOString(),
      }
    : fetched;
}

function mapResult<A, B>(fetched: Fetched<A>, map: (value: A) => B): Fetched<B> {
  return fetched.ok ? { ...fetched, value: map(fetched.value) } : fetched;
}

// The site decides what is new and the answer changes at Moscow midnight: a list kept past its
// time because the site is out of reach shows no marks at all.
function current<T extends SkinPreset | CapePreset>(list: { value: T[]; stale: boolean }): T[] {
  return list.stale ? list.value.map((item) => ({ ...item, isNew: false })) : list.value;
}

export function serverQueryParams(query: ServerQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== undefined && query.q !== '') {
    params.set('q', query.q);
  }
  if (query.version !== undefined) {
    params.set('version', query.version);
  }
  for (const mode of query.mode ?? []) {
    params.append('mode[]', mode);
  }
  if (query.access !== undefined && query.access !== 'all') {
    params.set('access', query.access);
  }
  if (query.sort !== undefined) {
    params.set('sort', query.sort);
  }
  if (query.page !== undefined && query.page > 1) {
    params.set('page', String(query.page));
  }
  if (query.per_page !== undefined) {
    params.set('per_page', String(query.per_page));
  }
  return params;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class SiteClient {
  constructor(private readonly options: SiteClientOptions) {}

  async meta(revalidate = false): Promise<SiteResult<SiteMeta>> {
    return result(await this.fetchMeta(revalidate));
  }

  fetchMeta(revalidate = false): Promise<Fetched<SiteMeta>> {
    return this.options.http.get('/meta', undefined, {
      parse: parseMeta,
      fallbackTtlMs: META_TTL_MS,
      ...(revalidate ? { revalidate } : {}),
    });
  }

  async servers(query: ServerQuery): Promise<SiteResult<ServerList>> {
    const fetched = await this.options.http.get('/servers', serverQueryParams(query), {
      parse: (body) => parseServerList(body, this.options.log),
      fallbackTtlMs: LIST_TTL_MS,
    });
    return result(
      mapResult(fetched, (list) => ({
        ...list,
        data: list.data.map((row) => this.withIcon(row)),
        topSlots: {
          diamond: list.topSlots.diamond.map((row) => this.withIcon(row)),
          gold: list.topSlots.gold.map((row) => this.withIcon(row)),
        },
      })),
    );
  }

  async server(id: number): Promise<SiteResult<ServerCard>> {
    const fetched = await this.options.http.get(`/servers/${String(id)}`, undefined, {
      parse: parseServerCard,
      fallbackTtlMs: LIST_TTL_MS,
      auth: 'optional',
      store: withoutPersonal,
    });
    return result(mapResult(fetched, (card) => this.withIcon(card)));
  }

  async live(ids: readonly number[]): Promise<SiteResult<ServerLive[]>> {
    if (this.options.liveBatch === true) {
      return this.liveBatch(ids);
    }
    const all = await mapLimited(ids, LIVE_PARALLEL, (id) =>
      this.options.http.get(`/servers/${String(id)}/live`, undefined, {
        parse: (body) => parseLive(body, id),
        fallbackTtlMs: LIST_TTL_MS,
      }),
    );
    const found = all.flatMap((item) => (item.ok ? [item] : []));
    const firstError = all.find((item): item is { ok: false; error: SiteError } => !item.ok);
    if (found.length === 0 && firstError !== undefined) {
      return firstError;
    }
    return {
      ok: true,
      value: found.map((item) => item.value),
      stale: found.some((item) => item.stale),
      fetchedAt: new Date(
        Math.min(...found.map((item) => item.fetchedAt), Date.now()),
      ).toISOString(),
    };
  }

  async scenes(): Promise<SiteResult<Scene[]>> {
    const fetched = await this.parsedScenes();
    return result(mapResult(fetched, (scenes) => scenes.map((item) => item.scene)));
  }

  parsedScenes(): Promise<Fetched<ParsedScene[]>> {
    return this.options.http.get('/scenes', undefined, {
      parse: (body) => parseScenes(body, this.options.log),
      fallbackTtlMs: SCENES_TTL_MS,
    });
  }

  async skinMod(): Promise<SiteResult<SkinModTable>> {
    return result(await this.fetchSkinMod());
  }

  // A site without this route answers 404 and an empty table has no entries: either way the
  // game starts as it always did, without skins.
  fetchSkinMod(): Promise<Fetched<SkinModTable>> {
    const skinHosts = this.options.skinHosts ?? new Set<string>();
    return this.options.http.get('/skin-mod', undefined, {
      parse: (body) => parseSkinMod(body, { skinHosts, log: this.options.log }),
      fallbackTtlMs: SKIN_MOD_TTL_MS,
    });
  }

  async mods(): Promise<SiteResult<ModCatalog>> {
    return result(await this.fetchMods());
  }

  // The jar addresses are held to the same hosts as the skin mod: the API host, never the
  // hosts of the links from /meta.
  fetchMods(): Promise<Fetched<ModCatalog>> {
    const apiHosts = this.options.skinHosts ?? new Set<string>();
    return this.options.http.get('/mods', undefined, {
      parse: (body) => parseModCatalog(body, { apiHosts, log: this.options.log }),
      fallbackTtlMs: MODS_TTL_MS,
      fixedTtl: true,
    });
  }

  // A site without capes answers 404: the skins are still worth showing.
  async lookPresets(): Promise<SiteResult<LookPresets>> {
    const { http, localIcon } = this.options;
    const [skins, capes] = await Promise.all([
      http.get('/skins/presets', undefined, {
        parse: (body) => parseSkinPresets(body, localIcon),
        fallbackTtlMs: LOOK_PRESETS_TTL_MS,
        fixedTtl: true,
      }),
      http.get('/capes/presets', undefined, {
        parse: (body) => parseCapePresets(body, localIcon),
        fallbackTtlMs: LOOK_PRESETS_TTL_MS,
        fixedTtl: true,
      }),
    ]);
    if (!skins.ok) {
      return skins;
    }
    if (!capes.ok && capes.error.code !== 'not-found') {
      return capes;
    }
    const withCapes = capes.ok ? capes : { value: [], stale: false, fetchedAt: skins.fetchedAt };
    return {
      ok: true,
      value: { skins: current(skins), capes: current(withCapes) },
      stale: skins.stale || withCapes.stale,
      fetchedAt: new Date(Math.min(skins.fetchedAt, withCapes.fetchedAt)).toISOString(),
    };
  }

  sendTelemetry(
    packet: TelemetryPacket,
    token: string | null,
    lane: TelemetryLane = 'launch',
  ): Promise<Posted> {
    return this.options.http.post(
      '/telemetry',
      packet,
      token,
      lane === 'behavior' ? 'behavior' : 'telemetry',
    );
  }

  private async liveBatch(ids: readonly number[]): Promise<SiteResult<ServerLive[]>> {
    const params = new URLSearchParams({ ids: ids.join(',') });
    return result(
      await this.options.http.get('/servers/live', params, {
        parse: (body) => parseLiveBatch(body, this.options.log),
        fallbackTtlMs: LIST_TTL_MS,
      }),
    );
  }

  private withIcon<T extends ServerRow>(row: T): T {
    return { ...row, icon_url: this.options.localIcon(row.icon_url) };
  }
}
