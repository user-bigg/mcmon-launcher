import {
  CRASH_ANALYSIS_ID_PATTERN,
  type CrashFixRequest,
  type CrashResult,
  type CrashService,
} from '@shared/crash';
import { IpcChannels } from '@shared/ipc';
import { handleInvokes, listenSubscriptions, UNTRUSTED_SENDER } from '../ipc';

const MAX_FIX_INDEX = 31;

export function crashFailureResult(error: unknown): CrashResult<never> {
  const message = error instanceof Error ? error.message.split('\n')[0] : undefined;
  return { ok: false, error: { code: 'failed', message: message ?? 'unknown' } };
}

function invalid(field: string): CrashResult<never> {
  return { ok: false, error: { code: 'invalid-request', field } };
}

export function parseAnalysisId(value: unknown): CrashResult<string> {
  return typeof value === 'string' && CRASH_ANALYSIS_ID_PATTERN.test(value)
    ? { ok: true, value }
    : invalid('analysisId');
}

export function parseFixRequest(value: unknown): CrashResult<CrashFixRequest> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('request');
  }
  const { analysisId, fix, relaunch } = value as Record<string, unknown>;
  const id = parseAnalysisId(analysisId);
  if (!id.ok) {
    return id;
  }
  if (typeof fix !== 'number' || !Number.isInteger(fix) || fix < 0 || fix > MAX_FIX_INDEX) {
    return invalid('fix');
  }
  if (relaunch !== undefined && typeof relaunch !== 'boolean') {
    return invalid('relaunch');
  }
  return relaunch === true
    ? { ok: true, value: { analysisId: id.value, fix, relaunch } }
    : { ok: true, value: { analysisId: id.value, fix } };
}

export function registerCrashIpc(service: CrashService, devServerUrl: string | undefined): void {
  handleInvokes<CrashService>(
    IpcChannels.crash.invoke,
    {
      last: () => service.last(),
      apply: (payload) => {
        const request = parseFixRequest(payload);
        return request.ok ? service.apply(request.value) : request;
      },
      report: (payload) => {
        const id = parseAnalysisId(payload);
        return id.ok ? service.report(id.value) : id;
      },
    },
    { devServerUrl, untrusted: UNTRUSTED_SENDER, onError: crashFailureResult },
  );
  const { events } = IpcChannels.crash;
  const subscribers = listenSubscriptions(events, devServerUrl);
  service.onEvent((event) => {
    subscribers.send(events.event, event);
  });
}
