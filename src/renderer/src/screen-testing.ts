import { vi } from 'vitest';
import type { ServerList, ServerRow } from '@shared/catalog';
import {
  LAUNCH_STEPS,
  type LaunchError,
  type LaunchEvent,
  type LaunchProgress,
  type LaunchStepStatus,
} from '@shared/launch';
import type { ServerQuery, SiteResult } from '@shared/site';
import { catalog, findServer, SERVER_IDS, servers, votesTop } from './mock/servers';
import { demoScenes } from './mock/scenes-demo';
import {
  launchEvent,
  mountAt,
  stubLauncher,
  TEST_NOW,
  type Mounted,
  type MountOptions,
  type Stub,
} from './testing';

let current: Mounted | undefined;

export async function mountScreen(path: string, options: MountOptions = {}): Promise<Mounted> {
  current = await mountAt(path, options);
  return current;
}

export function openScreen(path: string, stub: Stub = stubLauncher()): Promise<Mounted> {
  return mountScreen(path, { stub });
}

export function unmountScreen(): void {
  current?.app.unmount();
  current = undefined;
  document.body.replaceChildren();
  localStorage.clear();
}

export const SCREENS = [
  '/',
  '/servers',
  `/server/${String(SERVER_IDS.wasteland)}`,
  `/server/${String(SERVER_IDS.technograd)}`,
  `/server/${String(SERVER_IDS.quietHarbor)}`,
  `/launch/${String(SERVER_IDS.cubeIsland)}`,
  '/library',
  '/accounts',
  '/skins',
  '/settings',
  '/welcome',
  '/crash/server-103',
];

export function serverName(id: number): string {
  const server = findServer(id);
  if (server === undefined) {
    throw new Error(`server ${String(id)} missing`);
  }
  return server.name;
}

export function progress(statuses: LaunchStepStatus[], percent: number): LaunchProgress {
  return {
    steps: LAUNCH_STEPS.map((id, index) => ({
      id,
      status: statuses[index] ?? 'wait',
      startedAt: null,
      durationMs: null,
      bytesPlanned: 0,
      bytesQueued: 1000,
      bytesDone: 400,
      filesTotal: 0,
      filesDone: 0,
    })),
    current: 'files',
    percent,
    bytesDone: 400,
    bytesTotal: 1000,
    bytesPerSecond: 100,
    remainingSeconds: 6,
    retries: 0,
  };
}

export function progressEvent(value: LaunchProgress): LaunchEvent {
  return launchEvent({ kind: 'progress' }, { phase: 'preparing', operationId: 1, progress: value });
}

export function failedEvent(error: LaunchError): LaunchEvent {
  return launchEvent(
    { kind: 'failed', error, source: 'operation' },
    {
      phase: 'idle',
      operationId: 1,
      lastError: { error, source: 'operation', operationId: 1, at: '2026-10-03T12:00:00Z' },
    },
  );
}

export const ONLINE_TOTAL = 15343;

type ServersAnswer = (query: ServerQuery) => Promise<SiteResult<ServerList>>;

export function listOf(data: ServerRow[]): ServerList {
  return {
    data,
    topSlots: { diamond: [], gold: [] },
    topSlotsFree: { diamond: 0, gold: 0 },
    meta: { page: 1, per_page: 50, total: data.length },
  };
}

export function answer(value: ServerList, stale = false): Promise<SiteResult<ServerList>> {
  return Promise.resolve({ ok: true, value, stale, fetchedAt: TEST_NOW.toISOString() });
}

export const SITE_DOWN: Promise<SiteResult<ServerList>> = Promise.resolve({
  ok: false,
  error: { code: 'offline' },
});

export const fullCatalog: ServerList = {
  ...catalog,
  meta: { ...catalog.meta, online_total: ONLINE_TOTAL },
};

export function liveSite(
  stale = false,
  route: (query: ServerQuery) => Promise<SiteResult<ServerList>> | undefined = () => undefined,
): Stub {
  const stub = stubLauncher();
  const fetchedAt = TEST_NOW.toISOString();
  stub.api.site.servers = vi.fn<ServersAnswer>(
    (query) =>
      route(query) ??
      (query.sort === 'votes' ? answer(listOf(votesTop), stale) : answer(fullCatalog, stale)),
  );
  stub.api.site.scenes = (): ReturnType<typeof stub.api.site.scenes> =>
    Promise.resolve({ ok: true, value: demoScenes, stale: false, fetchedAt });
  return stub;
}

export function openLive(stub: Stub = liveSite()): Promise<Mounted> {
  return mountScreen('/', { stub, demo: false });
}

export const byOnline = servers.toSorted((a, b) => b.online - a.online);
export const topServer = byOnline[0];

export function listCalls(stub: Stub): ServerQuery[] {
  return vi
    .mocked(stub.api.site.servers)
    .mock.calls.map(([query]) => query)
    .filter((query) => query.sort !== 'votes');
}
