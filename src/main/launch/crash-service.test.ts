import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrashAnalysis, CrashEvent } from '@shared/crash';
import type {
  GameSession,
  LaunchEvent,
  LaunchPhase,
  LaunchRequest,
  LaunchService,
  LaunchState,
} from '@shared/launch';
import { createCrashService, type GameCrashService } from './crash-service';
import { readInstanceOverrides } from './instance-overrides';
import type { ClientModRun } from './skins/client-mod-blocks';

const GIB = 1024 ** 3;
const EVENT_TIME = Date.parse('2026-10-03T18:44:21Z');
const NOW = Math.floor(Date.now() / 1000) * 1000 - 10_000;

const session: GameSession = {
  pid: 4242,
  instance: 'server-12',
  nick: 'Frostbyte',
  minecraft: '1.21.11',
  loader: 'vanilla',
  memoryMb: 3072,
  join: null,
  skins: null,
  startedAt: new Date(NOW).toISOString(),
};

function log4j(thread: string, level: string, message: string, throwable?: string): string {
  const error =
    throwable === undefined ? '' : `<log4j:Throwable><![CDATA[${throwable}]]></log4j:Throwable>`;
  return `<log4j:Event logger="ewb" timestamp="${String(EVENT_TIME)}" level="${level}" thread="${thread}"><log4j:Message><![CDATA[${message}]]></log4j:Message>${error}</log4j:Event>\n`;
}

const idleSnapshot: LaunchState = {
  seq: 1,
  phase: 'running',
  operationId: 1,
  target: null,
  progress: null,
  session: null,
  skins: null,
  windowReady: true,
  windowSlow: false,
  windowDialog: false,
  lastError: null,
  lastExit: null,
  lastCrash: null,
};

class FakeLaunch implements LaunchService {
  phase: LaunchPhase = 'running';
  session: GameSession = session;
  private readonly listeners = new Set<(event: LaunchEvent) => void>();
  request: LaunchRequest | null = null;
  holding = false;
  prepare = vi.fn();
  launch = vi.fn(() => Promise.resolve({ ok: true as const, value: session }));
  cancel = vi.fn();
  kill = vi.fn();
  keepWaiting = vi.fn();
  setJoinServer = vi.fn();
  answerMods = vi.fn();
  logTail = vi.fn();

  clientMod: ClientModRun | null = null;
  blockClientMod = vi.fn<(run: ClientModRun) => Promise<void>>(() => Promise.resolve());

  lastLaunchRequest(): LaunchRequest | null {
    return this.request;
  }

  holds: Promise<unknown>[] = [];

  clientModRunOf(): ClientModRun | null {
    return this.clientMod;
  }

  holdLaunchesUntil(check: Promise<unknown>): void {
    this.holds.push(check);
  }

  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    this.holding = true;
    try {
      return await action();
    } finally {
      this.holding = false;
    }
  }

  state(): ReturnType<LaunchService['state']> {
    return Promise.resolve({
      ok: true,
      value: {
        seq: 1,
        phase: this.phase,
        operationId: 1,
        target: null,
        progress: null,
        session: this.session,
        skins: null,
        windowReady: true,
        windowSlow: false,
        windowDialog: false,
        lastError: null,
        lastExit: null,
        lastCrash: null,
      },
    });
  }

  onEvent(listener: (event: LaunchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitGame(event: Extract<LaunchEvent, { kind: 'game' }>['event']): void {
    for (const listener of this.listeners) {
      listener({ kind: 'game', event, state: idleSnapshot });
    }
  }
}

let root: string;
let instance: string;
let launch: FakeLaunch;
let service: GameCrashService;
let events: CrashEvent[];
let virtualMachine: () => Promise<boolean | null>;

async function writeGameLog(body: string): Promise<void> {
  await mkdir(join(instance, 'logs'), { recursive: true });
  const note = `[MC Monitor] minecraft=1.21.11 version=1.21.11 loader=vanilla java=${join(root, 'runtime', 'java-runtime-delta', 'bin', 'java')} memory=3072MB join=none\n`;
  await writeFile(join(instance, 'logs', 'mcmonitor-launch.log'), note + body);
}

async function play(
  exit: { code: number | null; signal: string | null },
  crashed: boolean,
): Promise<CrashAnalysis> {
  launch.emitGame({ type: 'started', pid: session.pid });
  await Promise.resolve();
  if (crashed) {
    launch.emitGame({ type: 'crash', code: exit.code, reportPath: null });
  }
  launch.emitGame({ type: 'exit', ...exit });
  await service.idle();
  const last = await service.last();
  if (!last.ok || last.value === null) {
    throw new Error('нет анализа');
  }
  return last.value;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-crash-'));
  instance = join(root, 'instances', 'server-12');
  await mkdir(join(instance, 'mods'), { recursive: true });
  launch = new FakeLaunch();
  events = [];
  virtualMachine = (): Promise<null> => Promise.resolve(null);
  service = createCrashService({
    root,
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.22631',
    totalMemoryBytes: 16 * GIB,
    launch,
    launcher: { name: 'MC Monitor', version: '0.1.0' },
    userName: 'vasya',
    homeDir: '/Users/vasya',
    openPath: vi.fn(() => Promise.resolve('')),
    virtualMachine: () => virtualMachine(),
    now: () => NOW,
    settle: { intervalMs: 1, timeoutMs: 20 },
  });
  service.onEvent((event) => events.push(event));
});

afterEach(async () => {
  service.dispose();
  await rm(root, { recursive: true, force: true });
});

describe('crash service', () => {
  it('parses the log4j log after a crash: out of heap memory, Java from path, event', async () => {
    await writeGameLog(
      log4j('Render thread', 'INFO', 'Setting user: Frostbyte') +
        log4j('Render thread', 'INFO', 'Connecting to 192.168.1.20, 25565') +
        log4j(
          'Render thread',
          'ERROR',
          'Unreported exception thrown!',
          'java.lang.OutOfMemoryError: Java heap space\n\tat net.minecraft.client.Minecraft.run(Minecraft.java:900)',
        ),
    );
    const analysis = await play({ code: 1, signal: null }, true);
    expect(analysis).toMatchObject({
      instance: 'server-12',
      minecraft: '1.21.11',
      memoryMb: 3072,
      totalMemoryMb: 16384,
      javaMajor: 21,
      cause: { code: 'out-of-memory', memoryMb: 3072 },
      rule: 'java-heap',
      evidence: 'java.lang.OutOfMemoryError: Java heap space',
      autoFixable: true,
      files: { log: true, crashReport: false, jvmReport: false },
    });
    expect(analysis.fixes[0]).toEqual({ type: 'set-memory', mb: 6144 });
    expect(events).toEqual([{ kind: 'analyzed', analysis }]);
  });

  it('a window that did not open and exit code 0: graphics, the virtual machine advice first', async () => {
    virtualMachine = (): Promise<boolean> => Promise.resolve(true);
    await writeGameLog(
      log4j(
        'Render thread',
        'WARN',
        'Failed to create window: ',
        'com.mojang.blaze3d.platform.Window$WindowInitFailed: GLFW error 65544: WGL: Failed to retrieve pixel format attributes',
      ),
    );
    const analysis = await play({ code: 0, signal: null }, false);
    expect(analysis.cause).toEqual({ code: 'graphics', problem: 'pixel-format' });
    expect(analysis.fixes[0]).toEqual({ type: 'advice', advice: 'vm-graphics' });
  });

  it('the live log of a game stopped by the launcher: graphics with the virtual machine advice', async () => {
    virtualMachine = (): Promise<boolean> => Promise.resolve(true);
    await writeGameLog(
      await readFile(
        join(import.meta.dirname, 'fixtures', 'crash', 'graphics-pixel-attributes.txt'),
        'utf8',
      ),
    );
    const analysis = await play({ code: null, signal: 'SIGTERM' }, true);
    expect(analysis.cause).toEqual({ code: 'graphics', problem: 'pixel-format' });
    expect(analysis.evidence).toContain('GLFW error 65544');
    expect(analysis.fixes[0]).toEqual({ type: 'advice', advice: 'vm-graphics' });
  });

  it('a virtual machine reading that fails leaves the advice last among the advice', async () => {
    virtualMachine = (): Promise<never> => Promise.reject(new Error('device'));
    await writeGameLog(
      log4j('Render thread', 'ERROR', 'GLFW error 65543: WGL: Failed to create OpenGL context'),
    );
    const analysis = await play({ code: 1, signal: null }, true);
    const advice = analysis.fixes.flatMap((fix) => (fix.type === 'advice' ? [fix.advice] : []));
    expect(advice).toEqual(['update-driver', 'discrete-gpu', 'vm-graphics']);
  });

  it('fix with relaunch: setting is written under lock, then the same launch', async () => {
    launch.request = {
      target: { kind: 'server', serverId: 12, minecraft: '1.21.11', address: 'play.example.ru' },
      account: { kind: 'nick', nick: 'Frostbyte' },
    };
    await writeGameLog(
      log4j('Render thread', 'ERROR', 'boom', 'java.lang.OutOfMemoryError: Java heap space'),
    );
    const analysis = await play({ code: 1, signal: null }, true);
    launch.phase = 'idle';
    const applied = await service.apply({ analysisId: analysis.id, fix: 0, relaunch: true });
    expect(applied).toEqual({
      ok: true,
      value: { fix: { type: 'set-memory', mb: 6144 }, report: null, relaunched: true },
    });
    expect(launch.launch).toHaveBeenCalledWith(launch.request);
    expect(launch.holding).toBe(false);
    const report = await service.apply({ analysisId: analysis.id, fix: 3, relaunch: true });
    expect(report.ok && report.value.relaunched).toBeUndefined();
  });

  it('nickname is redacted from the launch report, without the Setting user line in the log', async () => {
    launch.session = { ...session, nick: 'Zarya_77' };
    await writeGameLog(
      log4j('Render thread', 'INFO', 'Player Zarya_77 joined') +
        log4j('Render thread', 'ERROR', 'boom', 'java.lang.OutOfMemoryError: Java heap space'),
    );
    const analysis = await play({ code: 1, signal: null }, true);
    const report = await service.report(analysis.id);
    expect(JSON.stringify(report)).not.toContain('Zarya_77');
  });

  it('the exit event with byUser decides whether the player closed it', async () => {
    await writeGameLog(log4j('Render thread', 'INFO', 'Stopping!'));
    launch.emitGame({ type: 'started', pid: session.pid, session });
    launch.emitGame({ type: 'exit', code: 1, signal: null, byUser: true });
    await service.idle();
    const last = await service.last();
    expect(last.ok && last.value?.cause).toEqual({ code: 'closed' });
  });

  it('a modded log whose join line is past 64 KB and past the tail still gives the join cause', async () => {
    const mods = log4j('main', 'INFO', 'Loading mod example_mod 1.0.0').repeat(1500);
    const noise = log4j('Render thread', 'INFO', 'Created: 1024x1024x4 atlas').repeat(500);
    await writeGameLog(
      mods +
        log4j('Render thread', 'INFO', 'Connecting to play.example.net, 25565') +
        log4j('Render thread', 'INFO', 'Reloading ResourceManager: Default') +
        noise +
        '---- Minecraft Crash Report ----\njava.lang.NullPointerException: Tesselating block in world\n',
    );
    const analysis = await play({ code: -1, signal: null }, true);
    expect(analysis.cause).toEqual({ code: 'join-before-load' });
  });

  it('a game stopped over its own error dialog is analyzed, not taken as closed', async () => {
    await writeGameLog(log4j('Render thread', 'INFO', 'Backend library: LWJGL version 3.3.3+5'));
    launch.emitGame({ type: 'started', pid: session.pid, session });
    launch.emitGame({
      type: 'exit',
      code: null,
      signal: 'SIGTERM',
      byUser: false,
      gameDialog: true,
    });
    await service.idle();
    const last = await service.last();
    expect(last.ok && last.value?.cause).toEqual({ code: 'graphics', problem: 'context' });
  });

  it('parsing fails — the player still gets "could not determine the cause"', async () => {
    launch.emitGame({
      type: 'started',
      pid: session.pid,
      session: { ...session, instance: '../escape' },
    });
    launch.emitGame({ type: 'exit', code: 1, signal: null });
    await service.idle();
    const last = await service.last();
    expect(last.ok && last.value?.cause).toEqual({ code: 'unknown' });
    expect(events).toHaveLength(1);
  });

  it('finds the crash report and hs_err in the instance folder', async () => {
    await writeGameLog('');
    await mkdir(join(instance, 'crash-reports'), { recursive: true });
    await writeFile(
      join(instance, 'crash-reports', 'crash-2026-10-03_21.44.21-client.txt'),
      '---- Minecraft Crash Report ----\nDescription: Initializing game\n\norg.lwjgl.LWJGLException: Pixel format not accelerated\n',
    );
    await writeFile(
      join(instance, 'hs_err_pid4242.log'),
      '# There is insufficient memory for the Java Runtime Environment to continue.\n',
    );
    const analysis = await play({ code: 1, signal: null }, true);
    expect(analysis.files).toEqual({ log: true, crashReport: true, jvmReport: true });
    expect(analysis.cause.code).toBe('system-memory');
  });

  it('fix is taken from the analysis by number; refused while the game is running', async () => {
    await writeGameLog(
      log4j('Render thread', 'ERROR', 'boom', 'java.lang.OutOfMemoryError: Java heap space'),
    );
    const analysis = await play({ code: 1, signal: null }, true);
    expect(await service.apply({ analysisId: analysis.id, fix: 0 })).toEqual({
      ok: false,
      error: { code: 'game-running' },
    });
    launch.phase = 'idle';
    const applied = await service.apply({ analysisId: analysis.id, fix: 0 });
    expect(applied).toEqual({
      ok: true,
      value: { fix: { type: 'set-memory', mb: 6144 }, report: null },
    });
    expect(await readInstanceOverrides(instance)).toEqual({ memoryMb: 6144 });
    expect(await service.apply({ analysisId: analysis.id, fix: 30 })).toEqual({
      ok: false,
      error: { code: 'fix-not-available' },
    });
    expect(await service.apply({ analysisId: 'deadbeef-0000', fix: 0 })).toEqual({
      ok: false,
      error: { code: 'analysis-not-found' },
    });
  });

  it('report: file in the data folder, without nickname, IP, paths or tokens', async () => {
    await writeFile(join(instance, 'mods', 'sodium-0.6.0.jar'), 'jar');
    await writeGameLog(
      log4j('Render thread', 'INFO', 'Setting user: Frostbyte') +
        log4j('Render thread', 'INFO', 'Connecting to 192.168.1.20, 25565') +
        log4j('Render thread', 'INFO', 'Loading /Users/vasya/Desktop/pack.zip') +
        log4j(
          'Render thread',
          'INFO',
          'Session ID is token:abc123:6a1f0e2d-9c8b-4a7f-b6e5-d4c3b2a1f0e9',
        ) +
        log4j('Render thread', 'ERROR', 'boom', 'java.lang.OutOfMemoryError: Java heap space'),
    );
    const analysis = await play({ code: 1, signal: null }, true);
    const preview = await service.report(analysis.id);
    if (!preview.ok) {
      throw new Error('нет отчёта');
    }
    expect(preview.value.path).toBe(join(root, 'reports', `crash-${analysis.id}.json`));
    const text = await readFile(preview.value.path, 'utf8');
    expect(text).not.toMatch(/Frostbyte|192\.168|vasya|abc123|6a1f0e2d/);
    expect(JSON.parse(text)).toEqual(preview.value.report);
    expect(preview.value.report).toMatchObject({
      format: 1,
      created_at: new Date(NOW).toISOString(),
      game: {
        instance_kind: 'server',
        server_id: 12,
        minecraft: '1.21.11',
        loader: 'vanilla',
        java_major: 21,
        memory_mb: 3072,
      },
      cause: { code: 'out-of-memory', rule: 'java-heap' },
      mods: ['sodium-0.6.0.jar'],
    });
    expect(preview.value.report.log_tail).toContain(
      '[21:44:21] [Render thread/INFO]: Setting user: <nick>',
    );
    expect(await readdir(join(root, 'reports'))).toHaveLength(1);
  });

  it('disabling a mod from the analysis', async () => {
    launch.session = { ...session, loader: 'fabric' };
    await writeFile(join(instance, 'mods', 'sodium-fabric-0.5.3+mc1.20.1.jar'), 'jar');
    await writeGameLog(
      log4j(
        'main',
        'ERROR',
        'Incompatible mods found!',
        "\t - Mod 'Sodium' (sodium) 0.5.3+mc1.20.1 requires version 1.20.1 of 'Minecraft' (minecraft), but only the wrong version is present: 1.21.1!",
      ),
    );
    const analysis = await play({ code: 1, signal: null }, true);
    expect(analysis.fixes[0]).toEqual({
      type: 'disable-mod',
      file: 'sodium-fabric-0.5.3+mc1.20.1.jar',
    });
    launch.phase = 'idle';
    expect((await service.apply({ analysisId: analysis.id, fix: 0 })).ok).toBe(true);
    expect(await readdir(join(instance, 'mods'))).toEqual([
      'sodium-fabric-0.5.3+mc1.20.1.jar.disabled',
    ]);
  });
});

describe('a crash at start caused by the MC Monitor client mod', () => {
  const run = { minecraft: '1.21.11', sha256: 'd'.repeat(64) };
  const loading = log4j(
    'main',
    'INFO',
    'Loading 3 mods:\n\t- fabricloader 0.19.5\n\t- mcmonitor 0.1.0\n\t- minecraft 1.21.11',
  );
  const ourMixin = log4j(
    'Render thread',
    'ERROR',
    'Unreported exception thrown!',
    'org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: An unexpected critical error was encountered\n\tat ru.mcmon.plugin.client.fabric.mixin.ConnectScreenMixin.handler(ConnectScreenMixin.java:31)\nCaused by: mixin mcmonitor.mixins.json:ConnectScreenMixin failed',
  );
  const otherMod = log4j(
    'Render thread',
    'ERROR',
    'Unreported exception thrown!',
    'java.lang.NullPointerException\n\tat me.jellysquid.mods.sodium.client.render.SodiumWorldRenderer.render(SodiumWorldRenderer.java:120)',
  );

  beforeEach(() => {
    launch.clientMod = run;
  });

  it('blocks the jar for this version when the mod is named before the world', async () => {
    await writeGameLog(loading + ourMixin);
    await play({ code: 1, signal: null }, true);
    expect(launch.blockClientMod).toHaveBeenCalledWith(run);
  });

  it('a crash that names another mod leaves the client mod', async () => {
    await writeGameLog(loading + otherMod);
    await play({ code: 1, signal: null }, true);
    expect(launch.blockClientMod).not.toHaveBeenCalled();
  });

  it('a crash in the world is not a crash at start', async () => {
    await writeGameLog(loading + log4j('Render thread', 'INFO', '[CHAT] Welcome!') + ourMixin);
    await play({ code: 1, signal: null }, true);
    expect(launch.blockClientMod).not.toHaveBeenCalled();
  });

  it('a normal exit, a game the player closed or a game without the mod blocks nothing', async () => {
    await writeGameLog(loading + ourMixin);
    await play({ code: 0, signal: null }, false);
    launch.emitGame({ type: 'started', pid: session.pid });
    await Promise.resolve();
    launch.emitGame({ type: 'exit', code: 1, signal: null, byUser: true });
    await service.idle();
    expect(await service.last()).toMatchObject({
      ok: true,
      value: { cause: { code: 'closed' } },
    });
    launch.clientMod = null;
    await play({ code: 1, signal: null }, true);
    expect(launch.blockClientMod).not.toHaveBeenCalled();
  });

  it('holds launches until the crash check is over', async () => {
    await writeGameLog(loading + ourMixin);
    await play({ code: 1, signal: null }, true);
    expect(launch.holds).toHaveLength(1);
    await Promise.all(launch.holds);
    expect(launch.blockClientMod).toHaveBeenCalledOnce();
  });
});
