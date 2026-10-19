import type { LaunchStepId, ModsAnswer } from '@shared/launch';
import type { ModLabel, ModsStepState, ModStep } from '@shared/mods';
import type { ClientModStatus, SkinsStatus } from '@shared/skin-mod';
import type { TrackedRuntime, TransferCounters } from './download';
import { DIRECT_NETWORK, type NetworkSetup } from './network';
import { ProgressModel } from './progress';

export const PROGRESS_INTERVAL_MS = 250;

interface Transfer {
  step: LaunchStepId;
  runtime: TrackedRuntime;
  base: number;
}

export type ProgressReporter = (force: boolean) => void;

export class Operation {
  readonly controller = new AbortController();
  readonly progress: ProgressModel;
  network: NetworkSetup = DIRECT_NETWORK;
  skins: SkinsStatus | null = null;
  clientMod: ClientModStatus | null = null;
  joinServer = true;
  joinFixed = false;
  private transfer: Transfer | null = null;
  private modsQuestion: { mods: ModLabel[]; answer: (answer: ModsAnswer) => void } | null = null;
  private readonly timer: NodeJS.Timeout;

  constructor(
    readonly id: number,
    now: () => number,
    private readonly report: ProgressReporter,
  ) {
    this.progress = new ProgressModel(now);
    this.timer = setInterval(() => {
      this.poll();
    }, PROGRESS_INTERVAL_MS);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  poll(): void {
    const transfer = this.transfer;
    if (transfer !== null) {
      this.progress.setDone(transfer.step, transfer.base + transfer.runtime.downloadedBytes());
    }
    this.report(false);
  }

  counters(step: LaunchStepId): TransferCounters {
    return {
      onPlanned: (bytes): void => {
        this.progress.plan(step, bytes);
      },
      onQueued: (bytes): void => {
        this.progress.queue(step, bytes);
      },
      onRetry: (): void => {
        this.progress.retried();
        this.report(true);
      },
    };
  }

  attach(step: LaunchStepId, create: () => TrackedRuntime): TrackedRuntime {
    this.poll();
    const runtime = create();
    this.transfer = { step, runtime, base: this.progress.bytesDoneOf(step) };
    return runtime;
  }

  start(step: LaunchStepId): void {
    this.signal.throwIfAborted();
    this.progress.start(step);
    this.report(true);
  }

  end(step: LaunchStepId): void {
    this.poll();
    this.transfer = null;
    this.progress.finish(step);
    this.report(true);
  }

  drop(step: LaunchStepId): void {
    this.poll();
    this.transfer = null;
    this.progress.skip(step);
    this.report(true);
  }

  planMods(state: ModsStepState): void {
    this.progress.planMods(state);
    this.report(true);
  }

  modStep(slug: string, change: Partial<Pick<ModStep, 'status' | 'bytesDone' | 'fromDisk'>>): void {
    this.progress.modStep(slug, change);
    this.report(change.status !== undefined);
  }

  get modsWaiting(): ModLabel[] | null {
    return this.modsQuestion?.mods ?? null;
  }

  // The launch waits for the player without a time limit: only an answer or a cancel ends it.
  askMods(mods: ModLabel[]): Promise<ModsAnswer> {
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        this.modsQuestion = null;
        const reason: unknown = this.signal.reason;
        reject(reason instanceof Error ? reason : new Error('cancelled'));
      };
      if (this.signal.aborted) {
        abort();
        return;
      }
      this.signal.addEventListener('abort', abort, { once: true });
      this.modsQuestion = {
        mods,
        answer: (answer): void => {
          this.signal.removeEventListener('abort', abort);
          this.modsQuestion = null;
          resolve(answer);
        },
      };
      this.report(true);
    });
  }

  answerMods(answer: ModsAnswer): boolean {
    const question = this.modsQuestion;
    if (question === null) {
      return false;
    }
    question.answer(answer);
    this.report(true);
    return true;
  }

  setSkins(status: SkinsStatus | null): void {
    this.skins = status;
    this.report(true);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
