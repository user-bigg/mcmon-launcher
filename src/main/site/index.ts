import { app, net } from 'electron';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PlayCheckQuery } from '@shared/account';
import { serverModsOf, type ModCatalog, type ServerModsSource } from '@shared/mods';
import type { SkinModTable } from '@shared/skin-mod';
import { bareHost, type ServerAddress } from '@shared/server-address';
import { ICON_CACHE_PATH, SITE_PAGE_KEYS, type SiteResult, type SiteService } from '@shared/site';
import type {
  AppAliveState,
  AppStartReason,
  TelemetryDevice,
  TelemetryEvent,
  TelemetrySink,
} from '@shared/telemetry';
import { createAccountApi } from '../account/api';
import { deviceLabel } from '../account/device';
import { registerAccountIpc } from '../account/ipc';
import { startLoopback } from '../account/loopback';
import { AccountManager, type FavoritesCountStore } from '../account/manager';
import type { CheckedPlay } from '../account/nick';
import { TokenStore } from '../account/token-store';
import {
  DeviceReader,
  deviceSources,
  emptyDevice,
  isVirtualMachine,
  readAfterStart,
  rememberRegistryArch,
} from '../device';
import { gameRoot, localDataRoot } from '../data-root';
import { openHttps } from '../external';
import { electronCipher } from '../secret-cipher';
import { readJson, writeJsonAtomic } from '../launch/json-cache';
import { resolveServerSrv } from './srv';
import { APP_ORIGIN } from '../origins';
import { assetHosts, iconId, SiteAssets, type CacheRequest } from './assets';
import { DiskCache } from './cache';
import { SiteClient, type SiteClientOptions } from './client';
import { behaviorTelemetry, loadInstallId, siteApiBase, telemetryOs, userAgent } from './config';
import {
  debugSlowMs,
  SiteHttp,
  slowFetch,
  type Downloaded,
  type Headers,
  type Posted,
} from './http';
import { registerSiteIpc, registerTelemetryIpc } from './ipc';
import type { ParsedScene } from './parse';
import { ServerPinger, type StatusReply } from './ping';
import { createSiteService, ServerLaunches } from './service';
import { readJarEntry } from './jar-entry';
import { MAX_SKIN_BYTES, StandardSkin } from './standard-skin';
import { TelemetryQueue, type TelemetryHeader, type TelemetrySession } from './telemetry';

// Folder names are case-insensitive on Windows and macOS: 'cache' would collide with
// Chromium's own 'Cache'.
const CACHE_FOLDER = 'launcher-cache';
const CACHE_RETENTION_MS = 30 * 24 * 3_600_000;
const LIVE_BATCH_ENV = 'MCMONITOR_LIVE_BATCH';
const ACCOUNT_FILE = 'account.json';
const STANDARD_SKIN_ID = iconId('standard-skin');
const TEXTURE_TIMEOUT_MS = 10_000;
const MACHINE_ARCH_FILE = 'machine-arch.json';

declare const __TELEMETRY_BEHAVIOR__: string | undefined;

function builtBehavior(): string | undefined {
  return typeof __TELEMETRY_BEHAVIOR__ === 'string' ? __TELEMETRY_BEHAVIOR__ : undefined;
}

export interface SitePresence {
  quiet: boolean;
  reason: AppStartReason;
  aliveState: () => AppAliveState;
}

export interface SiteClosing {
  send: () => Promise<void>;
  withdraw: () => void;
  leave: () => void;
}

export interface SiteRuntime {
  service: SiteService;
  telemetry: TelemetrySink;
  playCheck: (query: PlayCheckQuery) => Promise<CheckedPlay>;
  skinMod: () => Promise<SkinModTable | null>;
  modCatalog: () => Promise<SiteResult<ModCatalog>>;
  mods: () => Promise<ModCatalog | null>;
  serverMods: (serverId: number) => Promise<ServerModsSource>;
  registryArch: () => Promise<string | null>;
  virtualMachine: () => Promise<boolean | null>;
  cacheRoot: string;
  resolveCache: (request: CacheRequest) => Promise<string | null>;
  closing: SiteClosing | null;
  dispose: () => void;
}

function log(message: string): void {
  console.warn(message);
}

function timer(run: () => void, ms: number): () => void {
  const handle = setTimeout(run, ms);
  handle.unref();
  return () => {
    clearTimeout(handle);
  };
}

// Another company's server gets no launcher headers: no install id, no launcher name.
async function downloadTexture(url: string, maxBytes: number): Promise<Uint8Array | null> {
  const response = await net.fetch(url, {
    headers: { Accept: 'image/png' },
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(TEXTURE_TIMEOUT_MS),
  });
  const length = Number(response.headers.get('content-length') ?? '0');
  if (response.status !== 200 || length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > maxBytes ? null : bytes;
}

export function startSite(
  devServerUrl: string | undefined,
  presence: SitePresence,
  favoritesCount?: FavoritesCountStore,
): SiteRuntime {
  const startedAt = Date.now();
  const behavior =
    !presence.quiet && behaviorTelemetry(app.isPackaged, process.env, builtBehavior());
  const userData = app.getPath('userData');
  const dataRoot = localDataRoot();
  const cacheRoot = join(dataRoot, CACHE_FOLDER);
  const base = siteApiBase(app.isPackaged, process.env);
  const installId = loadInstallId(join(userData, 'install.json'));
  const agent = userAgent(app.getVersion(), process.platform, process.arch);
  const cache = new DiskCache(join(cacheRoot, 'site'));
  void cache.prune(CACHE_RETENTION_MS, Date.now());
  const deviceReader = new DeviceReader(deviceSources(log));
  const device = presence.quiet
    ? (): Promise<TelemetryDevice> => Promise.resolve(emptyDevice())
    : readAfterStart(() => deviceReader.device(), timer);
  const archFile = join(userData, MACHINE_ARCH_FILE);
  const rememberedArch = rememberRegistryArch({
    read: () => deviceReader.registryArch(),
    load: () => readJson(archFile),
    save: (data) => writeJsonAtomic(archFile, data),
    log,
  });
  const registryArch = presence.quiet ? rememberedArch : readAfterStart(rememberedArch, timer);
  let account: AccountManager | null = null;
  const http = new SiteHttp({
    base,
    fetch: slowFetch(
      (url, init): Promise<Response> => net.fetch(url, init),
      debugSlowMs(app.isPackaged, process.env),
      (ms): Promise<void> => sleep(ms),
    ),
    headers: async (): Promise<Headers> => ({
      'User-Agent': agent,
      'X-Launcher-Install': await installId,
    }),
    cache,
    now: Date.now,
    sleep: (ms): Promise<void> => sleep(ms),
    log,
    auth: {
      token: (): string | null => account?.token() ?? null,
      reject: (token, code): void => {
        account?.reject(token, code);
      },
    },
  });
  const siteHosts = async (): Promise<Set<string>> => {
    const meta = await client.fetchMeta();
    const links = meta.ok ? meta.value.links : {};
    return assetHosts(
      base,
      SITE_PAGE_KEYS.flatMap((key) => links[key] ?? []),
    );
  };
  const assets: SiteAssets = new SiteAssets({
    root: cacheRoot,
    appOrigin: APP_ORIGIN,
    download: (url, maxBytes): Promise<Downloaded> => http.download(url, maxBytes),
    scenes: async (): Promise<ParsedScene[] | null> => {
      const scenes = await client.parsedScenes();
      return scenes.ok ? scenes.value : null;
    },
    allowedHosts: siteHosts,
    log,
  });
  const clientOptions: Omit<SiteClientOptions, 'http'> = {
    log,
    localIcon: (remote): string | null => assets.localIcon(remote),
    // Only the API host: the hosts of the links from /meta are picked by the site's answer
    // and are fine for pictures, not for a jar or for the skin service.
    skinHosts: assetHosts(base, []),
    liveBatch: !app.isPackaged && process.env[LIVE_BATCH_ENV] === '1',
  };
  const client = new SiteClient({ ...clientOptions, http });
  const keptClient = new SiteClient({ ...clientOptions, http: http.kept() });
  const telemetry = new TelemetryQueue({
    store: {
      read: (): Promise<unknown> => readJson(join(dataRoot, 'telemetry', 'queue.json')),
      write: (data): Promise<void> =>
        writeJsonAtomic(join(dataRoot, 'telemetry', 'queue.json'), data),
    },
    header: async (): Promise<TelemetryHeader> => ({
      install: await installId,
      launcher: app.getVersion(),
      os: telemetryOs(process.platform),
      arch: process.arch,
      device: await device(),
    }),
    session: (): TelemetrySession | null => account?.telemetrySession() ?? null,
    send: (packet, token, lane): Promise<Posted> => client.sendTelemetry(packet, token, lane),
    isOnline: (): boolean => net.isOnline(),
    behavior,
    aliveState: presence.aliveState,
    now: Date.now,
    newId: randomUUID,
    setTimer: timer,
    log,
  });
  telemetry.start();
  telemetry.push({
    type: 'app.started',
    at: new Date(startedAt).toISOString(),
    reason: presence.reason,
  });
  const pinger = new ServerPinger({
    query: async (host, port, timeoutMs): Promise<StatusReply> => {
      const { queryStatus } = await import('@xmcl/client');
      return queryStatus({ host: bareHost(host), port }, { timeout: timeoutMs });
    },
    resolveSrv: (address): Promise<ServerAddress> => resolveServerSrv(address),
    now: Date.now,
  });
  const manager = new AccountManager({
    store: new TokenStore(join(userData, ACCOUNT_FILE), electronCipher()),
    api: createAccountApi(http, (remote): string | null => assets.localIcon(remote)),
    connectPage: async (): Promise<string | null> => {
      const meta = await client.fetchMeta();
      if (meta.ok && meta.value.connect !== null) {
        return meta.value.connect;
      }
      const fresh = await client.fetchMeta(true);
      return fresh.ok ? fresh.value.connect : null;
    },
    openBrowser: openHttps,
    listen: startLoopback,
    installId: (): Promise<string> => installId,
    device,
    deviceLabel: deviceLabel(process.platform, hostname()),
    now: Date.now,
    log,
    ...(favoritesCount === undefined ? {} : { favoritesCount }),
    ...(app.isPackaged
      ? {}
      : {
          traceUrl: (url: string): void => {
            log(`account: connect ${url}`);
          },
        }),
  });
  account = manager;
  registerAccountIpc(manager, devServerUrl);
  const standardSkin = new StandardSkin({
    versionsDir: join(gameRoot(), 'versions'),
    file: join(assets.iconsDir, `${STANDARD_SKIN_ID}.png`),
    readJarEntry: (jar, names): Promise<Uint8Array | null> =>
      readJarEntry(jar, names, MAX_SKIN_BYTES),
    download: downloadTexture,
    log,
  });
  const launches = new ServerLaunches();
  const service = createSiteService({
    launches,
    client,
    kept: keptClient,
    assets,
    pinger,
    telemetry,
    standardSkin: async (): Promise<string | null> =>
      (await standardSkin.ensure())
        ? `${APP_ORIGIN}${ICON_CACHE_PATH}/${STANDARD_SKIN_ID}.png`
        : null,
    account: manager,
    now: Date.now,
  });
  registerSiteIpc(service, devServerUrl);
  registerTelemetryIpc(
    {
      behavior,
      now: Date.now,
      push: (event): void => {
        telemetry.push(event);
      },
    },
    devServerUrl,
  );
  const closedNow = (): TelemetryEvent => {
    const now = Date.now();
    return {
      type: 'app.closed',
      at: new Date(now).toISOString(),
      duration_s: Math.round((now - startedAt) / 1000),
    };
  };
  const closing: SiteClosing = {
    send: (): Promise<void> => telemetry.close(closedNow()),
    withdraw: (): void => {
      telemetry.reopen();
    },
    leave: (): void => {
      telemetry.push(closedNow());
    },
  };
  return {
    service,
    telemetry: (event): void => {
      telemetry.push(event);
    },
    playCheck: (query): Promise<CheckedPlay> => manager.admitPlay(query),
    skinMod: async (): Promise<SkinModTable | null> => {
      const table = await client.fetchSkinMod();
      return table.ok ? table.value : null;
    },
    modCatalog: () => client.mods(),
    mods: async (): Promise<ModCatalog | null> => {
      const catalog = await client.fetchMods();
      return catalog.ok ? catalog.value : null;
    },
    serverMods: async (serverId): Promise<ServerModsSource> => {
      const card = await client.server(serverId);
      return serverModsOf(card.ok ? card.value.launch : launches.of(serverId));
    },
    registryArch,
    virtualMachine: async (): Promise<boolean | null> => isVirtualMachine((await device()).vm),
    cacheRoot,
    resolveCache: (request): Promise<string | null> => assets.resolve(request),
    closing: behavior ? closing : null,
    dispose: (): void => {
      telemetry.dispose();
    },
  };
}
