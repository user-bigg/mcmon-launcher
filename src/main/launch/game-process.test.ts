import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateArguments } from '@xmcl/core';
import { afterEach, describe, expect, it } from 'vitest';
import { serverJoinMode } from '@shared/minecraft-version';
import { parseServerAddress } from '@shared/server-address';
import {
  ENCODING_JVM_ARGS,
  findCrashReport,
  findJvmCrashLog,
  firstReportLine,
  gameLaunchOptions,
  gameSpawnOptions,
  joinOptions,
  locateCrashReport,
  SERVICES_BLOCK_JVM_ARGS,
} from './game-process';
import { writeVersionFixture } from './version-fixture';

function optionsFor(version: string, address: string): ReturnType<typeof joinOptions> {
  return joinOptions(serverJoinMode({ id: version }), parseServerAddress(address));
}

describe('joinOptions', () => {
  it('adds nothing without an address or for versions before 1.6 (the service responds join-unsupported)', () => {
    expect(joinOptions('quick-play', null)).toEqual({});
    expect(optionsFor('1.5.2', 'play.example.ru')).toEqual({});
  });

  it('quick play passes the port exactly as entered, 25565 too, and none when none was entered', () => {
    expect(optionsFor('26.2', 'play.example.ru:25565')).toEqual({
      quickPlayMultiplayer: 'play.example.ru:25565',
    });
    expect(optionsFor('26.2', 'play.example.ru')).toEqual({
      quickPlayMultiplayer: 'play.example.ru',
    });
    expect(optionsFor('1.12.2', 'play.example.ru:25565')).toEqual({
      server: { ip: 'play.example.ru', port: 25565 },
    });
    expect(optionsFor('1.12.2', 'play.example.ru')).toEqual({ server: { ip: 'play.example.ru' } });
    expect(optionsFor('26.2', '[2001:db8::1]:25570')).toEqual({
      quickPlayMultiplayer: '[2001:db8::1]:25570',
    });
  });
});

describe('findCrashReport', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('takes the most recent report created after launch', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-crash-'));
    const old = join(dir, 'crash-old-client.txt');
    const fresh = join(dir, 'crash-new-client.txt');
    await writeFile(old, 'old');
    await writeFile(fresh, 'new');
    const launchedAt = Date.now() - 1000;
    await utimes(old, new Date(launchedAt - 60_000), new Date(launchedAt - 60_000));
    expect(await findCrashReport(dir, launchedAt)).toBe(fresh);
    expect(await findCrashReport(dir, Date.now() + 60_000)).toBeNull();
    expect(await findCrashReport(join(dir, 'missing'), 0)).toBeNull();
  });
});

function after(args: string[], flag: string, count: number): string[] {
  const index = args.indexOf(flag);
  expect(args.filter((arg) => arg === flag)).toHaveLength(1);
  return args.slice(index + 1, index + 1 + count);
}

describe('@xmcl/core arguments', () => {
  let root: string | null = null;

  afterEach(async () => {
    if (root !== null) {
      await rm(root, { recursive: true, force: true });
    }
  });

  async function argsFor(
    mode: ReturnType<typeof serverJoinMode>,
    address: string | null,
  ): Promise<string[]> {
    root = await mkdtemp(join(tmpdir(), 'mcmonitor-args-'));
    const version = await writeVersionFixture(root);
    return generateArguments(
      gameLaunchOptions({
        version,
        gamePath: join(root, 'instances', 'server-1'),
        resourcePath: root,
        javaPath: '/java/bin/java',
        nick: 'Steve',
        memoryMb: 3072,
        mode,
        address: address === null ? null : parseServerAddress(address),
      }),
    );
  }

  it('quickPlay for new versions — a single --quickPlayMultiplayer pair', async () => {
    const args = await argsFor('quick-play', 'play.example.ru:25566');
    expect(after(args, '--quickPlayMultiplayer', 1)).toEqual(['play.example.ru:25566']);
    expect(args).not.toContain('--server');
    expect(args).toContain('-Xmx3072M');
  });

  it('no unfilled client id or Xbox user id in the command line, by nick and by Microsoft', async () => {
    root = await mkdtemp(join(tmpdir(), 'mcmonitor-args-'));
    // The game arguments of 1.21.11 in the order seen on a real launch.
    const version = await writeVersionFixture(root, {
      id: '1.21.11',
      gameArguments: [
        '--username',
        '${auth_player_name}',
        '--version',
        '${version_name}',
        '--gameDir',
        '${game_directory}',
        '--assetsDir',
        '${assets_root}',
        '--assetIndex',
        '${assets_index_name}',
        '--uuid',
        '${auth_uuid}',
        '--accessToken',
        '${auth_access_token}',
        '--clientId',
        '${clientid}',
        '--xuid',
        '${auth_xuid}',
        '--versionType',
        '${version_type}',
      ],
    });
    const base = {
      version,
      gamePath: join(root, 'instances', 'server-1'),
      resourcePath: root,
      javaPath: '/java/bin/java',
      nick: 'Steve',
      memoryMb: 3072,
      mode: null,
      address: null,
    };
    const microsoft = { uuid: '0'.repeat(32), accessToken: 'token' };
    for (const auth of [null, microsoft]) {
      const args = await generateArguments(gameLaunchOptions({ ...base, auth }));
      expect(args.filter((arg) => arg.includes('${'))).toEqual([]);
      expect(args).not.toContain('--clientId');
      expect(args).not.toContain('--xuid');
      expect(after(args, '--accessToken', 1)).toHaveLength(1);
      expect(after(args, '--versionType', 1)).toEqual(['release']);
    }
    expect(version.arguments.game).toContain('${clientid}');
  });

  it('full screen is a flag instead of a window size; a window gets its size', async () => {
    root = await mkdtemp(join(tmpdir(), 'mcmonitor-args-'));
    const version = await writeVersionFixture(root);
    const base = {
      version,
      gamePath: join(root, 'instances', 'server-1'),
      resourcePath: root,
      javaPath: '/java/bin/java',
      nick: 'Steve',
      memoryMb: 3072,
      mode: null,
      address: null,
      resolution: { width: 1600, height: 900 },
    };
    const full = await generateArguments(gameLaunchOptions({ ...base, fullscreen: true }));
    expect(full).toContain('--fullscreen');
    expect(full).not.toContain('--width');
    const windowed = await generateArguments(gameLaunchOptions({ ...base, fullscreen: false }));
    expect(windowed).not.toContain('--fullscreen');
    expect(after(windowed, '--width', 1)).toEqual(['1600']);
    expect(after(windowed, '--height', 1)).toEqual(['900']);
  });

  it('--server and --port for 1.6-1.19, without a port — only --server', async () => {
    const withPort = await argsFor('legacy', 'play.example.ru:25566');
    expect(after(withPort, '--server', 3)).toEqual(['play.example.ru', '--port', '25566']);
    expect(withPort).not.toContain('--quickPlayMultiplayer');
    const noPort = await argsFor('legacy', 'play.example.ru');
    expect(after(noPort, '--server', 1)).toEqual(['play.example.ru']);
    expect(noPort).not.toContain('--port');
  });

  it("xmcl's G1 flags are kept, UTF-8 encoding is appended, -Xmx2G is not duplicated", async () => {
    const args = await argsFor(null, null);
    for (const flag of [...ENCODING_JVM_ARGS, '-XX:+UseG1GC']) {
      expect(args).toContain(flag);
    }
    expect(args).not.toContain('-Xmx2G');
  });

  it('the skins variant points Fabric at its own mod folder before the main class', async () => {
    root = await mkdtemp(join(tmpdir(), 'mcmonitor-args-'));
    const version = await writeVersionFixture(root);
    const modsDir = join(root, 'skin-mod', 'c'.repeat(64));
    const base = {
      version,
      gamePath: join(root, 'instances', 'server-1'),
      resourcePath: root,
      javaPath: '/java/bin/java',
      nick: 'Steve',
      memoryMb: 3072,
      mode: null,
      address: null,
    };
    const withSkins = await generateArguments(gameLaunchOptions({ ...base, modsDir }));
    const property = `-Dfabric.modsFolder=${modsDir}`;
    expect(withSkins).toContain(property);
    expect(withSkins.indexOf(property)).toBeLessThan(withSkins.indexOf(version.mainClass));
    const plain = await generateArguments(gameLaunchOptions(base));
    expect(plain.some((arg) => arg.includes('fabric.modsFolder'))).toBe(false);
  });
});

describe('account services for a nickname', () => {
  let root: string | null = null;

  afterEach(async () => {
    if (root !== null) {
      await rm(root, { recursive: true, force: true });
    }
  });

  async function argsFor(minecraft: string, licence: boolean): Promise<string[]> {
    root = await mkdtemp(join(tmpdir(), 'mcmonitor-args-'));
    const version = await writeVersionFixture(root);
    return generateArguments(
      gameLaunchOptions({
        version,
        gamePath: join(root, 'instances', 'server-1'),
        resourcePath: root,
        javaPath: '/java/bin/java',
        nick: 'Steve',
        auth: licence ? { uuid: '0'.repeat(32), accessToken: 'token' } : null,
        memoryMb: 3072,
        mode: null,
        address: null,
        minecraft,
      }),
    );
  }

  function blocked(args: string[]): string[] {
    return args.filter((arg) => arg.startsWith('-Dminecraft.api.'));
  }

  it('on 1.16.4 and 1.16.5 a nickname gets all four hosts sent to a name that never resolves', async () => {
    expect(SERVICES_BLOCK_JVM_ARGS).toEqual([
      '-Dminecraft.api.auth.host=https://nope.invalid',
      '-Dminecraft.api.account.host=https://nope.invalid',
      '-Dminecraft.api.session.host=https://nope.invalid',
      '-Dminecraft.api.services.host=https://nope.invalid',
    ]);
    expect(blocked(await argsFor('1.16.5', false))).toEqual(SERVICES_BLOCK_JVM_ARGS);
    expect(blocked(await argsFor('1.16.4', false))).toEqual(SERVICES_BLOCK_JVM_ARGS);
    expect(blocked(await argsFor('1.16.4-pre1', false))).toEqual(SERVICES_BLOCK_JVM_ARGS);
    expect(blocked(await argsFor('1.16.5-rc1', false))).toEqual(SERVICES_BLOCK_JVM_ARGS);
  });

  it('a nickname on 1.16.3, 1.17 and a current version reaches the services as before', async () => {
    for (const minecraft of [
      '1.16.3',
      '1.16',
      '1.16.40',
      '1.17',
      '1.17.1',
      '1.21.11',
      '26.1',
      '26.2',
      '11.16.5',
    ]) {
      expect(blocked(await argsFor(minecraft, false))).toEqual([]);
    }
  });

  it('a Microsoft account is never cut off, 1.16.5 included', async () => {
    expect(blocked(await argsFor('1.16.5', true))).toEqual([]);
    expect(blocked(await argsFor('26.2', true))).toEqual([]);
  });
});

describe('gameSpawnOptions', () => {
  it('hides only the java.exe console, leaves the javaw window alone', () => {
    expect(gameSpawnOptions('C:\\game\\runtime\\bin\\java.exe')).toEqual({
      detached: true,
      windowsHide: true,
    });
    expect(gameSpawnOptions('C:\\game\\runtime\\bin\\javaw.exe').windowsHide).toBe(false);
    expect(gameSpawnOptions('/g/runtime/bin/java').windowsHide).toBe(false);
  });
});

describe('crash report', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("path from the game's output — first line, and only inside the instance", async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-report-'));
    const instance = join(dir, 'instance');
    const reports = join(instance, 'crash-reports');
    await mkdir(reports, { recursive: true });
    const report = join(reports, 'crash-1.txt');
    await writeFile(report, 'crash');
    const outside = join(dir, 'secret.txt');
    await writeFile(outside, 'secret');
    const options = {
      crashReportsDir: reports,
      startedAt: Date.now() + 60_000,
      instanceDir: instance,
    };

    expect(firstReportLine(`${report}\n[12:00:00] [main/INFO]: next`)).toBe(report);
    expect(await locateCrashReport(`${report}\r\nmore`, options)).toContain('crash-1.txt');
    expect(await locateCrashReport(outside, options)).toBeNull();
    expect(await locateCrashReport(join(reports, 'missing.txt'), options)).toBeNull();
  });

  it('without a path, looks for a recent report, then for a JVM hs_err_pid*.log in the instance root', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-report-'));
    const reports = join(dir, 'crash-reports');
    const since = Date.now() - 1000;
    await writeFile(join(dir, 'hs_err_pid123.log'), 'jvm');
    await writeFile(join(dir, 'other.log'), 'x');
    expect(await findJvmCrashLog(dir, since)).toBe(join(dir, 'hs_err_pid123.log'));
    expect(
      await locateCrashReport('', { crashReportsDir: reports, startedAt: since, instanceDir: dir }),
    ).toBe(join(dir, 'hs_err_pid123.log'));
  });
});
