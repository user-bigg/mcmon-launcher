import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CrashCause } from '@shared/crash';
import { gameLayout, type GameLayout } from '../layout';
import { ClientModBlocks, clientModBlocksFile } from './client-mod-blocks';
import { crashedOnClientMod, JOIN_WINDOW_MS } from './client-mod-crash';

const START = Date.parse('2026-10-18T12:00:00Z');

function event(level: string, message: string, throwable = '', at = START): string {
  const error =
    throwable === '' ? '' : `<log4j:Throwable><![CDATA[${throwable}]]></log4j:Throwable>`;
  return `<log4j:Event logger="ewb" timestamp="${String(at)}" level="${level}" thread="Render thread"><log4j:Message><![CDATA[${message}]]></log4j:Message>${error}</log4j:Event>\n`;
}

const MOD_LIST = event(
  'INFO',
  'Loading 3 mods:\n\t- fabricloader 0.19.5\n\t- mcmonitor 0.1.0\n\t- minecraft 1.21.11',
);
const CONNECT = event('INFO', 'Connecting to play.example.org, 25565');

const DRIVER_REPORT = `---- Minecraft Crash Report ----
Description: Rendering screen

java.lang.IllegalStateException: GLFW error 65543: WGL: Failed to make context current
\tat com.mojang.blaze3d.platform.GlStateManager.clear(GlStateManager.java:120)
\tat net.minecraft.client.gui.screens.ConnectScreen.render(ConnectScreen.java:155)
\tat net.minecraft.client.Minecraft.runTick(Minecraft.java:1210)

-- Head --
Thread: Render thread
Stacktrace:
\tat net.minecraft.client.gui.screens.ConnectScreen.render(ConnectScreen.java:155)
Mixins in Stacktrace:
\tnet.minecraft.client.gui.screens.ConnectScreen:
\t\tmcmonitor.mixins.json:ConnectScreenMixin (from mod mcmonitor)

-- System Details --
\tFabric Mods:
\t\tmcmonitor: MC Monitor 0.1.0
\tSuspected Mods: MC Monitor (mcmonitor)
`;

const HANDLER_REPORT = `---- Minecraft Crash Report ----
Description: Unexpected error

java.lang.NoSuchMethodError: 'java.lang.String net.minecraft.client.multiplayer.resolver.ServerAddress.getHost()'
\tat net.minecraft.client.gui.screens.ConnectScreen.handler$zza000$mcmonitor$rememberAddress(ConnectScreen.java:1040)
\tat net.minecraft.client.gui.screens.ConnectScreen.startConnecting(ConnectScreen.java:64)
`;

const CAUSED_BY = `java.lang.RuntimeException: Unexpected error
\tat net.minecraft.client.Minecraft.run(Minecraft.java:900)
Caused by: java.lang.IllegalArgumentException: bad host
\tat ru.mcmon.plugin.client.PlayFile.read(PlayFile.java:40)
\tat ru.mcmon.plugin.client.fabric.LaunchCodeAnswers.answer(LaunchCodeAnswers.java:22)`;

const unknown: CrashCause = { code: 'unknown' };

function verdict(change: Partial<Parameters<typeof crashedOnClientMod>[0]> = {}): boolean {
  return crashedOnClientMod({
    crashed: true,
    cause: unknown,
    logText: MOD_LIST,
    crashReport: null,
    ...change,
  });
}

describe('crashedOnClientMod: what blames the mod', () => {
  it('a driver crash while ConnectScreen is open is not ours', () => {
    expect(verdict({ crashReport: DRIVER_REPORT })).toBe(false);
  });

  it('a handler that Mixin pasted into the game class is ours', () => {
    expect(verdict({ crashReport: HANDLER_REPORT })).toBe(true);
  });

  it('a frame of our package in the chain of causes is ours', () => {
    expect(
      verdict({ logText: MOD_LIST + event('ERROR', 'Unreported exception thrown!', CAUSED_BY) }),
    ).toBe(true);
    expect(verdict({ crashReport: CAUSED_BY })).toBe(true);
  });

  it('a list of suspected mods or of loaded mods is not a blame', () => {
    expect(
      verdict({ crashReport: 'Suspected Mods: MC Monitor (mcmonitor), Sodium (sodium)' }),
    ).toBe(false);
    expect(verdict({ crashReport: '\tFabric Mods:\n\t\tmcmonitor: MC Monitor 0.1.0' })).toBe(false);
  });

  it('a Mixin warning without a crash is not read', () => {
    const warning = event('WARN', 'Error loading class: from mod mcmonitor', CAUSED_BY);
    expect(verdict({ logText: MOD_LIST + warning })).toBe(false);
  });

  it('our mod that failed to load is ours, a foreign mod that needs ours is not', () => {
    const own = event(
      'ERROR',
      "Incompatible mods found!\n\t - Mod 'MC Monitor' (mcmonitor) 0.1.0 requires version 1.21.12 of 'Minecraft' (minecraft), but only the wrong version is present: 1.21.13!",
    );
    const foreign = event(
      'ERROR',
      "Incompatible mods found!\n\t - Mod 'Sodium Extra' (sodium-extra) 0.5.4 requires any version of 'MC Monitor' (mcmonitor), which is missing!",
    );
    expect(verdict({ logText: MOD_LIST + own })).toBe(true);
    expect(verdict({ logText: MOD_LIST + foreign })).toBe(false);
    expect(
      verdict({
        cause: {
          code: 'mod-dependency',
          mod: 'MC Monitor',
          modId: 'mcmonitor',
          dependency: 'minecraft',
          range: null,
        },
      }),
    ).toBe(true);
    expect(verdict({ cause: { code: 'mod-crash', mod: 'MC Monitor', modId: 'mcmonitor' } })).toBe(
      false,
    );
  });
});

describe('crashedOnClientMod: only at start', () => {
  it('not in the world, not after a minute on the server, not without a crash or a log', () => {
    expect(
      verdict({ crashReport: HANDLER_REPORT, logText: MOD_LIST + event('INFO', '[CHAT] hi') }),
    ).toBe(false);
    const late =
      MOD_LIST + CONNECT + event('INFO', 'Saving chunks', '', START + JOIN_WINDOW_MS + 1);
    expect(verdict({ crashReport: HANDLER_REPORT, logText: late })).toBe(false);
    const quick = MOD_LIST + CONNECT + event('INFO', 'Disconnecting', '', START + 5000);
    expect(verdict({ crashReport: HANDLER_REPORT, logText: quick })).toBe(true);
    expect(verdict({ crashReport: HANDLER_REPORT, crashed: false })).toBe(false);
    expect(verdict({ crashReport: HANDLER_REPORT, logText: null })).toBe(false);
  });
});

describe('ClientModBlocks', () => {
  let root: string;
  let layout: GameLayout;
  const run = { minecraft: '1.21.11', sha256: 'd'.repeat(64) };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mcmonitor-blocks-'));
    layout = gameLayout(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps a block across a restart and only for the same version and jar', async () => {
    await new ClientModBlocks(layout).add(run);
    const again = new ClientModBlocks(layout);
    expect(await again.has(run)).toBe(true);
    expect(await again.has({ ...run, sha256: 'e'.repeat(64) })).toBe(false);
    expect(await again.has({ ...run, minecraft: '1.21.10' })).toBe(false);
  });

  it('a missing file is an empty list, a broken one is started over', async () => {
    expect(await new ClientModBlocks(layout).list()).toEqual([]);
    await mkdir(layout.instances, { recursive: true });
    await writeFile(clientModBlocksFile(layout), '{oops');
    const blocks = new ClientModBlocks(layout);
    await blocks.add(run);
    expect(await new ClientModBlocks(layout).list()).toEqual([run]);
  });

  it('a file that cannot be read is read again later and never written over', async () => {
    const file = clientModBlocksFile(layout);
    await mkdir(file, { recursive: true });
    const blocks = new ClientModBlocks(layout);
    expect(await blocks.has(run)).toBe(false);
    await expect(blocks.add(run)).rejects.toThrow();
    await rm(file, { recursive: true });
    await writeFile(file, JSON.stringify({ schemaVersion: 1, blocked: [run] }));
    expect(await blocks.has(run)).toBe(true);
  });
});
