import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectCrashFiles } from './crash-sources';
import { GameLogWriter, readLogTail } from './game-log';
import { argFileSpawn, JVM_ARG_FILE, quoteArgFileValue, splitAtMainClass } from './game-process';
import { decodeCp1251, decodeLines, decodeText } from './text-decode';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcmonitor-windows-io-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Java output encoding', () => {
  it('valid UTF-8 is read as-is, invalid UTF-8 is read as cp1251', () => {
    expect(decodeText(Buffer.from('Привет', 'utf8'))).toBe('Привет');
    const cp1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeText(cp1251)).toBe('Привет');
    expect(decodeCp1251(Buffer.from([0xa8, 0xb8, 0xb9, 0x80]))).toBe('Ёё№Ђ');
  });

  it('a mix of UTF-8 and cp1251 lines in one log is parsed line by line', () => {
    const mixed = Buffer.concat([
      Buffer.from('[INFO] Загрузка\n', 'utf8'),
      Buffer.from([0xce, 0xf8, 0xe8, 0xe1, 0xea, 0xe0, 0x0a]),
    ]);
    expect(decodeLines(mixed)).toBe('[INFO] Загрузка\nОшибка\n');
  });

  it('the log tail does not split a UTF-8 character at the boundary and recognizes cp1251', async () => {
    const file = join(dir, 'game.log');
    const filler = 'ж'.repeat(300_000);
    await writeFile(
      file,
      Buffer.concat([
        Buffer.from(`${filler}\n[18:44:05] [Server thread/ERROR]: save failed\n`, 'utf8'),
        Buffer.from([0xcd, 0xe5, 0xe4, 0xee, 0xf1, 0xf2, 0xe0, 0xf2, 0xee, 0xf7, 0xed, 0xee, 0x0a]),
      ]),
    );
    const tail = await readLogTail(file, 2);
    expect(tail).toEqual(['[18:44:05] [Server thread/ERROR]: save failed', 'Недостаточно']);
  });

  it('a cp1251 crash report with a José path is read in full', async () => {
    const instance = join(dir, 'instances', 'server-1');
    await mkdir(join(instance, 'crash-reports'), { recursive: true });
    await mkdir(join(instance, 'logs'), { recursive: true });
    await writeFile(join(instance, 'logs', 'mcmonitor-launch.log'), '');
    const report = Buffer.concat([
      Buffer.from(
        '---- Minecraft Crash Report ----\nDescription: Saving\n\njava.io.IOException: ',
        'latin1',
      ),
      Buffer.from([0xcd, 0xe5, 0xe4, 0xee, 0xf1, 0xf2, 0xe0, 0xf2, 0xee, 0xf7, 0xed, 0xee]),
      Buffer.from(' C:\\Users\\Jos\xe9\\game\n', 'latin1'),
    ]);
    await writeFile(join(instance, 'crash-reports', 'crash-1.txt'), report);
    const files = await collectCrashFiles(instance, 0, null);
    expect(files.crashReport?.text).toContain('Недостаточно C:\\Users\\Josй\\game');
  });
});

describe('game log', () => {
  it('stdout and stderr are written as whole lines and do not interleave', async () => {
    const file = join(dir, 'logs', 'mcmonitor-launch.log');
    const writer = await GameLogWriter.create(file);
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    writer.attach(stdout);
    writer.attach(stderr);
    stdout.write('<log4j:Event a="1"><log4j:Message><![CDATA[par');
    stderr.write('stderr line\n');
    stdout.write('tial]]></log4j:Message></log4j:Event>\n');
    stdout.end('tail without newline');
    await once(stdout, 'end');
    await writer.close();
    expect(await readFile(file, 'utf8')).toBe(
      'stderr line\n<log4j:Event a="1"><log4j:Message><![CDATA[partial]]></log4j:Message></log4j:Event>\ntail without newline',
    );
  });
});

describe('long Windows command line', () => {
  const classpath = Array.from(
    { length: 1000 },
    (_, index) => `C:/game/libraries/lib${String(index)}/lib-1.0.0.jar`,
  ).join(';');
  const args = [
    '-Xmx4096M',
    '-cp',
    classpath,
    'cpw.mods.bootstraplauncher.BootstrapLauncher',
    '--username',
    'Steve',
  ];

  function spawned(options: Partial<Parameters<typeof argFileSpawn>[0]> = {}): {
    calls: unknown[][];
    files: Map<string, string>;
  } {
    const calls: unknown[][] = [];
    const files = new Map<string, string>();
    const spawn = argFileSpawn({
      dir,
      javaMajor: 21,
      mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
      platform: 'win32',
      spawnImpl: (command, list, spawnOptions) => {
        calls.push([command, list, spawnOptions]);
        return {} as ChildProcess;
      },
      writeFile: (file, content) => {
        files.set(file, content);
      },
      ...options,
    });
    spawn('C:/java/bin/javaw.exe', args, { cwd: dir });
    return { calls, files };
  }

  it('Java 9+, over 28000 chars: JVM arguments go to an @file, game arguments stay', () => {
    const { calls, files } = spawned();
    const file = join(dir, JVM_ARG_FILE);
    expect(calls[0]?.[1]).toEqual([
      `@${file}`,
      'cpw.mods.bootstraplauncher.BootstrapLauncher',
      '--username',
      'Steve',
    ]);
    expect(files.get(file)?.split('\n')[1]).toBe('"-cp"');
  });

  it('Java 8, macOS, a short line and a Cyrillic path behave as before', () => {
    expect(spawned({ javaMajor: 8 }).calls[0]?.[1]).toEqual(args);
    expect(spawned({ platform: 'darwin' }).calls[0]?.[1]).toEqual(args);
    expect(spawned({ limit: 1_000_000 }).calls[0]?.[1]).toEqual(args);
    const cyrillic = vi.fn(() => ({}) as ChildProcess);
    argFileSpawn({
      dir,
      javaMajor: 21,
      mainClass: 'Main',
      platform: 'win32',
      limit: 10,
      spawnImpl: cyrillic,
      writeFile: () => undefined,
    })('java', ['-cp', 'C:/Users/Иван/a.jar', 'Main']);
    expect(cyrillic).toHaveBeenCalledWith('java', ['-cp', 'C:/Users/Иван/a.jar', 'Main'], {});
  });

  it('quotes and backslashes are escaped, the class is found by name', () => {
    expect(quoteArgFileValue('C:\\a "b"')).toBe('"C:\\\\a \\"b\\""');
    expect(splitAtMainClass(['-cp', 'x', 'Main', 'arg'], 'Main')).toEqual({
      jvm: ['-cp', 'x'],
      rest: ['Main', 'arg'],
    });
    expect(splitAtMainClass(['Main'], 'Main')).toBeNull();
  });
});
