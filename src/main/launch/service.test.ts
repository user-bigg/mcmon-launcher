import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { LaunchOption, ResolvedVersion } from '@xmcl/core';
import type { InstallRuntime } from '@xmcl/installer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayCheckQuery } from '@shared/account';
import type { LaunchEvent, LaunchRequest, LaunchTarget } from '@shared/launch';
import { parseServerAddress } from '@shared/server-address';
import type { LaunchTelemetryEvent } from '@shared/telemetry';
import type { TrackedRuntime } from './download';
import type { GameProcessHandlers } from './game-process';
import { GAME_MARK_FILE, markGameStarted } from './game-mark';
import { writeInstanceOverrides } from './instance-overrides';
import { InstanceStore } from './instances';
import { gameLayout } from './layout';
import type { CheckedPlay } from '../account/nick';
import type { PlayChecker } from './play-check';
import { catalogServerList } from './server-list';
import {
  createLaunchService,
  DIALOG_QUIET_MS,
  type GameLaunchService,
  type LaunchDependencies,
} from './service';
import type { VersionEntry } from './version-manifest';
import { WINDOW_FAILURE_GRACE_MS, WINDOW_WAIT_MS } from './window-wait';

class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn((): boolean => {
    this.signalCode = 'SIGTERM';
    return true;
  });
}

interface Gate {
  reached: Promise<void>;
  wait: () => Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open = (): void => undefined;
  let arrive = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return {
    reached,
    wait: (): Promise<void> => {
      arrive();
      return opened;
    },
    open,
  };
}

const GATED = [
  'findVersion',
  'installJava',
  'installGameFiles',
  'verifyInstallation',
  'launchGame',
] as const;
type GatedStep = (typeof GATED)[number];

function entryFor(id: string, releaseTime = '2026-09-01T00:00:00+00:00'): VersionEntry {
  return {
    id,
    type: 'release',
    url: `https://piston-meta.mojang.com/v1/packages/${'a'.repeat(40)}/${id}.json`,
    sha1: 'a'.repeat(40),
    releaseTime,
  };
}

function versionFor(id: string): ResolvedVersion {
  return {
    id,
    minecraftVersion: id,
    libraries: [],
    arguments: { game: [], jvm: [] },
  } as unknown as ResolvedVersion;
}

function fakeTransfer(): TrackedRuntime {
  return {
    runtime: {} as InstallRuntime,
    downloadedBytes: () => 0,
    execute: () => Promise.resolve(),
    onInstallEvent: () => undefined,
  };
}

let root: string;
let child: FakeChild;
let handlers: GameProcessHandlers | null;
let events: LaunchEvent[];
let telemetry: LaunchTelemetryEvent[];
let launched: LaunchOption[];
let gates: Partial<Record<GatedStep, Gate>>;
let deps: Partial<LaunchDependencies>;
let entry: VersionEntry;
let stopModes: string[];

async function passGate(step: GatedStep): Promise<void> {
  await gates[step]?.wait();
}

function makeService(
  overrides: Partial<LaunchDependencies> = {},
  instances?: InstanceStore,
  playCheck?: PlayChecker,
  launcherOnly?: (serverId: number) => boolean,
): GameLaunchService {
  const service = createLaunchService({
    root,
    platform: 'darwin',
    arch: 'arm64',
    totalMemoryBytes: 16 * 1024 ** 3,
    fetch: () => Promise.resolve({}),
    ...(instances === undefined ? {} : { instances }),
    ...(playCheck === undefined ? {} : { playCheck }),
    ...(launcherOnly === undefined ? {} : { launcherOnly }),
    telemetry: (event) => {
      telemetry.push(event);
    },
    dependencies: { ...deps, ...overrides },
  });
  service.onEvent((event) => {
    events.push(event);
  });
  return service;
}

const plain: LaunchTarget = {
  kind: 'server',
  serverId: 1,
  minecraft: '26.3',
  address: 'play.example.ru',
};
const account = { kind: 'nick', nick: 'Steve' } as const;
const request: LaunchRequest = { target: plain, account };
const EXAMPLE = parseServerAddress('play.example.ru') ?? { host: '', port: null };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-launch-service-'));
  child = new FakeChild();
  stopModes = [];
  handlers = null;
  events = [];
  telemetry = [];
  launched = [];
  gates = {};
  entry = entryFor('26.3');
  deps = {
    findVersion: async (): Promise<VersionEntry> => {
      await passGate('findVersion');
      return entry;
    },
    installVersionJson: (_folder, item): Promise<ResolvedVersion> =>
      Promise.resolve(versionFor(item.id)),
    installJava: async (): Promise<string> => {
      await passGate('installJava');
      return '/java/bin/java';
    },
    readVersionLock: (): Promise<number | undefined> => Promise.resolve(undefined),
    writeVersionLock: (): Promise<boolean> => Promise.resolve(true),
    removeVersionLock: (): Promise<void> => Promise.resolve(),
    installAssetIndex: (): Promise<void> => Promise.resolve(),
    installGameFiles: async (): Promise<void> => {
      await passGate('installGameFiles');
    },
    verifyInstallation: async (
      _version,
      _folder,
      _transfer,
      _timestamp,
      _signal,
      onFile,
    ): Promise<void> => {
      await passGate('verifyInstallation');
      onFile?.();
    },
    countVerifiedFiles: (): Promise<number> => Promise.resolve(1),
    createTransfer: (): TrackedRuntime => fakeTransfer(),
    launchGame: async (options): Promise<ChildProcess> => {
      await passGate('launchGame');
      launched.push(options);
      return child as unknown as ChildProcess;
    },
    watchGame: (_child, _options, watch): void => {
      handlers = watch;
    },
    killGame: (target, mode): void => {
      stopModes.push(mode);
      target.kill();
    },
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

function phases(): string[] {
  return events.flatMap((event) => (event.kind === 'phase' ? [event.phase] : []));
}

describe('GameLaunchService', () => {
  it('launch: preparing → running → idle, session, window-ready and exit', async () => {
    const service = makeService();
    const result = await service.launch(request);
    expect(result).toMatchObject({ ok: true, value: { pid: 4242, minecraft: '26.3' } });
    expect(await service.state()).toMatchObject({ value: { phase: 'running', operationId: 1 } });
    expect(telemetry.map((event) => event.type)).toEqual(['launch.started']);

    handlers?.onWindowReady();
    const ready = await service.state();
    expect(ready.ok && ready.value.windowReady).toBe(true);
    expect(await service.cancel()).toEqual({ ok: false, error: { code: 'running' } });

    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    const state = await service.state();
    expect(state.ok && state.value).toMatchObject({
      phase: 'idle',
      session: null,
      lastExit: { code: 0, signal: null },
      lastCrash: null,
      lastError: null,
    });
    expect(state.ok && state.value.progress?.percent).toBe(100);
    expect(phases()).toEqual(['preparing', 'running', 'idle']);
    expect(telemetry.at(-1)).toMatchObject({ type: 'launch.finished', outcome: 'ok' });
  });

  it('new folder: the onboarding screen is disabled in options.txt before the game starts', async () => {
    const service = makeService();
    expect(await service.launch(request)).toMatchObject({ ok: true });
    const options = await readFile(join(root, 'instances', 'server-1', 'options.txt'), 'utf8');
    expect(options).toBe(
      'onboardAccessibility:false\nskipMultiplayerWarning:true\ntutorialStep:none\njoinedFirstServer:true\n',
    );
  });

  describe("the server in the game's own list", () => {
    const catalog: LaunchRequest = {
      target: { kind: 'server', serverId: 9, minecraft: '26.3', address: 'play.example.ru:25565' },
      account,
      name: 'Example',
    };

    const ENTERED = parseServerAddress('play.example.ru:25565') ?? EXAMPLE;

    function serversFile(folder: string): string {
      return join(root, 'instances', folder, 'servers.dat');
    }

    it('catalog server: written before the game starts, also with joining at once off', async () => {
      const service = makeService();
      expect(await service.launch({ ...catalog, joinServer: false })).toMatchObject({ ok: true });
      expect(launched[0]?.quickPlayMultiplayer).toBeUndefined();
      const list = await readFile(serversFile('server-9'));
      expect(list.equals(catalogServerList({ name: 'Example', address: ENTERED }))).toBe(true);
    });

    it('the list and quick play spell the address the same way, the port as entered', async () => {
      const service = makeService();
      await service.launch(catalog);
      expect(launched[0]?.quickPlayMultiplayer).toBe('play.example.ru:25565');
      expect((await readFile(serversFile('server-9'))).includes('play.example.ru:25565')).toBe(
        true,
      );
    });

    it('a port the owner did not enter goes to the game neither in the list nor in quick play', async () => {
      const service = makeService();
      await service.launch({
        ...catalog,
        target: { ...catalog.target, address: 'play.example.ru' },
      });
      expect(launched[0]?.quickPlayMultiplayer).toBe('play.example.ru');
      expect((await readFile(serversFile('server-9'))).includes('25565')).toBe(false);
    });

    it('a launch without a name puts the address as the name', async () => {
      const service = makeService();
      await service.launch({ target: catalog.target, account });
      const list = await readFile(serversFile('server-9'));
      expect(
        list.equals(catalogServerList({ name: 'play.example.ru:25565', address: ENTERED })),
      ).toBe(true);
    });

    it('a launcher-only server is listed in the game like any other', async () => {
      await makeService().launch({ ...catalog, launcherOnly: true });
      expect(
        (await readFile(serversFile('server-9'))).equals(
          catalogServerList({ name: 'Example', address: ENTERED }),
        ),
      ).toBe(true);
    });

    it('a launcher-only server: the log tail shows no address', async () => {
      const service = makeService({
        watchGame: (_child, options, watch): void => {
          options.log.note('Connecting to play.example.ru, 25565');
          options.log.note('Connection refused: play.example.ru/203.0.113.7:25565');
          handlers = watch;
        },
      });
      await service.launch({ target: catalog.target, account, launcherOnly: true });
      handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
      await service.whenIdle();
      const log = await service.logTail(50);
      expect(JSON.stringify(log)).toContain('Connecting to <server>, 25565');
      expect(JSON.stringify(log)).not.toMatch(/example|203\.0\.113/);
      expect(service.lastLaunchRequest()).toMatchObject({ launcherOnly: true });
    });

    it('a game still running from the folder keeps its list', async () => {
      await mkdir(join(root, 'instances', 'server-9'), { recursive: true });
      await markGameStarted(join(root, 'instances', 'server-9'), process.pid, Date.now());
      const service = makeService();
      expect(await service.launch(catalog)).toMatchObject({ ok: true });
      await expect(stat(serversFile('server-9'))).rejects.toThrow();
    });

    it('the mark of the running game is removed when the game exits', async () => {
      const service = makeService();
      await service.launch(catalog);
      const mark = join(root, 'instances', 'server-9', GAME_MARK_FILE);
      expect(JSON.parse(await readFile(mark, 'utf8'))).toMatchObject({ pid: 4242 });
      handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
      await service.whenIdle();
      await vi.waitFor(async () => {
        await expect(stat(mark)).rejects.toThrow();
      });
    });
  });

  it('a second call while running returns busy', async () => {
    gates.installJava = gate();
    const service = makeService();
    const first = service.launch(request);
    await gates.installJava.reached;
    expect(await service.prepare(plain)).toEqual({ ok: false, error: { code: 'busy' } });
    expect(await service.launch(request)).toEqual({ ok: false, error: { code: 'busy' } });
    gates.installJava.open();
    expect((await first).ok).toBe(true);
  });

  it.each(GATED)('cancel at the %s step: cancelled, idle, no install.finished', async (step) => {
    const blocker = gate();
    gates[step] = blocker;
    const service = makeService();
    const pending = service.launch(request);
    await blocker.reached;
    expect(await service.cancel()).toEqual({ ok: true, value: null });
    blocker.open();
    expect(await pending).toEqual({ ok: false, error: { code: 'cancelled' } });
    const state = await service.state();
    expect(state.ok && state.value).toMatchObject({
      phase: 'idle',
      session: null,
      lastError: { error: { code: 'cancelled' }, source: 'operation' },
    });
    expect(telemetry.filter((event) => event.type === 'install.finished')).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      kind: 'failed',
      error: { code: 'cancelled' },
      source: 'operation',
    });
    if (step === 'launchGame') {
      expect(child.kill).toHaveBeenCalled();
      expect(handlers).toBeNull();
    }
  });

  it('cancelling before window-ready kills the game; without a game it is not-running', async () => {
    const service = makeService();
    expect(await service.cancel()).toEqual({ ok: false, error: { code: 'not-running' } });
    await service.launch(request);
    expect(await service.cancel()).toEqual({ ok: true, value: null });
    expect(child.kill).toHaveBeenCalledTimes(1);
    handlers?.onExit({ code: null, signal: 'SIGTERM', crashReportPath: null });
    await service.whenIdle();
    expect(telemetry.at(-1)).toMatchObject({ type: 'launch.finished', outcome: 'exit' });
    expect(await service.kill()).toEqual({ ok: false, error: { code: 'not-running' } });
  });

  it('a listener or telemetry sink throwing does not break the state', async () => {
    const service = makeService();
    service.onEvent(() => {
      throw new Error('listener');
    });
    const broken = createLaunchService({
      root,
      platform: 'darwin',
      arch: 'arm64',
      totalMemoryBytes: 16 * 1024 ** 3,
      fetch: () => Promise.resolve({}),
      telemetry: () => {
        throw new Error('telemetry');
      },
      dependencies: deps,
    });
    broken.onEvent(() => {
      throw new Error('listener');
    });
    for (const target of [service, broken]) {
      expect((await target.launch(request)).ok).toBe(true);
      handlers?.onWindowReady();
      handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
      await target.whenIdle();
      const state = await target.state();
      expect(state.ok && state.value.phase).toBe('idle');
      child = new FakeChild();
    }
  });

  it('crash after window-ready: crash, lastCrash, the connect step stays done', async () => {
    const service = makeService();
    await service.launch({
      target: { kind: 'server', serverId: 7, minecraft: '26.3', address: 'play.example.ru' },
      account,
    });
    handlers?.onWindowReady();
    handlers?.onExit({ code: 1, signal: null, crashReportPath: '/crash.txt' });
    await service.whenIdle();
    const state = await service.state();
    expect(state.ok && state.value.lastCrash).toMatchObject({ code: 1, reportPath: '/crash.txt' });
    const join = state.ok ? state.value.progress?.steps.find((step) => step.id === 'join') : null;
    expect(join?.status).toBe('done');
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'game',
        event: { type: 'crash', code: 1, reportPath: '/crash.txt' },
      }),
    );
    expect(telemetry.at(-1)).toMatchObject({ outcome: 'crash', server_id: 7 });
  });

  it('with the window open the connect step is done and stays done after a normal exit', async () => {
    const service = makeService();
    await service.launch({
      target: { kind: 'server', serverId: 7, minecraft: '26.3', address: 'play.example.ru' },
      account,
    });
    handlers?.onWindowReady();
    const open = await service.state();
    expect(open.ok && open.value.progress?.steps.find((step) => step.id === 'join')?.status).toBe(
      'done',
    );
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    const state = await service.state();
    const join = state.ok ? state.value.progress?.steps.find((step) => step.id === 'join') : null;
    expect(join?.status).toBe('done');
    expect(state.ok && state.value.lastCrash).toBeNull();
  });

  it('exit before window-ready is a process error, game-start-failed', async () => {
    const service = makeService();
    await service.launch(request);
    handlers?.onError(new Error('boom'));
    handlers?.onExit({ code: 1, signal: null, crashReportPath: null });
    await service.whenIdle();
    const failures = events.filter((event) => event.kind === 'failed');
    expect(failures.map((event) => event.source)).toEqual(['process', 'process']);
    const state = await service.state();
    expect(state.ok && state.value.lastError).toMatchObject({
      error: { code: 'game-start-failed', message: 'exit code 1' },
      source: 'process',
    });
  });

  it('prepare drives progress to 100%: launch and connect are skipped', async () => {
    const service = makeService();
    const result = await service.prepare(plain);
    expect(result).toMatchObject({ ok: true, value: { minecraft: '26.3', loader: 'vanilla' } });
    const state = await service.state();
    expect(state.ok && state.value.progress?.percent).toBe(100);
    const statuses = state.ok ? state.value.progress?.steps.map((step) => step.status) : [];
    expect(statuses).toEqual(['done', 'done', 'skipped', 'done', 'skipped', 'skipped']);
    expect(phases()).toEqual(['preparing', 'idle']);
  });

  it('core verification error: the lock is removed, files are re-checked, and the launch is retried', async () => {
    const removeVersionLock = vi.fn(() => Promise.resolve());
    const timestamps: (number | undefined)[] = [];
    let attempts = 0;
    const service = makeService({
      removeVersionLock,
      readVersionLock: () => Promise.resolve(1000),
      verifyInstallation: (_version, _folder, _transfer, timestamp) => {
        timestamps.push(timestamp);
        return Promise.resolve();
      },
      launchGame: (options) => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(Object.assign(new Error('jar'), { error: 'CorruptedVersionJar' }));
        }
        launched.push(options);
        return Promise.resolve(child as unknown as ChildProcess);
      },
    });
    expect((await service.launch(request)).ok).toBe(true);
    expect(removeVersionLock).toHaveBeenCalledTimes(1);
    expect(timestamps).toEqual([1000, undefined]);
    expect(attempts).toBe(2);
  });

  it('JVM failed to start: a spawn error is game-start-failed, the log is closed', async () => {
    child.pid = undefined;
    const service = makeService({
      launchGame: () => {
        setImmediate(() => {
          child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
        });
        return Promise.resolve(child as unknown as ChildProcess);
      },
    });
    const result = await service.launch(request);
    expect(result).toEqual({
      ok: false,
      error: { code: 'game-start-failed', message: 'spawn ENOENT' },
    });
    expect(await service.state()).toMatchObject({ value: { phase: 'idle' } });
  });

  it('1.12.2 without a port: no SRV lookup, --server gets the standard port', async () => {
    entry = entryFor('1.12.2', '2017-09-18T08:39:46+00:00');
    const service = makeService();
    const result = await service.launch({
      target: { kind: 'server', serverId: 1, minecraft: '1.12.2', address: 'play.example.ru' },
      account,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { join: { mode: 'legacy', address: { host: 'play.example.ru', port: null } } },
    });
    expect(launched[0]?.server).toEqual({ ip: 'play.example.ru', port: 25565 });
  });

  it('1.12.2 with an entered port: --server and --port exactly as entered', async () => {
    entry = entryFor('1.12.2', '2017-09-18T08:39:46+00:00');
    const service = makeService();
    await service.launch({
      target: {
        kind: 'server',
        serverId: 1,
        minecraft: '1.12.2',
        address: 'play.example.ru:25570',
      },
      account,
    });
    expect(launched[0]?.server).toEqual({ ip: 'play.example.ru', port: 25570 });
  });

  it('1.19.4 reads SRV itself: no port goes to the game', async () => {
    entry = entryFor('1.19.4', '2023-03-14T12:56:18+00:00');
    const service = makeService();
    await service.launch({
      target: { kind: 'server', serverId: 1, minecraft: '1.19.4', address: 'play.example.ru' },
      account,
    });
    expect(launched[0]?.server).toEqual({ ip: 'play.example.ru' });
  });

  it('a version before 1.6 with a server is join-unsupported before downloading', async () => {
    entry = entryFor('1.5.2', '2013-04-25T15:45:00+00:00');
    const installJava = vi.fn(() => Promise.resolve('/java'));
    const service = makeService({ installJava });
    const result = await service.launch({
      target: { kind: 'server', serverId: 1, minecraft: '1.5.2', address: 'play.example.ru' },
      account,
    });
    expect(result).toEqual({ ok: false, error: { code: 'join-unsupported', minecraft: '1.5.2' } });
    expect(installJava).not.toHaveBeenCalled();
    expect(telemetry.at(-1)).toMatchObject({
      type: 'install.finished',
      outcome: 'error',
      error_code: 'join-unsupported',
    });
  });

  it('server: after installation the version and loader are written to the server folder', async () => {
    const file = join(root, 'instances', 'server-7', 'mcmonitor-instance.json');
    const target: LaunchTarget = {
      kind: 'server',
      serverId: 7,
      minecraft: '26.3',
      address: 'play.example.ru',
    };
    const failing = makeService({ installGameFiles: () => Promise.reject(new Error('disk')) });
    expect(await failing.prepare(target)).toMatchObject({ ok: false });
    await expect(readFile(file, 'utf8')).rejects.toThrow();
    expect(await makeService().prepare(target)).toMatchObject({ ok: true });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      installed: { minecraft: '26.3', loader: { kind: 'vanilla', version: null } },
    });
  });

  it('server: cancelling during file verification leaves the server folder absent', async () => {
    const blocker = gate();
    gates.verifyInstallation = blocker;
    const service = makeService();
    const pending = service.prepare({
      kind: 'server',
      serverId: 8,
      minecraft: '26.3',
      address: 'play.example.ru',
    });
    await blocker.reached;
    await service.cancel();
    blocker.open();
    expect(await pending).toEqual({ ok: false, error: { code: 'cancelled' } });
    await expect(stat(join(root, 'instances', 'server-8'))).rejects.toThrow();
  });

  it('version.json failed to download: the manifest is re-read from the network and the record is updated', async () => {
    const stale = entryFor('26.3');
    const fresh = { ...stale, sha1: 'b'.repeat(40) };
    const refreshes: (boolean | undefined)[] = [];
    const service = makeService({
      findVersion: (_id, _source, options) => {
        refreshes.push(options?.refresh);
        return Promise.resolve(options?.refresh === true ? fresh : stale);
      },
      installVersionJson: (_folder, item) =>
        item.sha1 === fresh.sha1
          ? Promise.resolve(versionFor(item.id))
          : Promise.reject(new Error('Cannot recover 1 install file(s): /g/26.3.json')),
    });
    expect((await service.prepare(plain)).ok).toBe(true);
    expect(refreshes).toEqual([undefined, true]);
  });

  it('the requested memory wins; without it the memory chosen for the server folder', async () => {
    const folder = join(root, 'instances', 'server-1');
    await mkdir(folder, { recursive: true });
    await writeInstanceOverrides(folder, { memoryMb: 6144 });
    const service = makeService();
    const chosen = await service.launch(request);
    expect(chosen.ok && chosen.value.memoryMb).toBe(6144);
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    const asked = await service.launch({ ...request, memoryMb: 2048 });
    expect(asked.ok && asked.value.memoryMb).toBe(2048);
  });

  it('the server folder stays busy from the first line of the launch until the game exits', async () => {
    const store = new InstanceStore({ layout: gameLayout(root), now: Date.now });
    gates.installJava = gate();
    const service = makeService({}, store);
    const launching = service.launch(request);
    expect(service.activeInstance()).toBe('server-1');
    await expect(store.removeServer('server-1')).rejects.toMatchObject({
      error: { code: 'server-in-use' },
    });
    gates.installJava.open();
    expect((await launching).ok).toBe(true);
    await expect(store.removeServer('server-1')).rejects.toMatchObject({
      error: { code: 'server-in-use' },
    });
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    expect(store.isInUse('server-1')).toBe(false);
    const exit = events.find((event) => event.kind === 'game' && event.event.type === 'exit');
    expect(exit).toMatchObject({ event: { byUser: false } });
    const started = events.find((event) => event.kind === 'game' && event.event.type === 'started');
    expect(started).toMatchObject({ event: { session: { instance: 'server-1' } } });
    expect(service.lastLaunchRequest()?.target).toMatchObject({ serverId: 1 });
  });

  it("'Join at once' off: no join and no nickname", async () => {
    const service = makeService();
    const result = await service.launch({ ...request, joinServer: false });
    expect(result.ok && result.value.join).toBeNull();
    expect(launched[0]?.quickPlayMultiplayer).toBeUndefined();
    expect(launched[0]?.server).toBeUndefined();
    expect(telemetry[0]).not.toHaveProperty('nick');
  });

  it('while holding the crash fix, a launch call returns busy', async () => {
    const service = makeService();
    let inside: Awaited<ReturnType<GameLaunchService['launch']>> | null = null;
    await service.exclusive(async () => {
      inside = await service.launch(request);
    });
    expect(inside).toEqual({ ok: false, error: { code: 'busy' } });
    expect((await service.launch(request)).ok).toBe(true);
  });

  it('a log tail read error does not crash the call', async () => {
    const service = makeService({ readLog: () => Promise.reject(new Error('EIO')) });
    expect(await service.logTail(10)).toEqual({ ok: true, value: [] });
    await service.launch(request);
    expect(await service.logTail(10)).toEqual({
      ok: false,
      error: { code: 'unknown', message: 'EIO' },
    });
  });

  it('every event carries a full snapshot with an increasing seq and the launch target', async () => {
    const service = makeService();
    const target: LaunchTarget = {
      kind: 'server',
      serverId: 7,
      minecraft: '26.3',
      address: 'play.example.ru',
    };
    await service.launch({ target, account });
    handlers?.onWindowReady();
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    const seqs = events.map((event) => event.state.seq);
    expect(seqs).toEqual(seqs.map((_value, index) => index + 1));
    expect(events.every((event) => event.state.target?.kind === 'server')).toBe(true);
    const started = events.find((event) => event.kind === 'game' && event.event.type === 'started');
    expect(started?.state).toMatchObject({ phase: 'running', session: { nick: 'Steve' } });
    const state = await service.state();
    expect(state.ok && state.value).toMatchObject({
      seq: events.length,
      phase: 'idle',
      target,
      lastExit: { code: 0 },
    });
  });

  it("'Close game' asks the game to close, cancelling before the window kills it; whenIdle waits for exit", async () => {
    const service = makeService();
    await service.whenIdle();
    await service.launch(request);
    handlers?.onWindowReady();
    const idle = vi.fn();
    void service.whenIdle().then(idle);
    expect(await service.kill()).toEqual({ ok: true, value: null });
    expect(stopModes).toEqual(['close']);
    expect((await service.state()).ok).toBe(true);
    expect(idle).not.toHaveBeenCalled();
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await vi.waitFor(() => {
      expect(idle).toHaveBeenCalledOnce();
    });
    await service.launch(request);
    await service.cancel();
    expect(stopModes).toEqual(['close', 'force']);
  });

  it('launch.started: nickname only on auto-join to a server', async () => {
    const service = makeService();
    await service.launch({ ...request, joinServer: false });
    expect(telemetry[0]).not.toHaveProperty('nick');
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    telemetry = [];
    await service.launch(request);
    expect(telemetry[0]).toMatchObject({ type: 'launch.started', server_id: 1, nick: 'Steve' });
  });

  it('launch.started carries the launch_id of the click, a relaunch request does not', async () => {
    const service = makeService();
    const launchId = '6f1c3b9e-1111-4222-8333-444455556666';
    await service.launch({ ...request, launchId });
    expect(telemetry[0]).toMatchObject({ type: 'launch.started', launch_id: launchId });
    expect(service.lastLaunchRequest()).not.toHaveProperty('launchId');
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    telemetry = [];
    await service.launch(request);
    expect(telemetry[0]).not.toHaveProperty('launch_id');
  });

  describe('a Microsoft account', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.bWluZWNyYWZ0LXRva2Vu.c2lnbmF0dXJl';
    const uuid = '0123456789abcdef0123456789abcdef';
    const microsoft = { kind: 'account', id: 'ms-1' } as const;

    function serviceFor(overrides: Partial<LaunchDependencies>): GameLaunchService {
      const service = createLaunchService({
        root,
        platform: 'darwin',
        arch: 'arm64',
        totalMemoryBytes: 16 * 1024 ** 3,
        fetch: () => Promise.resolve({}),
        telemetry: (event) => {
          telemetry.push(event);
        },
        resolvePlayer: () =>
          Promise.resolve({
            nick: 'Steve_MS',
            telemetry: 'microsoft',
            auth: { uuid, accessToken: token },
          }),
        dependencies: { ...deps, ...overrides },
      });
      service.onEvent((event) => {
        events.push(event);
      });
      return service;
    }

    it('starts the game as msa and keeps the token out of the log, events and results', async () => {
      const service = serviceFor({
        watchGame: (_child, options, watch): void => {
          options.log.note(`Session ID is ${token}`);
          handlers = watch;
        },
      });
      const result = await service.launch({ target: plain, account: microsoft });
      expect(launched[0]).toMatchObject({
        accessToken: token,
        userType: 'msa',
        gameProfile: { id: uuid, name: 'Steve_MS' },
      });
      handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
      await service.whenIdle();
      const log = await service.logTail(50);
      expect(JSON.stringify(log)).toContain('Session ID is <hidden>');
      expect(JSON.stringify([result, events, log, telemetry])).not.toContain(token);
    });

    it('removes the token from a start error before it reaches the renderer', async () => {
      const service = serviceFor({
        launchGame: () => Promise.reject(new Error(`cannot run java --accessToken ${token}`)),
      });
      const result = await service.launch({ target: plain, account: microsoft });
      expect(result.ok).toBe(false);
      expect(JSON.stringify([result, events, await service.state()])).not.toContain(token);
    });
  });

  it('a nickname pinned to another account: the game never starts', async () => {
    const service = makeService({}, undefined, () =>
      Promise.resolve({ check: { kind: 'nick_taken' }, code: null }),
    );
    const result = await service.launch(request);
    expect(result).toEqual({ ok: false, error: { code: 'nick-taken' } });
    expect(launched).toHaveLength(0);
    const state = await service.state();
    expect(state.ok && state.value).toMatchObject({
      phase: 'idle',
      lastError: { error: { code: 'nick-taken' }, source: 'operation' },
    });
  });

  it('a refusal that arrives in the middle of the download cancels it: nothing is left as installed', async () => {
    const blocker = gate();
    gates.verifyInstallation = blocker;
    let answer: (checked: CheckedPlay) => void = () => undefined;
    const service = makeService({}, undefined, () => {
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    const pending = service.launch({
      target: { kind: 'server', serverId: 8, minecraft: '26.3', address: 'play.example.ru' },
      account,
    });
    await blocker.reached;
    answer({ check: { kind: 'nick_taken' }, code: null });
    await new Promise((resolve) => setImmediate(resolve));
    blocker.open();
    expect(await pending).toEqual({ ok: false, error: { code: 'nick-taken' } });
    expect(launched).toHaveLength(0);
    await expect(stat(join(root, 'instances', 'server-8'))).rejects.toThrow();
    const state = await service.state();
    expect(state.ok && state.value).toMatchObject({
      phase: 'idle',
      lastError: { error: { code: 'nick-taken' }, source: 'operation' },
    });
  });

  it('a ban that arrives after the files are ready still keeps the game from starting', async () => {
    const ban = { reason: 'гриф спавна', until: '2026-10-20T21:00:00Z', forever: false };
    const service = makeService(
      {},
      undefined,
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ check: { kind: 'banned', ban }, code: null });
          }, 30);
        }),
    );
    const pending = service.launch(request);
    expect(await pending).toEqual({ ok: false, error: { code: 'banned', ...ban } });
    expect(launched).toHaveLength(0);
  });

  it('the game waits for the play check and takes the pinned nickname from it', async () => {
    let answer: (checked: CheckedPlay) => void = () => undefined;
    const asked: PlayCheckQuery[] = [];
    const service = makeService({}, undefined, (query) => {
      asked.push(query);
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    const pending = service.launch(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(launched).toHaveLength(0);
    answer({ check: { kind: 'nick_mismatch', nick: 'Test_User' }, code: null });
    expect(await pending).toMatchObject({ ok: true, value: { nick: 'Test_User' } });
    expect(asked).toEqual([{ serverId: 1, nick: 'Steve', auth: 'nick' }]);
  });

  it('a play check that failed does not keep the player out', async () => {
    const service = makeService({}, undefined, () => Promise.reject(new Error('site down')));
    expect(await service.launch(request)).toMatchObject({ ok: true, value: { nick: 'Steve' } });
  });

  it('an account instead of a nickname gives a clear error before installation', async () => {
    const installJava = vi.fn(() => Promise.resolve('/java'));
    const service = makeService({ installJava });
    const result = await service.launch({
      target: plain,
      account: { kind: 'account', id: 'ms-1' },
    });
    expect(result).toEqual({ ok: false, error: { code: 'account-unsupported' } });
    expect(installJava).not.toHaveBeenCalled();
    const state = await service.state();
    expect(state.ok && state.value).toMatchObject({
      phase: 'idle',
      target: plain,
      lastError: { error: { code: 'account-unsupported' }, source: 'operation' },
    });
  });

  describe('play code', () => {
    const CODE = 'c'.repeat(32);
    const onServer: LaunchRequest = {
      target: { kind: 'server', serverId: 68, minecraft: '26.3', address: 'play.example.ru:25570' },
      account,
    };
    const codeFile = (): string => join(root, 'instances', 'server-68', 'mcmonitor', 'play.json');
    const withCode =
      (code: string | null): PlayChecker =>
      () =>
        Promise.resolve({ check: { kind: 'ok' }, code });

    it('writes the code for the server the game joins before the game starts', async () => {
      let written: unknown = null;
      const service = makeService(
        {
          launchGame: async (options) => {
            written = JSON.parse(await readFile(codeFile(), 'utf8'));
            launched.push(options);
            return child as unknown as ChildProcess;
          },
        },
        undefined,
        withCode(CODE),
      );
      expect(await service.launch(onServer)).toMatchObject({ ok: true });
      expect(written).toEqual({
        v: 1,
        server_id: 68,
        nick: 'Steve',
        code: CODE,
        host: 'play.example.ru',
        port: 25570,
      });
      const log = await service.logTail(50);
      expect(JSON.stringify(log)).toContain('play code: written');
      expect(JSON.stringify([log, events, telemetry, await service.state()])).not.toContain(CODE);
    });

    it('removes the code before the instance is free for the next launch', async () => {
      const service = makeService({}, undefined, withCode(CODE));
      expect(await service.launch(onServer)).toMatchObject({ ok: true });
      await expect(stat(codeFile())).resolves.toBeTruthy();
      handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
      await service.whenIdle();
      await expect(stat(codeFile())).rejects.toThrow();
    });

    it('a server without a port gets port null, an IPv6 host goes without brackets', async () => {
      const service = makeService({}, undefined, withCode(CODE));
      const ipv6: LaunchRequest = {
        ...onServer,
        target: { kind: 'server', serverId: 68, minecraft: '26.3', address: '[2001:db8::1]' },
      };
      expect(await service.launch(ipv6)).toMatchObject({ ok: true });
      expect(JSON.parse(await readFile(codeFile(), 'utf8'))).toMatchObject({
        host: '2001:db8::1',
        port: null,
      });
    });

    it('a game that fails to start leaves no code behind', async () => {
      const service = makeService(
        { launchGame: () => Promise.reject(new Error('no java')) },
        undefined,
        withCode(CODE),
      );
      expect(await service.launch(onServer)).toMatchObject({ ok: false });
      await expect(stat(codeFile())).rejects.toThrow();
    });

    it('a launch without a code removes the one left from before', async () => {
      await mkdir(dirname(codeFile()), { recursive: true });
      await writeFile(codeFile(), '{"v":1}');
      const service = makeService({}, undefined, withCode(null));
      expect(await service.launch(onServer)).toMatchObject({ ok: true });
      await expect(stat(codeFile())).rejects.toThrow();
    });
  });
});

describe('game window from the launcher settings', () => {
  function withWindow(fullscreen: boolean): GameLaunchService {
    return createLaunchService({
      root,
      platform: 'darwin',
      arch: 'arm64',
      totalMemoryBytes: 16 * 1024 ** 3,
      fetch: () => Promise.resolve({}),
      telemetry: () => undefined,
      gameWindow: () => ({ fullscreen, width: 1600, height: 900 }),
      dependencies: deps,
    });
  }

  it('full screen from the settings reaches the game', async () => {
    await withWindow(true).launch(request);
    expect(launched[0]?.resolution).toEqual({ width: 1600, height: 900, fullscreen: true });
  });

  it('a window gets the size from the settings', async () => {
    await withWindow(false).launch(request);
    expect(launched[0]?.resolution).toEqual({ width: 1600, height: 900 });
  });

  it('without the settings the game opens in the standard window', async () => {
    await makeService().launch(request);
    expect(launched[0]?.resolution).toEqual({ width: 1280, height: 720 });
  });
});

describe('waiting for the game window', () => {
  const TIMERS = ['setTimeout', 'clearTimeout', 'Date'] as const;

  afterEach(() => {
    vi.useRealTimers();
  });

  function stepStatus(state: LaunchEvent['state'], id: string): string | undefined {
    return state.progress?.steps.find((step) => step.id === id)?.status;
  }

  async function started(): Promise<GameLaunchService> {
    vi.useFakeTimers({ toFake: [...TIMERS] });
    const service = makeService();
    expect(await service.launch(request)).toMatchObject({ ok: true });
    return service;
  }

  async function snapshot(service: GameLaunchService): Promise<LaunchEvent['state']> {
    const state = await service.state();
    if (!state.ok) {
      throw new Error('no state');
    }
    return state.value;
  }

  it('between the process start and the window the launch step stays active and no window is claimed', async () => {
    const service = makeService();
    await service.launch(request);
    const waiting = await snapshot(service);
    expect(waiting).toMatchObject({ phase: 'running', windowReady: false, windowSlow: false });
    expect(stepStatus(waiting, 'launch')).toBe('active');
    expect(
      events.some((event) => event.kind === 'game' && event.event.type === 'window-ready'),
    ).toBe(false);
    handlers?.onWindowReady();
    handlers?.onWindowReady();
    const open = await snapshot(service);
    expect(open.windowReady).toBe(true);
    expect(stepStatus(open, 'launch')).toBe('done');
    expect(
      events.filter((event) => event.kind === 'game' && event.event.type === 'window-ready'),
    ).toHaveLength(1);
  });

  it('a window failure in the output ends the game after a pause and is reported as a crash', async () => {
    const service = await started();
    handlers?.onWindowFailed();
    vi.advanceTimersByTime(WINDOW_FAILURE_GRACE_MS - 1);
    expect(stopModes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(stopModes).toEqual(['force']);
    handlers?.onExit({ code: null, signal: 'SIGTERM', crashReportPath: null });
    await service.whenIdle();
    const state = await snapshot(service);
    expect(state).toMatchObject({
      phase: 'idle',
      lastCrash: { code: null, reportPath: null },
      lastError: { error: { code: 'game-start-failed' }, source: 'process' },
    });
    expect(stepStatus(state, 'launch')).toBe('failed');
    const exit = events.find((event) => event.kind === 'game' && event.event.type === 'exit');
    expect(exit).toMatchObject({ event: { byUser: false } });
    expect(telemetry.at(-1)).toMatchObject({
      type: 'launch.finished',
      outcome: 'crash',
      exit_code: null,
      time_to_window_s: null,
    });
  });

  it('a game that caught the window failure and left with code 0 is still a crash', async () => {
    const service = await started();
    handlers?.onWindowFailed();
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    vi.advanceTimersByTime(WINDOW_FAILURE_GRACE_MS);
    expect(stopModes).toEqual([]);
    expect((await snapshot(service)).lastCrash).toMatchObject({ code: 0 });
    expect(telemetry.at(-1)).toMatchObject({ type: 'launch.finished', outcome: 'crash' });
  });

  it('a window that opens within the pause keeps the game alive', async () => {
    const service = await started();
    handlers?.onWindowFailed();
    handlers?.onWindowReady();
    vi.advanceTimersByTime(WINDOW_FAILURE_GRACE_MS);
    expect(stopModes).toEqual([]);
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    expect((await snapshot(service)).lastCrash).toBeNull();
    expect(telemetry.at(-1)).toMatchObject({ type: 'launch.finished', outcome: 'ok' });
  });

  it('a window failure after the window opened is ignored', async () => {
    const service = await started();
    handlers?.onWindowReady();
    handlers?.onWindowFailed();
    vi.advanceTimersByTime(WINDOW_FAILURE_GRACE_MS);
    expect(stopModes).toEqual([]);
    expect((await snapshot(service)).windowReady).toBe(true);
  });

  it('a silent game is called slow after the wait, and time alone never ends it', async () => {
    const service = await started();
    vi.advanceTimersByTime(WINDOW_WAIT_MS - 1);
    expect((await snapshot(service)).windowSlow).toBe(false);
    vi.advanceTimersByTime(1);
    expect((await snapshot(service)).windowSlow).toBe(true);
    vi.advanceTimersByTime(WINDOW_WAIT_MS * 10);
    expect(stopModes).toEqual([]);
    expect((await snapshot(service)).phase).toBe('running');
  });

  it('new output postpones the slow state', async () => {
    const service = await started();
    vi.advanceTimersByTime(WINDOW_WAIT_MS - 1000);
    handlers?.onOutput();
    vi.advanceTimersByTime(1000);
    expect((await snapshot(service)).windowSlow).toBe(false);
  });

  it("'wait more' clears the slow state and gives a full new wait", async () => {
    const service = await started();
    vi.advanceTimersByTime(WINDOW_WAIT_MS);
    expect(await service.keepWaiting()).toEqual({ ok: true, value: null });
    expect((await snapshot(service)).windowSlow).toBe(false);
    vi.advanceTimersByTime(WINDOW_WAIT_MS - 1);
    expect((await snapshot(service)).windowSlow).toBe(false);
    vi.advanceTimersByTime(1);
    expect((await snapshot(service)).windowSlow).toBe(true);
  });

  it("'close the game' from the slow state stops the process and is not a crash", async () => {
    const service = await started();
    vi.advanceTimersByTime(WINDOW_WAIT_MS);
    expect((await snapshot(service)).windowSlow).toBe(true);
    expect(await service.cancel()).toEqual({ ok: true, value: null });
    expect(stopModes).toEqual(['force']);
    handlers?.onExit({ code: null, signal: 'SIGTERM', crashReportPath: null });
    await service.whenIdle();
    const state = await snapshot(service);
    expect(state).toMatchObject({ phase: 'idle', windowSlow: false, lastCrash: null });
    expect(state.lastError).toBeNull();
    expect(telemetry.at(-1)).toMatchObject({ type: 'launch.finished', outcome: 'exit' });
  });

  it('the window opening ends the slow state', async () => {
    const service = await started();
    vi.advanceTimersByTime(WINDOW_WAIT_MS);
    expect((await snapshot(service)).windowSlow).toBe(true);
    handlers?.onWindowReady();
    expect(await snapshot(service)).toMatchObject({ windowReady: true, windowSlow: false });
    vi.advanceTimersByTime(WINDOW_WAIT_MS * 10);
    expect((await snapshot(service)).windowSlow).toBe(false);
  });

  it("the game's own dialog shows until its window fails, and not after the game is gone", async () => {
    const service = await started();
    service.noteGameDialog();
    expect(await snapshot(service)).toMatchObject({ windowDialog: true, windowReady: false });
    handlers?.onWindowFailed();
    expect((await snapshot(service)).windowDialog).toBe(false);
    service.noteGameDialog();
    expect((await snapshot(service)).windowDialog).toBe(false);
    handlers?.onExit({ code: 0, signal: null, crashReportPath: null });
    await service.whenIdle();
    service.noteGameDialog();
    expect((await snapshot(service)).windowDialog).toBe(false);
  });

  it("'Stop the launch' over the game's own dialog is the game's crash, not the player's cancel", async () => {
    const service = await started();
    const exits: unknown[] = [];
    service.onEvent((event) => {
      if (event.kind === 'game' && event.event.type === 'exit') {
        exits.push(event.event);
      }
    });
    service.noteGameDialog();
    expect(await service.cancel()).toEqual({ ok: true, value: null });
    expect(stopModes).toEqual(['force']);
    handlers?.onExit({ code: null, signal: 'SIGTERM', crashReportPath: null });
    await service.whenIdle();
    const state = await snapshot(service);
    expect(state.lastCrash).not.toBeNull();
    expect(state.lastError?.error.code).toBe('game-start-failed');
    expect(exits).toEqual([
      { type: 'exit', code: null, signal: 'SIGTERM', byUser: false, gameDialog: true },
    ]);
    expect(telemetry.at(-1)).toMatchObject({ type: 'launch.finished', outcome: 'crash' });
  });

  it("the game's dialog is forgotten when the game writes again after it", async () => {
    const service = await started();
    service.noteGameDialog();
    handlers?.onOutput();
    expect((await snapshot(service)).windowDialog).toBe(true);
    vi.advanceTimersByTime(DIALOG_QUIET_MS);
    handlers?.onOutput();
    expect((await snapshot(service)).windowDialog).toBe(false);
  });

  it("the game's dialog is forgotten when its window opens", async () => {
    const service = await started();
    service.noteGameDialog();
    handlers?.onWindowReady();
    expect(await snapshot(service)).toMatchObject({ windowDialog: false, windowReady: true });
  });

  it("'wait more' without a running game is rejected", async () => {
    expect(await makeService().keepWaiting()).toEqual({
      ok: false,
      error: { code: 'not-running' },
    });
  });
});

describe('joining the server: the choice follows the switch until the process starts', () => {
  const onServer: LaunchRequest = {
    target: { kind: 'server', serverId: 1, minecraft: '26.3', address: 'play.example.ru' },
    account,
  };

  it('switched off during the installation: the game starts without the address', async () => {
    gates.installGameFiles = gate();
    const service = makeService();
    const pending = service.launch(onServer);
    await gates.installGameFiles.reached;
    expect(await service.setJoinServer(false)).toEqual({ ok: true, value: null });
    gates.installGameFiles.open();
    expect(await pending).toMatchObject({ ok: true, value: { join: null } });
    expect(launched[0]?.quickPlayMultiplayer).toBeUndefined();
    expect(launched[0]?.server).toBeUndefined();
  });

  it('switched on during the installation: the game joins the server', async () => {
    gates.installGameFiles = gate();
    const service = makeService();
    const pending = service.launch({ ...onServer, joinServer: false });
    await gates.installGameFiles.reached;
    await service.setJoinServer(true);
    gates.installGameFiles.open();
    expect(await pending).toMatchObject({
      ok: true,
      value: { join: { address: { host: 'play.example.ru' } } },
    });
  });

  it('switched on for a version that cannot join: join-unsupported instead of a silent start', async () => {
    entry = entryFor('1.5.2', '2013-04-25T15:45:00+00:00');
    gates.installGameFiles = gate();
    const service = makeService();
    const pending = service.launch({
      target: { kind: 'server', serverId: 1, minecraft: '1.5.2', address: 'play.example.ru' },
      account,
      joinServer: false,
    });
    await gates.installGameFiles.reached;
    await service.setJoinServer(true);
    gates.installGameFiles.open();
    expect(await pending).toEqual({
      ok: false,
      error: { code: 'join-unsupported', minecraft: '1.5.2' },
    });
    expect(launched).toEqual([]);
  });

  it('refused once the address is on its way into the command line, before the process exists', async () => {
    gates.launchGame = gate();
    const service = makeService();
    const pending = service.launch(onServer);
    await gates.launchGame.reached;
    const state = await service.state();
    expect(state.ok && state.value.phase).toBe('preparing');
    expect(await service.setJoinServer(false)).toEqual({ ok: false, error: { code: 'running' } });
    gates.launchGame.open();
    expect(await pending).toMatchObject({
      ok: true,
      value: { join: { address: { host: 'play.example.ru' } } },
    });
  });

  it('once the process runs the choice is fixed; with no launch there is nothing to change', async () => {
    const service = makeService();
    expect(await service.setJoinServer(false)).toEqual({
      ok: false,
      error: { code: 'not-running' },
    });
    await service.launch(onServer);
    expect(await service.setJoinServer(false)).toEqual({ ok: false, error: { code: 'running' } });
  });
});
