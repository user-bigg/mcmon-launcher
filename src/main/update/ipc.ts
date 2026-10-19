import { IpcChannels } from '@shared/ipc';
import {
  isUpdateVersion,
  type RestartResult,
  type UpdateService,
  type UpdateState,
} from '@shared/update';
import { handleInvokes, listenSubscriptions, type InvokeHandlers } from '../ipc';
import type { UpdateController } from './controller';

const FAILED = { ok: false, error: { code: 'not-ready' } } as const;

export type UpdateControl = Pick<
  UpdateController,
  'state' | 'check' | 'download' | 'skip' | 'unskip' | 'restart' | 'onEvent'
>;

function current(control: UpdateControl): Promise<UpdateState> {
  return Promise.resolve(control.state());
}

function stateOr(control: UpdateControl, action: () => Promise<UpdateState>): Promise<UpdateState> {
  return action().catch(() => control.state());
}

export function updateHandlers(control: UpdateControl): InvokeHandlers<UpdateService> {
  return {
    state: () => current(control),
    check: () => stateOr(control, () => control.check()),
    download: () => stateOr(control, () => control.download()),
    skip: (version) =>
      isUpdateVersion(version) ? stateOr(control, () => control.skip(version)) : current(control),
    unskip: (version) =>
      isUpdateVersion(version) ? stateOr(control, () => control.unskip(version)) : current(control),
    restart: () => control.restart().catch((): RestartResult => FAILED),
  };
}

export function registerUpdateIpc(control: UpdateControl, devServerUrl: string | undefined): void {
  handleInvokes<UpdateService>(IpcChannels.update.invoke, updateHandlers(control), {
    devServerUrl,
    untrusted: FAILED,
  });
  const { events } = IpcChannels.update;
  const subscribers = listenSubscriptions(events, devServerUrl);
  control.onEvent((state) => {
    subscribers.send(events.event, state);
  });
}
