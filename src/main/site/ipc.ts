import type { AccountErrorCode, AccountResult } from '@shared/account';
import { IpcChannels } from '@shared/ipc';
import type { ReportResult } from '@shared/report';
import { formatServerAddress } from '@shared/server-address';
import type { SiteService } from '@shared/site';
import type { TelemetryApi, TelemetryEvent } from '@shared/telemetry';
import { ipcMain } from 'electron';
import {
  handleInvokes,
  isTrustedSender,
  listenSubscriptions,
  UNTRUSTED_SENDER,
  type InvokeHandlers,
} from '../ipc';
import {
  checkAddress,
  checkAlertCursor,
  checkAlertIds,
  checkAlertSettings,
  checkFavorite,
  checkLiveIds,
  checkReport,
  checkScene,
  checkServerId,
  checkServerQuery,
  checkVote,
  type Checked,
} from './request';
import { rendererEvent } from './telemetry';

type Rejected = Extract<Checked<never>, { ok: false }>;

const FAILED = { ok: false, error: { code: 'server-error' } } as const;

function when<A, R>(checked: Checked<A>, run: (value: A) => R): R | Rejected {
  return checked.ok ? run(checked.value) : checked;
}

function forAccount<A, R>(
  checked: Checked<A>,
  run: (value: A) => Promise<AccountResult<R>>,
): Promise<AccountResult<R>> | AccountResult<R> {
  if (checked.ok) {
    return run(checked.value);
  }
  const code: AccountErrorCode =
    checked.error.field === 'nick' ? 'invalid_nick' : 'invalid_request';
  return { ok: false, error: { code } };
}

export function siteHandlers(service: SiteService): InvokeHandlers<SiteService> {
  return {
    meta: (revalidate) => service.meta(revalidate === true),
    servers: (query) => when(checkServerQuery(query), (value) => service.servers(value)),
    server: (id) => when(checkServerId(id), (value) => service.server(value)),
    live: (ids) => when(checkLiveIds(ids), (value) => service.live(value)),
    scenes: () => service.scenes(),
    skinMod: () => service.skinMod(),
    lookPresets: () => service.lookPresets(),
    standardSkin: () => service.standardSkin(),
    ensureScene: (scene, time) =>
      when(checkScene(scene, time), (value) => service.ensureScene(value.scene, value.time)),
    ping: (address) =>
      when(checkAddress(address), (value) => service.ping(formatServerAddress(value))),
    telemetryPreview: () => service.telemetryPreview(),
    favorites: () => service.favorites(),
    setFavorite: (id, favorite) =>
      forAccount(checkFavorite(id, favorite), (value) =>
        service.setFavorite(value.id, value.favorite),
      ),
    vote: (id, nick) =>
      forAccount(checkVote(id, nick), (value) => service.vote(value.id, value.nick)),
    report: (id, draft) => forReport(checkReport(id, draft), service),
    alerts: (after) => forAccount(checkAlertCursor(after), (value) => service.alerts(value)),
    readAlerts: (ids) => forAccount(checkAlertIds(ids), (value) => service.readAlerts(value)),
    clearAlerts: () => service.clearAlerts(),
    setWatch: (id, watch) =>
      forAccount(checkFavorite(id, watch), (value) => service.setWatch(value.id, value.favorite)),
    alertSettings: () => service.alertSettings(),
    setAlertSettings: (settings) =>
      forAccount(checkAlertSettings(settings), (value) => service.setAlertSettings(value)),
    ownedServers: () => service.ownedServers(),
    ownedServer: (id) => forAccount(checkServerId(id), (value) => service.ownedServer(value)),
    votePauses: () => service.votePauses(),
  };
}

function forReport(
  checked: ReturnType<typeof checkReport>,
  service: SiteService,
): Promise<ReportResult> | ReportResult {
  if (checked.ok) {
    return service.report(checked.value.id, checked.value.draft);
  }
  const code = checked.error.field === 'note' ? 'note_required' : 'invalid_request';
  return { ok: false, error: { code } };
}

export function registerSiteIpc(service: SiteService, devServerUrl: string | undefined): void {
  handleInvokes<SiteService>(IpcChannels.site.invoke, siteHandlers(service), {
    devServerUrl,
    untrusted: UNTRUSTED_SENDER,
    onError: () => FAILED,
  });
  const { events } = IpcChannels.site;
  const subscribers = listenSubscriptions(events, devServerUrl);
  service.onChanged((change) => {
    subscribers.send(events.event, change);
  });
}

export interface TelemetryPort {
  behavior: boolean;
  now: () => number;
  push: (event: TelemetryEvent) => void;
}

export const TRACK_LIMIT = 60;
export const TRACK_WINDOW_MS = 60_000;

export function trackHandler(port: TelemetryPort): (event: unknown) => void {
  let windowStart = Number.NEGATIVE_INFINITY;
  let taken = 0;
  const admit = (now: number): boolean => {
    if (now - windowStart >= TRACK_WINDOW_MS) {
      windowStart = now;
      taken = 0;
    }
    taken += 1;
    return taken <= TRACK_LIMIT;
  };
  return (event) => {
    const now = port.now();
    if (!port.behavior || !admit(now)) {
      return;
    }
    const clean = rendererEvent(event, new Date(now).toISOString());
    if (clean !== null) {
      port.push(clean);
    }
  };
}

export function registerTelemetryIpc(port: TelemetryPort, devServerUrl: string | undefined): void {
  const track = trackHandler(port);
  ipcMain.on(IpcChannels.telemetry.track, (event, payload: unknown) => {
    if (isTrustedSender(event, devServerUrl)) {
      track(payload);
    }
  });
  handleInvokes<TelemetryApi>(
    IpcChannels.telemetry.invoke,
    { behavior: () => port.behavior },
    { devServerUrl, untrusted: false },
  );
}
