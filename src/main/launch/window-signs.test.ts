import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { analyzeCrash } from './crash-analyzer';
import type { GameLogWriter } from './game-log';
import { watchGameProcess, type GameProcessHandlers } from './game-process';
import { isWindowFailure, isWindowReady } from './window-signs';

const liveLog = readFileSync(
  join(import.meta.dirname, 'fixtures', 'crash', 'graphics-pixel-attributes.txt'),
  'utf8',
);

const HEALTHY_DIR = join(import.meta.dirname, 'fixtures', 'window');
const HEALTHY = readdirSync(HEALTHY_DIR).filter((name) => name.endsWith('.txt'));

function healthy(name: string): string {
  return readFileSync(join(HEALTHY_DIR, name), 'utf8');
}

const FAILURES = [
  '[10:15:02] [Render thread/ERROR]: GLFW error during init: [0x10007]WGL: The driver does not appear to support OpenGL',
  '[05:06:33] [Render thread/WARN]: Failed to create window: ',
  'fyk$a: GLFW error 65544: WGL: Failed to retrieve pixel format attributes: Операция успешно завершена. ',
  'java.lang.IllegalStateException: GLFW error 65542: WGL: The driver does not appear to support OpenGL',
  'GLFW error 65543: WGL: Failed to create OpenGL context',
  'GLFW error 65544: GLX: Failed to create context: GLXBadFBConfig',
];

const HARMLESS = [
  'WGL: Failed to create OpenGL context',
  '[05:06:16] [Render thread/INFO]: Backend library: LWJGL version 3.3.3+5',
  '[05:06:14] [Render thread/WARN]: Failed retrieving info for group graphics',
  'java.lang.IllegalStateException: Unexpected registry type 3',
  '[05:06:15] [Render thread/ERROR]: Failed to fetch user properties',
  'com.mojang.authlib.exceptions.MinecraftClientHttpException: Status: 401',
  "[12:00:00] [Client thread/ERROR]: Couldn't set pixel format",
  'org.lwjgl.LWJGLException: Pixel format not accelerated',
  'GLFW error 65544: Win32: Failed to open clipboard',
];

describe('window signs', () => {
  it('the log of the live case is a window failure, with the tail Windows localized', () => {
    expect(liveLog).toContain('Операция успешно завершена.');
    expect(isWindowFailure(liveLog)).toBe(true);
  });

  it.each(FAILURES)('a failed window: %s', (line) => {
    expect(isWindowFailure(line)).toBe(true);
  });

  it.each(HARMLESS)('not a failed window: %s', (line) => {
    expect(isWindowFailure(line)).toBe(false);
  });

  it.each(FAILURES)('the crash analysis calls the same line graphics: %s', (line) => {
    const verdict = analyzeCrash({
      exit: { code: null, signal: 'SIGTERM' },
      stoppedByUser: false,
      logLines: [line],
      crashReport: null,
      jvmReport: null,
      memoryMb: 4096,
      totalMemoryBytes: 16 * 1024 ** 3,
      javaMajor: 21,
      modFiles: [],
      platform: 'win32',
    });
    expect(verdict.cause.code).toBe('graphics');
  });

  it('the sound engine starts only in an open window', () => {
    expect(isWindowReady('[Render thread/INFO]: Sound engine started')).toBe(true);
    expect(isWindowReady(liveLog)).toBe(false);
  });

  it.each([
    '[Render thread/INFO]: Reloading ResourceManager: vanilla',
    '[Render thread/INFO]: OpenAL initialized on device OpenAL Soft on Speakers',
    '[Client thread/INFO]: Created: 2048x2048 textures-atlas',
    '[Render thread/INFO]: Created: 1024x512x4 minecraft:textures/atlas/blocks.png-atlas',
  ])('a window that is there: %s', (line) => {
    expect(isWindowReady(line)).toBe(true);
  });

  it.each([
    '[Render thread/INFO]: Backend library: LWJGL version 3.3.3+5',
    '[Client thread/INFO]: LWJGL Version: 2.9.4',
    '[Render thread/INFO]: Setting user: Player',
  ])('not yet a window: %s', (line) => {
    expect(isWindowReady(line)).toBe(false);
  });

  it.each(HEALTHY)('the real log of a healthy launch has no failed window: %s', (name) => {
    for (const line of healthy(name).split('\n')) {
      expect(isWindowFailure(line), line).toBe(false);
    }
  });
});

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
}

function watched(): { child: FakeChild; handlers: GameProcessHandlers } {
  const child = new FakeChild();
  const handlers: GameProcessHandlers = {
    onOutput: vi.fn<() => void>(),
    onWindowReady: vi.fn<() => void>(),
    onWindowFailed: vi.fn<() => void>(),
    onConnecting: vi.fn<GameProcessHandlers['onConnecting']>(),
    onExit: vi.fn<GameProcessHandlers['onExit']>(),
    onError: vi.fn<GameProcessHandlers['onError']>(),
  };
  const log = { attach: () => undefined } as unknown as GameLogWriter;
  watchGameProcess(
    child as unknown as ChildProcess,
    { log, crashReportsDir: '/nowhere', startedAt: 0 },
    handlers,
  );
  return { child, handlers };
}

function say(stream: PassThrough, text: string): void {
  stream.emit('data', Buffer.from(text));
}

function feed(stream: PassThrough, text: string, size: number): void {
  const bytes = Buffer.from(text);
  for (let start = 0; start < bytes.length; start += size) {
    stream.emit('data', bytes.subarray(start, start + size));
  }
}

describe('watchGameProcess: real logs of healthy launches', () => {
  it('there are logs of a plain game, of Fabric and of an old version', () => {
    expect(HEALTHY).toEqual([
      'fabric-1.20-lwjgl-3.3.2.txt',
      'optifine-1.12.2.txt',
      'vanilla-lwjgl-3.2.2.txt',
    ]);
  });

  it.each(HEALTHY)('%s in 64-byte pieces: the window is found once, no failure', (name) => {
    const { child, handlers } = watched();
    feed(child.stdout, healthy(name), 64);
    expect(handlers.onWindowReady).toHaveBeenCalledOnce();
    expect(handlers.onWindowFailed).not.toHaveBeenCalled();
  });
});

describe('watchGameProcess: the game window', () => {
  it('a window that opens after a failure line is still reported, so the stop can be called off', () => {
    const { child, handlers } = watched();
    say(child.stdout, 'GLFW error 65543: WGL: Failed to create OpenGL context\n');
    expect(handlers.onWindowFailed).toHaveBeenCalledOnce();
    say(child.stdout, '[Render thread/INFO]: Reloading ResourceManager: vanilla\n');
    expect(handlers.onWindowReady).toHaveBeenCalledOnce();
    say(child.stdout, 'GLFW error 65543: WGL: Failed to create OpenGL context\n');
    expect(handlers.onWindowFailed).toHaveBeenCalledOnce();
  });

  it('a failure and a window in one piece of output count as a window', () => {
    const { child, handlers } = watched();
    say(
      child.stdout,
      'GLFW error 65543: WGL: Failed to create OpenGL context\nReloading ResourceManager: vanilla\n',
    );
    expect(handlers.onWindowReady).toHaveBeenCalledOnce();
    expect(handlers.onWindowFailed).not.toHaveBeenCalled();
  });

  it('the live log split across chunks is reported as a failed window once', () => {
    const { child, handlers } = watched();
    const middle = liveLog.indexOf('create window');
    say(child.stdout, liveLog.slice(0, middle));
    expect(handlers.onWindowFailed).not.toHaveBeenCalled();
    say(child.stdout, liveLog.slice(middle));
    say(child.stderr, 'GLFW error 65543: WGL: Failed to create OpenGL context\n');
    expect(handlers.onWindowFailed).toHaveBeenCalledOnce();
    expect(handlers.onWindowReady).not.toHaveBeenCalled();
    expect(handlers.onOutput).toHaveBeenCalledTimes(3);
  });

  it('a GLFW error after the window opened is not a failed window', () => {
    const { child, handlers } = watched();
    say(child.stdout, '[Render thread/INFO]: Reloading ResourceManager: vanilla\n');
    say(child.stdout, 'GLFW error 65544: WGL: Failed to make context current\n');
    expect(handlers.onWindowReady).toHaveBeenCalledOnce();
    expect(handlers.onWindowFailed).not.toHaveBeenCalled();
  });

  it('connecting to a server means the window is open', () => {
    const { child, handlers } = watched();
    say(child.stdout, '[Render thread/INFO]: Connecting to play.example.ru, 25565\n');
    expect(handlers.onWindowReady).toHaveBeenCalledOnce();
    expect(handlers.onConnecting).toHaveBeenCalledWith({ host: 'play.example.ru', port: 25565 });
  });
});
