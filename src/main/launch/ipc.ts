import { IpcChannels } from '@shared/ipc';
import { isModsAnswer, LOG_TAIL_MAX_LINES, type LaunchService } from '@shared/launch';
import { handleInvokes, listenSubscriptions, UNTRUSTED_SENDER, type Subscribers } from '../ipc';
import { toLaunchError } from './errors';
import { parseLaunchRequest, parseLaunchTarget, parseLogLines } from './request';

export function launchFailureResult(error: unknown): unknown {
  return { ok: false, error: toLaunchError(error) };
}

export function registerLaunchIpc(
  service: LaunchService,
  devServerUrl: string | undefined,
  totalMemoryBytes: number,
): Subscribers {
  handleInvokes<LaunchService>(
    IpcChannels.launch.invoke,
    {
      prepare: (payload) => {
        const target = parseLaunchTarget(payload);
        return target.ok ? service.prepare(target.value) : target;
      },
      launch: (payload) => {
        const request = parseLaunchRequest(payload, totalMemoryBytes);
        return request.ok ? service.launch(request.value) : request;
      },
      cancel: () => service.cancel(),
      kill: () => service.kill(),
      keepWaiting: () => service.keepWaiting(),
      setJoinServer: (payload) =>
        typeof payload === 'boolean'
          ? service.setJoinServer(payload)
          : { ok: false, error: { code: 'invalid-request', field: 'joinServer' } },
      answerMods: (payload) =>
        isModsAnswer(payload)
          ? service.answerMods(payload)
          : { ok: false, error: { code: 'invalid-request', field: 'answer' } },
      logTail: (payload) => {
        const lines = parseLogLines(payload, LOG_TAIL_MAX_LINES);
        return lines.ok ? service.logTail(lines.value) : lines;
      },
      state: () => service.state(),
    },
    { devServerUrl, untrusted: UNTRUSTED_SENDER, onError: launchFailureResult },
  );
  const { events } = IpcChannels.launch;
  const subscribers = listenSubscriptions(events, devServerUrl);
  service.onEvent((event) => {
    subscribers.send(events.event, event);
  });
  return subscribers;
}
