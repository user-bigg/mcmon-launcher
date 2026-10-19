import type { ModsStepState, ModStep } from '@shared/mods';
import {
  LAUNCH_STEPS,
  type LaunchProgress,
  type LaunchStep,
  type LaunchStepId,
  type LaunchStepStatus,
} from '@shared/launch';

interface StepState {
  status: LaunchStepStatus;
  startedAt: number | null;
  finishedAt: number | null;
  bytesPlanned: number;
  bytesQueued: number;
  bytesDone: number;
  bytesBefore: Bytes;
  filesTotal: number;
  filesDone: number;
}

interface Bytes {
  planned: number;
  queued: number;
  done: number;
}

const NO_BYTES: Readonly<Bytes> = { planned: 0, queued: 0, done: 0 };

interface Sample {
  at: number;
  bytes: number;
}

const SPEED_WINDOW_MS = 5000;

const STEP_WEIGHTS: Record<LaunchStepId, number> = {
  java: 15,
  files: 55,
  loader: 10,
  verify: 10,
  launch: 7,
  join: 3,
};

export class ProgressModel {
  private readonly steps = new Map<LaunchStepId, StepState>();
  private samples: Sample[] = [];
  private shownPercent = 0;
  private retryCount = 0;
  private mods: ModsStepState | null = null;

  constructor(private readonly now: () => number = Date.now) {
    for (const id of LAUNCH_STEPS) {
      this.steps.set(id, {
        status: 'wait',
        startedAt: null,
        finishedAt: null,
        bytesPlanned: 0,
        bytesQueued: 0,
        bytesDone: 0,
        bytesBefore: NO_BYTES,
        filesTotal: 0,
        filesDone: 0,
      });
    }
  }

  start(id: LaunchStepId): void {
    const step = this.step(id);
    step.status = 'active';
    step.bytesBefore = {
      planned: step.bytesPlanned,
      queued: step.bytesQueued,
      done: step.bytesDone,
    };
    step.startedAt = this.now();
    step.finishedAt = null;
  }

  finish(id: LaunchStepId): void {
    const step = this.step(id);
    step.filesDone = Math.max(step.filesDone, step.filesTotal);
    this.close(id, 'done');
  }

  fail(id: LaunchStepId): void {
    this.close(id, 'failed');
  }

  skip(id: LaunchStepId): void {
    this.close(id, 'skipped');
  }

  failActive(fallback?: LaunchStepId): void {
    let failed = false;
    for (const [id, step] of this.steps) {
      if (step.status === 'active') {
        this.fail(id);
        failed = true;
      }
    }
    if (!failed && fallback !== undefined && this.step(fallback).status === 'wait') {
      this.fail(fallback);
    }
  }

  skipWaiting(): void {
    for (const [id, step] of this.steps) {
      if (step.status === 'wait') {
        this.skip(id);
      }
    }
  }

  planMods(state: ModsStepState): void {
    this.mods = {
      steps: state.steps.map((step) => ({ ...step, dependencyOf: [...step.dependencyOf] })),
      skipped: state.skipped.map((item) => ({ ...item })),
    };
  }

  modStep(slug: string, change: Partial<Pick<ModStep, 'status' | 'bytesDone' | 'fromDisk'>>): void {
    const step = this.mods?.steps.find((item) => item.slug === slug);
    if (step === undefined) {
      return;
    }
    Object.assign(step, change);
    if (change.bytesDone !== undefined) {
      step.bytesDone = Math.min(step.size, Math.max(0, change.bytesDone));
      this.samples.push({ at: this.now(), bytes: this.totalDone() });
    }
  }

  retried(): void {
    this.retryCount += 1;
  }

  planFiles(id: LaunchStepId, total: number): void {
    this.step(id).filesTotal = Math.max(0, total);
  }

  fileDone(id: LaunchStepId): void {
    const step = this.step(id);
    step.filesDone += 1;
    step.filesTotal = Math.max(step.filesTotal, step.filesDone);
  }

  bytesDoneOf(id: LaunchStepId): number {
    return this.step(id).bytesDone;
  }

  plan(id: LaunchStepId, bytes: number): void {
    this.step(id).bytesPlanned += Math.max(0, bytes);
  }

  queue(id: LaunchStepId, bytes: number): void {
    this.step(id).bytesQueued += Math.max(0, bytes);
  }

  setDone(id: LaunchStepId, bytes: number): void {
    const step = this.step(id);
    step.bytesDone = Math.max(step.bytesDone, bytes);
    this.samples.push({ at: this.now(), bytes: this.totalDone() });
  }

  status(id: LaunchStepId): LaunchStepStatus {
    return this.step(id).status;
  }

  current(): LaunchStepId | null {
    return LAUNCH_STEPS.find((id) => this.step(id).status === 'active') ?? null;
  }

  snapshot(): LaunchProgress {
    const bytesDone = this.totalDone();
    const bytesTotal =
      this.sum((step) => Math.max(step.bytesQueued, step.bytesDone)) + this.modBytes('size');
    const bytesPerSecond = this.speed();
    const remaining = bytesTotal - bytesDone;
    const mods = this.mods;
    return {
      ...(mods === null
        ? {}
        : {
            mods: {
              steps: mods.steps.map((step) => ({ ...step, dependencyOf: [...step.dependencyOf] })),
              skipped: mods.skipped.map((item) => ({ ...item })),
            },
          }),
      steps: LAUNCH_STEPS.map((id) => this.view(id)),
      current: this.current(),
      percent: this.percent(),
      bytesDone,
      bytesTotal,
      bytesPerSecond,
      remainingSeconds:
        bytesPerSecond > 0 && remaining > 0 ? Math.ceil(remaining / bytesPerSecond) : null,
      retries: this.retryCount,
    };
  }

  private step(id: LaunchStepId): StepState {
    const step = this.steps.get(id);
    if (step === undefined) {
      throw new Error(`Unknown launch step ${id}`);
    }
    return step;
  }

  private close(id: LaunchStepId, status: LaunchStepStatus): void {
    const step = this.step(id);
    step.status = status;
    step.finishedAt = this.now();
    this.samples = [];
  }

  private sum(pick: (step: StepState) => number): number {
    let total = 0;
    for (const step of this.steps.values()) {
      total += pick(step);
    }
    return total;
  }

  private totalDone(): number {
    return this.sum((step) => step.bytesDone) + this.modBytes('bytesDone');
  }

  // A mod taken from the disk downloads nothing and does not count in the bytes of the launch.
  private modBytes(field: 'size' | 'bytesDone'): number {
    return (this.mods?.steps ?? [])
      .filter((step) => !step.fromDisk)
      .reduce((sum, step) => sum + step[field], 0);
  }

  private speed(): number {
    const now = this.now();
    this.samples = this.samples.filter((sample) => now - sample.at <= SPEED_WINDOW_MS);
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (first === undefined || last === undefined || last.at === first.at) {
      return 0;
    }
    return Math.round(((last.bytes - first.bytes) * 1000) / (last.at - first.at));
  }

  private fraction(step: StepState): number {
    if (step.status === 'done' || step.status === 'skipped') {
      return 1;
    }
    if (step.status === 'wait') {
      return 0;
    }
    if (step.filesTotal > 0) {
      return Math.min(1, step.filesDone / step.filesTotal);
    }
    const { queued, done } = this.ownBytes(step);
    return queued > 0 ? Math.min(1, done / queued) : 0;
  }

  private ownBytes(step: StepState): Bytes {
    const before = step.bytesBefore;
    const done = step.bytesDone - before.done;
    return {
      planned: step.bytesPlanned - before.planned,
      queued: Math.max(step.bytesQueued - before.queued, done),
      done,
    };
  }

  private percent(): number {
    const all = [...this.steps.values()];
    if (all.every((step) => step.status === 'done' || step.status === 'skipped')) {
      this.shownPercent = 100;
      return 100;
    }
    let weighted = 0;
    let total = 0;
    for (const [id, step] of this.steps) {
      weighted += STEP_WEIGHTS[id] * this.fraction(step);
      total += STEP_WEIGHTS[id];
    }
    const computed = Math.min(99, Math.floor((weighted * 100) / total));
    this.shownPercent = Math.max(this.shownPercent, computed);
    return this.shownPercent;
  }

  private view(id: LaunchStepId): LaunchStep {
    const step = this.step(id);
    const end = step.finishedAt ?? (step.status === 'active' ? this.now() : null);
    const own = this.ownBytes(step);
    return {
      id,
      status: step.status,
      startedAt: step.startedAt === null ? null : new Date(step.startedAt).toISOString(),
      durationMs: step.startedAt === null || end === null ? null : end - step.startedAt,
      bytesPlanned: own.planned,
      bytesQueued: own.queued,
      bytesDone: own.done,
      filesTotal: step.filesTotal,
      filesDone: step.filesDone,
    };
  }
}
