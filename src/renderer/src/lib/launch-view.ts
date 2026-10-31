import { countOf, fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import {
  LAST_VERSION_WITHOUT_CORE_PROFILE,
  LAUNCH_STEPS,
  type LaunchError,
  type LaunchStep,
  type LaunchStepId,
  type LaunchStepStatus,
} from '@shared/launch';
import type { LoaderId } from '@shared/instance';
import { microsoftErrorView } from '@shared/microsoft';
import { isModSlug } from '@shared/mods';
import type { SkinsStatus } from '@shared/skin-mod';
import type { IconName } from '../components/icons';
import { fabricNote, type FabricPurpose } from './skins';
import { duration } from './time';
import { formatBytes } from './units';

export type ErrorAction =
  'retry' | 'retry-without-join' | 'settings' | 'accounts' | 'servers' | 'back' | 'log' | 'dismiss';
type ErrorKey = keyof typeof ru.launchError;

export interface ErrorView {
  eyebrow: string;
  title: string;
  text: string;
  action: string;
  kind: ErrorAction;
}

const errorActions: Record<ErrorKey, ErrorAction> = {
  'java-missing': 'retry',
  'rosetta-missing': 'retry',
  'gpu-unsupported': 'servers',
  'file-locked': 'retry',
  'file-missing': 'retry',
  'too-many-files': 'retry',
  'join-unsupported': 'retry-without-join',
  'mods-required-missing': 'servers',
  'mods-required-failed': 'retry',
  'mods-server-unknown': 'retry',
  running: 'dismiss',
  network: 'retry',
  'disk-full': 'settings',
  'checksum-mismatch': 'retry',
  'permission-denied': 'settings',
  'version-not-found': 'back',
  'loader-not-found': 'back',
  'loader-install-failed': 'retry',
  'invalid-request': 'retry',
  'no-account': 'accounts',
  'no-license': 'accounts',
  nick: 'accounts',
  'nick-taken': 'accounts',
  banned: 'servers',
  'account-unsupported': 'accounts',
  'account-relogin': 'accounts',
  'account-failed': 'accounts',
  'server-in-use': 'dismiss',
  busy: 'dismiss',
  'not-running': 'dismiss',
  cancelled: 'retry',
  'game-start-failed': 'log',
  unknown: 'retry',
};

function errorKey(error: LaunchError): ErrorKey {
  if (error.code === 'invalid-request' && error.field === 'account') {
    return 'no-account';
  }
  if (error.code === 'invalid-request' && error.field === 'license') {
    return 'no-license';
  }
  if (error.code === 'invalid-request' && error.field === 'nick') {
    return 'nick';
  }
  return error.code;
}

function errorParams(error: LaunchError): Record<string, string | number> {
  switch (error.code) {
    case 'java-missing':
      return { major: error.major };
    case 'checksum-mismatch':
      return { file: error.file };
    case 'version-not-found':
      return { minecraft: error.minecraft };
    case 'loader-not-found':
      return { loader: ru.loaders[error.loader], minecraft: error.minecraft };
    case 'loader-install-failed':
      return { loader: ru.loaders[error.loader] };
    case 'invalid-request':
      return { field: error.field };
    case 'join-unsupported':
    case 'rosetta-missing':
      return { minecraft: error.minecraft };
    case 'gpu-unsupported':
      return {
        minecraft: error.minecraft,
        gpu: error.gpu,
        openGl: error.openGl,
        last: LAST_VERSION_WITHOUT_CORE_PROFILE,
      };
    case 'mods-required-missing':
    case 'mods-required-failed':
      return {
        mods: error.mods
          .map(
            (mod) =>
              mod.short ?? mod.title ?? (isModSlug(mod.slug) ? mod.slug : ru.install.unknownMod),
          )
          .join(', '),
      };
    default:
      return {};
  }
}

function reasonText(error: LaunchError): string | null {
  return error.code === 'network' && error.reason !== undefined
    ? ru.networkReasons[error.reason]
    : null;
}

export function errorView(error: LaunchError): ErrorView {
  const key = errorKey(error);
  const strings = ru.launchError[key];
  const params = errorParams(error);
  const microsoft = error.code === 'account-failed' ? microsoftErrorView(error.reason) : null;
  return {
    eyebrow: error.code === 'cancelled' ? ru.install.eyebrowCancelled : ru.install.eyebrowFailed,
    title: microsoft?.title ?? fill(strings.title, params),
    text: microsoft?.text ?? reasonText(error) ?? fill(strings.text, params),
    action: strings.action,
    kind: errorActions[key],
  };
}

export interface StepContext {
  minecraft: string;
  host: string | null;
  memory: string;
  update: string | null;
  skins: SkinsStatus | null;
  fabric: FabricPurpose | null;
  mods?: boolean;
  nowMs?: number;
}

export interface StepView {
  id: LaunchStepId;
  status: LaunchStepStatus;
  icon: IconName;
  title: string;
  note: string;
  statusText: string;
  right: string | null;
  bar: number | null;
}

const stepIcons: Record<LaunchStepId, IconName> = {
  java: 'cup-hot',
  files: 'boxes',
  loader: 'plug',
  verify: 'shield-check',
  launch: 'play-fill',
  join: 'arrow-right',
};

export const statusIcons: Record<LaunchStepStatus, IconName | null> = {
  wait: null,
  active: 'arrow-down',
  done: 'check-lg',
  skipped: 'dash-lg',
  failed: 'x-lg',
};

function stepTitle(id: LaunchStepId, context: StepContext): string {
  if (id === 'join') {
    return context.host === null
      ? ru.install.stepTitles.joinServer
      : fill(ru.install.stepTitles.join, { host: context.host });
  }
  if (id === 'files') {
    return fill(ru.install.stepTitles.files, { version: context.minecraft });
  }
  return ru.install.stepTitles[id];
}

function stepNote(step: LaunchStep, context: StepContext): string {
  if (step.id === 'loader' && context.skins === 'unavailable') {
    return ru.install.skinsUnavailable;
  }
  if (step.id === 'loader' && step.status === 'skipped') {
    return ru.install.loaderSkipped;
  }
  if (step.id === 'loader' && context.mods === true) {
    const skins = context.fabric !== null && fabricNote(context.fabric) === 'skins';
    return skins ? ru.install.fabricLoader.skinsMods : ru.install.fabricLoader.mods;
  }
  if (step.id === 'loader' && context.fabric !== null) {
    return ru.install.fabricLoader[fabricNote(context.fabric)];
  }
  if (step.id === 'join' && step.status === 'skipped') {
    return ru.install.joinNotRun;
  }
  if (step.id === 'files' && step.bytesQueued > 0) {
    return fill(ru.install.bytes, {
      done: formatBytes(step.bytesDone),
      total: formatBytes(step.bytesQueued),
    });
  }
  if (step.id === 'files' && step.status !== 'done' && context.update !== null) {
    return context.update;
  }
  if (step.id === 'verify' && step.filesTotal > 0) {
    return fill(ru.install.verifyCount, { count: countOf(step.filesTotal, ru.plural.files) });
  }
  if (step.id === 'launch') {
    return fill(ru.install.stepNotes.launch, { memory: context.memory });
  }
  return ru.install.stepNotes[step.id];
}

function stepBar(step: LaunchStep): number | null {
  if (step.status !== 'active' || step.bytesQueued <= 0) {
    return null;
  }
  return Math.min(100, Math.floor((step.bytesDone * 100) / step.bytesQueued));
}

// Main sends the duration with each progress event, and the launch step has no progress of
// its own: the time of an active step runs on the screen's clock.
function stepMs(step: LaunchStep, nowMs: number | undefined): number | null {
  const started = step.startedAt === null ? Number.NaN : Date.parse(step.startedAt);
  if (step.status !== 'active' || nowMs === undefined || Number.isNaN(started)) {
    return step.durationMs;
  }
  return Math.max(step.durationMs ?? 0, nowMs - started);
}

// The join step is done the moment the window opens: it has no time of its own to show.
function stepRight(step: LaunchStep, nowMs: number | undefined): string | null {
  if (step.id === 'join' || step.status === 'wait' || step.status === 'skipped') {
    return null;
  }
  const ms = stepMs(step, nowMs);
  return ms === null ? null : duration(ms / 1000);
}

export function idleSteps(loader: LoaderId): LaunchStep[] {
  return LAUNCH_STEPS.map((id) => ({
    id,
    status: id === 'loader' && loader === 'vanilla' ? 'skipped' : 'wait',
    startedAt: null,
    durationMs: null,
    bytesPlanned: 0,
    bytesQueued: 0,
    bytesDone: 0,
    filesTotal: 0,
    filesDone: 0,
  }));
}

export function stepView(step: LaunchStep, context: StepContext): StepView {
  return {
    id: step.id,
    status: step.status,
    icon: stepIcons[step.id],
    title: stepTitle(step.id, context),
    note: stepNote(step, context),
    statusText: ru.install.stepStatus[step.status],
    right: stepRight(step, context.nowMs),
    bar: stepBar(step),
  };
}
