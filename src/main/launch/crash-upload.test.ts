import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCrashUpload,
  headOf,
  problemOf,
  shouldUpload,
  tailOf,
  type CrashUploadInput,
} from './crash-upload';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'crash-upload-'));
  await mkdir(path.join(root, 'logs'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function input(overrides: Partial<CrashUploadInput> = {}): CrashUploadInput {
  return {
    instanceDir: root,
    folderId: 'server-185',
    minecraft: '26.3',
    loader: 'fabric',
    launchId: 'f3c1a3c2-6a0e-4c43-9a3e-1b2f1b2f1b2f',
    clientMod: true,
    javaMajor: 25,
    exitCode: 1,
    uptimeMs: 45_400,
    cause: { code: 'graphics', problem: 'context' },
    crashReport: null,
    since: 0,
    ...overrides,
  };
}

describe('shouldUpload', () => {
  const crash = {
    stoppedByUser: false,
    crashed: false,
    exitCode: 1,
    uptimeMs: 40_000,
    cause: { code: 'unknown' } as const,
  };

  it('sends a crash and an early exit with an error code', () => {
    expect(shouldUpload({ ...crash, crashed: true, uptimeMs: 600_000 })).toBe(true);
    expect(shouldUpload(crash)).toBe(true);
  });

  it('skips a late exit, a clean exit, a closed game and a stop by the player', () => {
    expect(shouldUpload({ ...crash, uptimeMs: 600_000 })).toBe(false);
    expect(shouldUpload({ ...crash, exitCode: 0 })).toBe(false);
    expect(shouldUpload({ ...crash, crashed: true, cause: { code: 'closed' } })).toBe(false);
    expect(shouldUpload({ ...crash, crashed: true, stoppedByUser: true })).toBe(false);
  });
});

describe('problemOf', () => {
  it('adds the graphics problem to the cause', () => {
    expect(problemOf({ code: 'graphics', problem: 'context' })).toBe('graphics.context');
    expect(problemOf({ code: 'disk-full' })).toBe('disk-full');
  });
});

describe('tailOf and headOf', () => {
  it('never split a character or grow past the limit', () => {
    const cyrillic = 'ж'.repeat(100);
    expect(Buffer.byteLength(tailOf(cyrillic, 51))).toBeLessThanOrEqual(51);
    expect(tailOf(cyrillic, 51)).not.toContain('\uFFFD');
    expect(Buffer.byteLength(headOf(cyrillic, 51))).toBeLessThanOrEqual(51);
    expect(tailOf('', 10)).toBe('');
  });

  it('cut on whole lines within the byte limit', () => {
    const text = 'первая строка\nвторая\nтретья';
    expect(tailOf(text, 20)).toBe('третья');
    expect(headOf(text, 30)).toBe('первая строка');
    expect(tailOf(text, 1000)).toBe(text);
  });
});

describe('buildCrashUpload', () => {
  it('takes the tail of latest.log and keeps paths and the nick, without tokens', async () => {
    await writeFile(
      path.join(root, 'logs', 'latest.log'),
      [
        '[main/INFO]: Setting user: Steve_77',
        '[main/INFO]: C:\\Users\\Иван\\AppData\\Local\\MC Monitor',
        '--accessToken eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
      ].join('\n'),
    );
    const report = await buildCrashUpload(
      input({ crashReport: '---- Minecraft Crash Report ----' }),
    );
    expect(report).toMatchObject({
      launch_id: 'f3c1a3c2-6a0e-4c43-9a3e-1b2f1b2f1b2f',
      server_id: 185,
      minecraft: '26.3',
      loader: 'fabric',
      client_mod: 'on',
      java_major: 25,
      exit_code: 1,
      duration_s: 45,
      problem: 'graphics.context',
      crash_report: '---- Minecraft Crash Report ----',
    });
    expect(report.log_tail).toContain('Setting user: Steve_77');
    expect(report.log_tail).toContain('C:\\Users\\Иван\\');
    expect(report.log_tail).toContain('--accessToken <hidden>');
    expect(report.log_tail).not.toContain('eyJ');
  });

  it('falls back to the process output when latest.log is missing', async () => {
    await writeFile(path.join(root, 'logs', 'mcmonitor-launch.log'), 'Error: no OpenGL');
    const report = await buildCrashUpload(input({ launchId: null, folderId: 'library-1' }));
    expect(report.log_tail).toBe('Error: no OpenGL');
    expect(report).not.toHaveProperty('launch_id');
    expect(report).not.toHaveProperty('server_id');
  });

  it('sends an empty tail when the game left no log', async () => {
    const report = await buildCrashUpload(input());
    expect(report.log_tail).toBe('');
  });

  it('keeps the body within the site limit when paths double in JSON', async () => {
    const line = 'C:\\Users\\Player\\AppData\\Local\\MC Monitor\\game\\libraries\\x.jar\n';
    await writeFile(path.join(root, 'logs', 'latest.log'), line.repeat(4000));
    const report = await buildCrashUpload(input({ crashReport: line.repeat(4000) }));
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(188 * 1024);
    expect(report.log_tail.length).toBeGreaterThan(10_000);
  });

  it('drops chat lines and a log left by an earlier run', async () => {
    await writeFile(
      path.join(root, 'logs', 'latest.log'),
      '[Render thread/INFO]: [System] [CHAT] <Alex> мой пароль 12345\r\nGLFW error 65543\r\n',
    );
    const fresh = await buildCrashUpload(input());
    expect(fresh.log_tail).toBe('GLFW error 65543\n');
    await writeFile(path.join(root, 'logs', 'mcmonitor-launch.log'), 'Error: could not reserve');
    const stale = await buildCrashUpload(input({ since: Date.now() + 60_000 }));
    expect(stale.log_tail).toBe('');
  });
});

describe('redaction for the site', () => {
  it('hides secret variables of a JVM report and keeps asset hashes', async () => {
    const report = [
      'Environment Variables:',
      'DEPLOYTOKEN=ghp_abc',
      'CLOUDAPIKEY=xyz',
      'PATH=C:\\Windows',
      'assets/objects/5f/5f1c2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c',
    ].join('\n');
    const upload = await buildCrashUpload(input({ crashReport: report }));
    expect(upload.crash_report).toContain('DEPLOYTOKEN=<hidden>');
    expect(upload.crash_report).toContain('CLOUDAPIKEY=<hidden>');
    expect(upload.crash_report).toContain('PATH=C:\\Windows');
    expect(upload.crash_report).toContain('5f1c2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c');
  });
});
