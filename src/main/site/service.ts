import type { AccountResult, VoteResult } from '@shared/account';
import type { PingTarget, ServerLaunch, ServerList, ServerRow } from '@shared/catalog';
import { formatServerAddress, parseServerAddress } from '@shared/server-address';
import type {
  PingResult,
  SceneFiles,
  SiteChange,
  SiteResult,
  SiteService,
  TelemetryPreview,
} from '@shared/site';
import type { VoteOutcome } from '@shared/telemetry';
import type { AccountManager } from '../account/manager';
import { deviceForDisplay } from '../device/hash';
import type { SiteAssets } from './assets';
import { serverQueryParams, type SiteClient } from './client';
import { FRESH_MS } from './freshness';
import { Recall, type Ask, type Seed } from './recall';
import type { ServerPinger } from './ping';
import type { TelemetryQueue } from './telemetry';

export interface SiteParts {
  client: SiteClient;
  kept: SiteClient;
  assets: SiteAssets;
  pinger: ServerPinger;
  telemetry: TelemetryQueue;
  standardSkin: () => Promise<string | null>;
  launches?: ServerLaunches;
  account: Pick<
    AccountManager,
    | 'favorites'
    | 'setFavorite'
    | 'vote'
    | 'report'
    | 'alerts'
    | 'readAlerts'
    | 'clearAlerts'
    | 'setWatch'
    | 'alertSettings'
    | 'setAlertSettings'
    | 'ownedServers'
    | 'ownedServer'
    | 'votePauses'
    | 'onEvent'
    | 'token'
  >;
  now: () => number;
}

function forDisplay(preview: TelemetryPreview): TelemetryPreview {
  return {
    ...preview,
    packet: { ...preview.packet, device: deviceForDisplay(preview.packet.device) },
  };
}

function voteOutcome(result: AccountResult<unknown>): VoteOutcome {
  if (result.ok) {
    return 'ok';
  }
  switch (result.error.code) {
    case 'vote_paused':
      return 'paused';
    case 'captcha_required':
      return 'captcha_required';
    default:
      return 'error';
  }
}

const KEYS = {
  favorites: 'me:favorites',
  alerts: 'me:alerts',
  alertSettings: 'me:alert-settings',
  owned: 'me:servers',
  votePauses: 'me:vote-pauses',
  card: (id: number): string => `server:${String(id)}`,
  ownedOne: (id: number): string => `me:server:${String(id)}`,
} as const;

type Public<T> = Omit<Ask<SiteResult<T>>, 'ttlMs' | 'seed'> & {
  ttlMs?: number;
  kept?: () => Promise<SiteResult<T>>;
};

type Personal<T> = Omit<Ask<AccountResult<T>>, 'personal'>;

async function seedOf<T>(kept: () => Promise<SiteResult<T>>): Promise<Seed<SiteResult<T>> | null> {
  const value = await kept();
  if (!value.ok) {
    return null;
  }
  const at = Date.parse(value.fetchedAt);
  return value.stale ? { value: { ...value, refreshing: true }, at } : { value, at };
}

const MAX_PING_TARGETS = 500;

// The site's last check of each catalog address, kept in main: the window asks to ping an
// address and never says where to connect.
export class PingTargets {
  private readonly targets = new Map<string, PingTarget>();

  remember(rows: readonly ServerRow[]): void {
    for (const row of rows) {
      const key = formatServerAddress(row.address);
      this.targets.delete(key);
      if (row.pingTarget != null) {
        this.targets.set(key, row.pingTarget);
      }
    }
    for (const key of this.targets.keys()) {
      if (this.targets.size <= MAX_PING_TARGETS) {
        break;
      }
      this.targets.delete(key);
    }
  }

  of(key: string): PingTarget | null {
    return this.targets.get(key) ?? null;
  }
}

const MAX_LAUNCHES = 2000;

// How each catalog server is launched, as the site last said in a list or a card: a launch from
// the tray or a link knows the mods of the server even when the site is out of reach.
export class ServerLaunches {
  private readonly launches = new Map<number, ServerLaunch>();

  remember(rows: readonly ServerRow[]): void {
    for (const row of rows) {
      this.launches.delete(row.id);
      this.launches.set(row.id, row.launch);
    }
    for (const id of this.launches.keys()) {
      if (this.launches.size <= MAX_LAUNCHES) {
        break;
      }
      this.launches.delete(id);
    }
  }

  of(id: number): ServerLaunch | null {
    return this.launches.get(id) ?? null;
  }
}

function listedRows(list: ServerList): ServerRow[] {
  return [...list.data, ...Object.values(list.topSlots).flat()];
}

export function createSiteService(parts: SiteParts): SiteService {
  const { client, kept, assets, pinger, telemetry, account } = parts;
  const targets = new PingTargets();
  const seen = <T>(
    result: Promise<SiteResult<T>>,
    rows: (value: T) => ServerRow[],
  ): Promise<SiteResult<T>> =>
    result.then((read) => {
      if (read.ok) {
        targets.remember(rows(read.value));
        parts.launches?.remember(rows(read.value));
      }
      return read;
    });
  const listeners = new Set<(change: SiteChange) => void>();
  const recall = new Recall({
    now: parts.now,
    onChange: (change): void => {
      for (const listener of listeners) {
        listener(change);
      }
    },
  });
  account.onEvent((event) => {
    if (event.change !== 'changed') {
      recall.clearPersonal();
    }
  });
  const open = <T>(ask: Public<T>): Promise<SiteResult<T>> => {
    const { kept: disk, ...rest } = ask;
    return recall.read({
      ttlMs: FRESH_MS.delegated,
      ...rest,
      ...(disk === undefined ? {} : { seed: () => seedOf(disk) }),
    });
  };
  const mine = <T>(ask: Personal<T>): Promise<AccountResult<T>> =>
    recall.read({ ...ask, personal: true });
  const forget = (...keys: string[]): void => {
    recall.drop((key) => keys.includes(key));
  };
  const afterWrite = async <R extends { ok: boolean }>(
    write: Promise<R>,
    apply: (result: R) => void,
  ): Promise<R> => {
    const result = await write;
    if (result.ok) {
      apply(result);
    }
    return result;
  };
  // Dropped on both sides of the write: a read that starts while the write is on its way would
  // otherwise be kept as fresh with the state from before it.
  const around = async <R>(keys: string[], write: () => Promise<R>): Promise<R> => {
    forget(...keys);
    try {
      return await write();
    } finally {
      forget(...keys);
    }
  };
  const favoriteKept = (id: number, favorite: boolean): void => {
    const known = recall.peek(KEYS.favorites);
    if (known?.ok !== true) {
      forget(KEYS.favorites);
      return;
    }
    const others = (known.value as number[]).filter((item) => item !== id);
    recall.put(
      { key: KEYS.favorites, personal: true },
      { ok: true, value: favorite ? [...others, id] : others },
    );
  };
  return {
    meta: (revalidate) =>
      open({
        key: 'meta',
        change: { topic: 'meta' },
        force: revalidate === true,
        fetch: () => client.meta(revalidate === true),
        kept: () => kept.meta(),
      }),
    servers: (query): Promise<SiteResult<ServerList>> => {
      const first = (query.page ?? 1) === 1;
      const read = open<ServerList>({
        key: `servers:${serverQueryParams(query).toString()}`,
        change: { topic: 'servers', query },
        mode: first ? 'swr' : 'wait',
        fetch: () => client.servers(query),
        ...(first ? { kept: (): ReturnType<typeof kept.servers> => kept.servers(query) } : {}),
      });
      return seen(read, listedRows);
    },
    server: (id) =>
      seen(
        open({
          key: KEYS.card(id),
          change: { topic: 'server', id },
          ttlMs: FRESH_MS.card,
          personal: true,
          fetch: () => client.server(id),
          // The disk holds the card without its personal fields: a signed-in player waits for
          // the real one instead of seeing a guest's.
          ...(account.token() === null ? { kept: () => kept.server(id) } : {}),
        }),
        (card) => [card],
      ),
    live: (ids) =>
      open({
        key: `live:${ids.join(',')}`,
        change: { topic: 'live', ids },
        fetch: () => client.live(ids),
      }),
    scenes: () =>
      open({
        key: 'scenes',
        change: { topic: 'scenes' },
        fetch: () => client.scenes(),
        kept: () => kept.scenes(),
      }),
    skinMod: () =>
      open({
        key: 'skin-mod',
        change: { topic: 'skin-mod' },
        fetch: () => client.skinMod(),
        kept: () => kept.skinMod(),
      }),
    lookPresets: () =>
      open({
        key: 'look-presets',
        change: { topic: 'look-presets' },
        fetch: () => client.lookPresets(),
        kept: () => kept.lookPresets(),
      }),
    standardSkin: () => parts.standardSkin(),
    ensureScene: async (scene, time): Promise<SiteResult<SceneFiles>> => {
      const files = await assets.ensureScene(scene, time);
      return files.ok
        ? { ...files, stale: false, fetchedAt: new Date(parts.now()).toISOString() }
        : files;
    },
    ping: (address): Promise<PingResult> => {
      const parsed = parseServerAddress(address);
      return parsed === null
        ? Promise.resolve({ ok: false, error: { code: 'invalid-request' } })
        : pinger.ping(parsed, targets.of(formatServerAddress(parsed)));
    },
    telemetryPreview: async (): Promise<SiteResult<TelemetryPreview>> => ({
      ok: true,
      value: forDisplay(await telemetry.preview()),
      stale: false,
      fetchedAt: new Date(parts.now()).toISOString(),
    }),
    favorites: () =>
      mine({
        key: KEYS.favorites,
        change: { topic: 'favorites' },
        ttlMs: FRESH_MS.favorites,
        fetch: () => account.favorites(),
      }),
    setFavorite: (id, favorite) =>
      afterWrite(account.setFavorite(id, favorite), (result) => {
        favoriteKept(id, result.ok ? result.value : favorite);
      }),
    vote: async (id, nick): Promise<AccountResult<VoteResult>> => {
      const result = await around([KEYS.card(id), KEYS.votePauses], () => account.vote(id, nick));
      telemetry.push({
        type: 'vote.finished',
        at: new Date(parts.now()).toISOString(),
        server_id: id,
        outcome: voteOutcome(result),
      });
      return result;
    },
    report: (id, draft) => around([KEYS.card(id)], () => account.report(id, draft)),
    alerts: (after) =>
      after === undefined
        ? mine({
            key: KEYS.alerts,
            change: { topic: 'alerts' },
            ttlMs: FRESH_MS.alerts,
            fetch: () => account.alerts(null),
          })
        : account.alerts(after),
    readAlerts: (ids) => around([KEYS.alerts], () => account.readAlerts(ids ?? null)),
    clearAlerts: () => around([KEYS.alerts], () => account.clearAlerts()),
    setWatch: (id, watch) => around([KEYS.card(id)], () => account.setWatch(id, watch)),
    alertSettings: () =>
      mine({
        key: KEYS.alertSettings,
        change: { topic: 'alert-settings' },
        ttlMs: FRESH_MS.alertSettings,
        fetch: () => account.alertSettings(),
      }),
    setAlertSettings: (settings) =>
      afterWrite(account.setAlertSettings(settings), (result) => {
        recall.put({ key: KEYS.alertSettings, personal: true }, result);
      }),
    ownedServers: () =>
      mine({
        key: KEYS.owned,
        change: { topic: 'owned-servers' },
        ttlMs: FRESH_MS.owned,
        fetch: () => account.ownedServers(),
      }),
    ownedServer: (id) =>
      mine({
        key: KEYS.ownedOne(id),
        change: { topic: 'owned-server', id },
        ttlMs: FRESH_MS.owned,
        fetch: () => account.ownedServer(id),
      }),
    votePauses: () =>
      mine({
        key: KEYS.votePauses,
        change: { topic: 'vote-pauses' },
        ttlMs: FRESH_MS.votePauses,
        fetch: () => account.votePauses(),
      }),
    onChanged: (listener) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
