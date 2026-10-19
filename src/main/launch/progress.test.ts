import { describe, expect, it } from 'vitest';
import type { ModStep } from '@shared/mods';
import { ProgressModel } from './progress';

function modStep(slug: string, size: number): ModStep {
  return {
    slug,
    short: slug,
    title: slug,
    credit: null,
    kind: 'mod',
    version: '1.0',
    channel: 'release',
    size,
    bytesDone: 0,
    role: 'player',
    dependencyOf: [],
    status: 'wait',
    fromDisk: false,
  };
}

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let time = start;
  return {
    now: () => time,
    advance: (ms): void => {
      time += ms;
    },
  };
}

describe('ProgressModel', () => {
  it('steps follow the launch screen order, with the loader between files and verification', () => {
    const progress = new ProgressModel(clock().now).snapshot();
    expect(progress.steps.map((step) => step.id)).toEqual([
      'java',
      'files',
      'loader',
      'verify',
      'launch',
      'join',
    ]);
    expect(progress.steps.every((step) => step.status === 'wait')).toBe(true);
    expect(progress.current).toBeNull();
    expect(progress.percent).toBe(0);
  });

  it("counts bytes, speed, and remaining time against what's being downloaded, not the whole plan", () => {
    const time = clock();
    const model = new ProgressModel(time.now);
    model.start('files');
    model.plan('files', 700);
    model.queue('files', 400);
    model.setDone('files', 0);
    time.advance(1000);
    model.setDone('files', 100);
    time.advance(1000);
    model.setDone('files', 200);
    const snapshot = model.snapshot();
    expect(snapshot.current).toBe('files');
    expect(snapshot.bytesDone).toBe(200);
    expect(snapshot.bytesTotal).toBe(400);
    expect(snapshot.bytesPerSecond).toBe(100);
    expect(snapshot.remainingSeconds).toBe(2);
    expect(snapshot.percent).toBe(27);
    expect(snapshot.steps[1]).toMatchObject({
      status: 'active',
      bytesPlanned: 700,
      bytesQueued: 400,
      bytesDone: 200,
      durationMs: 2000,
    });
  });

  it('speed is computed over a 5-second window; idling resets it', () => {
    const time = clock();
    const model = new ProgressModel(time.now);
    model.start('java');
    model.queue('java', 1000);
    model.setDone('java', 0);
    time.advance(1000);
    model.setDone('java', 500);
    time.advance(10_000);
    expect(model.snapshot().bytesPerSecond).toBe(0);
    expect(model.snapshot().remainingSeconds).toBeNull();
  });

  it('speed and remaining time reset once a step finishes', () => {
    const time = clock();
    const model = new ProgressModel(time.now);
    model.start('files');
    model.queue('files', 1000);
    model.setDone('files', 0);
    time.advance(1000);
    model.setDone('files', 1000);
    model.finish('files');
    expect(model.snapshot().bytesPerSecond).toBe(0);
  });

  it('bytes from all steps are summed; percentage is weighted by step and never reaches 100 before the end', () => {
    const time = clock();
    const model = new ProgressModel(time.now);
    model.start('java');
    model.queue('java', 100);
    model.setDone('java', 100);
    model.finish('java');
    model.start('files');
    model.queue('files', 100);
    model.setDone('files', 100);
    model.finish('files');
    const snapshot = model.snapshot();
    expect(snapshot.bytesDone).toBe(200);
    expect(snapshot.percent).toBe(70);
  });

  it("without downloads, percentage is computed per step; a skipped step doesn't block reaching 100%", () => {
    const time = clock();
    const model = new ProgressModel(time.now);
    for (const step of ['java', 'files', 'verify', 'launch'] as const) {
      model.start(step);
      time.advance(10);
      model.finish(step);
    }
    expect(model.snapshot().percent).toBe(87);
    model.skip('loader');
    expect(model.snapshot().percent).toBe(97);
    model.skip('join');
    expect(model.snapshot().percent).toBe(100);
  });

  it('the percentage never moves backward when new files are added to the queue', () => {
    const model = new ProgressModel(clock().now);
    model.start('files');
    model.queue('files', 100);
    model.setDone('files', 90);
    const before = model.snapshot().percent;
    model.queue('files', 900);
    expect(model.snapshot().percent).toBe(before);
  });

  it("bytes downloaded before a step starts don't count toward it; the full size means the step is at 100%", () => {
    const MB = 1024 * 1024;
    const model = new ProgressModel(clock().now);
    model.queue('files', 1 * MB);
    model.setDone('files', 1 * MB);
    model.start('java');
    model.queue('java', 100 * MB);
    model.setDone('java', 100 * MB);
    model.finish('java');
    model.start('files');
    expect(model.snapshot().percent).toBe(15);
    expect(model.snapshot().steps[1]).toMatchObject({ bytesQueued: 0, bytesDone: 0 });
    model.queue('files', 525 * MB);
    model.setDone('files', 223 * MB);
    expect(model.snapshot().percent).toBe(38);
    expect(model.snapshot().steps[1]).toMatchObject({ bytesQueued: 525 * MB, bytesDone: 222 * MB });
    expect(model.snapshot()).toMatchObject({ bytesDone: 323 * MB, bytesTotal: 626 * MB });
    model.setDone('files', 526 * MB);
    expect(model.snapshot().steps[1]).toMatchObject({ bytesQueued: 525 * MB, bytesDone: 525 * MB });
    expect(model.snapshot().percent).toBe(70);
  });

  it('file verification shows progress by file count', () => {
    const model = new ProgressModel(clock().now);
    model.start('verify');
    model.planFiles('verify', 4);
    model.fileDone('verify');
    model.fileDone('verify');
    const verify = model.snapshot().steps.find((step) => step.id === 'verify');
    expect(verify).toMatchObject({ filesTotal: 4, filesDone: 2 });
    expect(model.snapshot().percent).toBe(5);
    model.finish('verify');
    expect(model.snapshot().steps.find((step) => step.id === 'verify')).toMatchObject({
      filesDone: 4,
    });
  });

  it('download retries are counted; pending steps can be skipped all at once', () => {
    const model = new ProgressModel(clock().now);
    model.retried();
    model.retried();
    expect(model.snapshot().retries).toBe(2);
    for (const step of ['java', 'files', 'loader', 'verify'] as const) {
      model.start(step);
      model.finish(step);
    }
    model.skipWaiting();
    expect(model.snapshot().percent).toBe(100);
    expect(model.status('launch')).toBe('skipped');
  });

  it('an error with no active step marks the fallback step', () => {
    const model = new ProgressModel(clock().now);
    model.failActive('files');
    expect(model.status('files')).toBe('failed');
    expect(model.status('java')).toBe('wait');
  });

  it('an error marks the active step and records its duration', () => {
    const time = clock();
    const model = new ProgressModel(time.now);
    model.start('verify');
    time.advance(1500);
    model.failActive();
    time.advance(5000);
    const verify = model.snapshot().steps.find((step) => step.id === 'verify');
    expect(verify?.status).toBe('failed');
    expect(verify?.durationMs).toBe(1500);
    expect(verify?.startedAt).toBe(new Date(1_000_000).toISOString());
    expect(model.current()).toBeNull();
  });

  it('mod steps carry their own bytes, and a mod taken from the disk downloads nothing', () => {
    const model = new ProgressModel(clock().now);
    expect(model.snapshot()).not.toHaveProperty('mods');
    model.planMods({ steps: [modStep('voice', 2000), modStep('sodium', 1000)], skipped: [] });
    model.modStep('voice', { status: 'active', bytesDone: 500 });
    model.modStep('sodium', { status: 'done', fromDisk: true });
    model.modStep('unknown', { status: 'failed' });
    const snapshot = model.snapshot();
    expect(snapshot.bytesDone).toBe(500);
    expect(snapshot.bytesTotal).toBe(2000);
    expect(snapshot.mods?.steps.map((step) => [step.slug, step.status, step.bytesDone])).toEqual([
      ['voice', 'active', 500],
      ['sodium', 'done', 0],
    ]);
    model.modStep('voice', { bytesDone: 5000 });
    expect(model.snapshot().mods?.steps[0]?.bytesDone).toBe(2000);
  });
});
