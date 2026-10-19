import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectingTarget,
  gameLogLines,
  GameLogWriter,
  readLogTail,
  rotatedLogFile,
  rotateLog,
} from './game-log';

const at = Date.parse('2026-10-03T09:15:30Z');

function event(message: string, extra = ''): string {
  return [
    `<log4j:Event logger="net.minecraft.client.Minecraft" timestamp="${String(at)}" level="INFO" thread="Render thread">`,
    `  <log4j:Message><![CDATA[${message}]]></log4j:Message>${extra}`,
    '</log4j:Event>',
  ].join('\n');
}

describe('gameLogLines', () => {
  it('converts XML log4j into lines with Moscow time', () => {
    const raw = `${event('Setting user: Steve')}\n${event('Backend library: LWJGL version 3.3.3')}\n`;
    expect(gameLogLines(raw)).toEqual([
      '[12:15:30] [Render thread/INFO]: Setting user: Steve',
      '[12:15:30] [Render thread/INFO]: Backend library: LWJGL version 3.3.3',
    ]);
  });

  it('keeps plain text and exception stack traces, skips a truncated event', () => {
    const throwable =
      '\n  <log4j:Throwable><![CDATA[java.lang.OutOfMemoryError: Java heap space\n\tat a.b(C.java:1)\n]]></log4j:Throwable>';
    const raw = `[MC Monitor] minecraft=26.3\n${event('Crash', throwable)}\n<log4j:Event logger="x" timestamp="1"`;
    expect(gameLogLines(raw)).toEqual([
      '[MC Monitor] minecraft=26.3',
      '[12:15:30] [Render thread/INFO]: Crash',
      'java.lang.OutOfMemoryError: Java heap space',
      '\tat a.b(C.java:1)',
    ]);
  });

  it('chat in plain lines and in XML log4j is dropped on request', () => {
    const plain =
      '[12:00:01] [Render thread/INFO]: [System] [CHAT] java.lang.OutOfMemoryError\nok\n';
    expect(gameLogLines(plain, { dropChat: true })).toEqual(['ok']);
    const xml =
      '<log4j:Event logger="net.minecraft.client.gui.components.ChatComponent" timestamp="1759516861000" level="INFO" thread="Render thread"><log4j:Message><![CDATA[[System] [CHAT] java.lang.OutOfMemoryError: Java heap space]]></log4j:Message></log4j:Event>\n';
    expect(gameLogLines(xml, { dropChat: true })).toEqual([]);
    expect(gameLogLines(xml)).toHaveLength(1);
  });
});

describe('connectingTarget', () => {
  it('finds the ConnectScreen line', () => {
    expect(
      connectingTarget('[Server Connector #1/INFO]: Connecting to play.example.ru, 25565'),
    ).toEqual({
      host: 'play.example.ru',
      port: 25565,
    });
    expect(connectingTarget('Connecting to play.example.ru')).toBeNull();
  });

  it("port outside 1-65535 isn't an address", () => {
    expect(connectingTarget('Connecting to play.example.ru, 0')).toBeNull();
    expect(connectingTarget('Connecting to play.example.ru, 65536')).toBeNull();
    expect(connectingTarget('Connecting to play.example.ru, 65535')).toEqual({
      host: 'play.example.ru',
      port: 65535,
    });
  });
});

describe('readLogTail', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns the last lines, or an empty list if there is no log', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-log-'));
    const file = join(dir, 'mcmonitor-launch.log');
    expect(await readLogTail(file, 10)).toEqual([]);
    await writeFile(file, Array.from({ length: 50 }, (_, i) => `line ${String(i)}`).join('\n'));
    expect(await readLogTail(file, 3)).toEqual(['line 47', 'line 48', 'line 49']);
  });

  it('the tail can be read from the launch start marker', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-log-'));
    const file = join(dir, 'log');
    await writeFile(file, 'old\nnew 1\nnew 2\n');
    expect(await readLogTail(file, 10, 4)).toEqual(['new 1', 'new 2']);
    expect(await readLogTail(file, 10, 1000)).toEqual(['old', 'new 1', 'new 2']);
  });

  it('for a log over 512 KB the truncated first line is excluded from the tail', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-log-'));
    const file = join(dir, 'log');
    await writeFile(file, `${'A'.repeat(600 * 1024)}\nlast 1\nlast 2\n`);
    expect(await readLogTail(file, 1000)).toEqual(['last 1', 'last 2']);
  });
});

describe('GameLogWriter', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await chmod(dir, 0o755).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('each launch writes its own file, the previous one is kept as .1', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-writer-'));
    const file = join(dir, 'logs', 'mcmonitor-launch.log');
    const first = await GameLogWriter.create(file);
    first.note('first run');
    await first.close();
    const second = await GameLogWriter.create(file);
    expect(second.startOffset).toBe(0);
    second.note('second run');
    await second.close();
    second.note('after close');
    expect(await readFile(file, 'utf8')).toBe('[MC Monitor] second run\n');
    expect(await readFile(rotatedLogFile(file, 1), 'utf8')).toBe('[MC Monitor] first run\n');
    expect(await readLogTail(file, 10)).toEqual(['[MC Monitor] second run']);
  });

  it('removes the access token from game output without touching other bytes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-writer-'));
    const file = join(dir, 'mcmonitor-launch.log');
    const writer = await GameLogWriter.create(file);
    const output = new PassThrough();
    writer.attach(output);
    writer.hide('secret-token-value');
    output.write(Buffer.from([0xcf, 0xf0, 0xe8, 0x0a]));
    output.end('java_command: Main --accessToken abc.def --version 26.3\nraw secret-token-value\n');
    await finished(output);
    await writer.close();
    const written = await readFile(file);
    expect([...written.subarray(0, 4)]).toEqual([0xcf, 0xf0, 0xe8, 0x0a]);
    expect(written.subarray(4).toString('utf8')).toBe(
      'java_command: Main --accessToken <hidden> --version 26.3\nraw <hidden>\n',
    );
  });

  it('a stream error does not crash the launch: writing becomes a no-op', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-writer-'));
    const file = join(dir, 'log');
    await writeFile(file, '');
    await chmod(file, 0o444);
    const writer = await GameLogWriter.create(file);
    await vi.waitFor(() => {
      expect(writer.writable).toBe(false);
    });
    expect(() => {
      writer.note('ignored');
    }).not.toThrow();
    await writer.close();
    await writer.close();
  });

  it('keeps four previous launches, an empty log is not rotated', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcmonitor-writer-'));
    const file = join(dir, 'mcmonitor-launch.log');
    for (let run = 1; run <= 6; run += 1) {
      await writeFile(file, `run ${String(run)}`);
      await rotateLog(file);
    }
    expect(await readFile(rotatedLogFile(file, 1), 'utf8')).toBe('run 6');
    expect(await readFile(rotatedLogFile(file, 4), 'utf8')).toBe('run 3');
    await expect(stat(rotatedLogFile(file, 5))).rejects.toThrow();
    await writeFile(file, '');
    await rotateLog(file);
    expect(await readFile(rotatedLogFile(file, 1), 'utf8')).toBe('run 6');
  });
});
