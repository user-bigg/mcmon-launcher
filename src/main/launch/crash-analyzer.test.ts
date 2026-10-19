import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeCrash,
  isClosedByPlayer,
  modFilesFor,
  oldestFirst,
  type CrashInput,
  type CrashVerdict,
} from './crash-analyzer';
import { logOrderOf, mixinOwner } from './crash-rules';
import { gameLogLines } from './game-log';
import { decodeLines } from './text-decode';

const GIB = 1024 ** 3;

function fixture(name: string): string {
  return decodeLines(readFileSync(join(import.meta.dirname, 'fixtures', 'crash', `${name}.txt`)));
}

function input(overrides: Partial<CrashInput> = {}): CrashInput {
  return {
    exit: { code: 1, signal: null },
    stoppedByUser: false,
    logLines: [],
    crashReport: null,
    jvmReport: null,
    memoryMb: 3072,
    totalMemoryBytes: 16 * GIB,
    javaMajor: 21,
    modFiles: [],
    platform: 'win32',
    ...overrides,
  };
}

function adviceOf(verdict: CrashVerdict): string[] {
  return verdict.fixes.flatMap((fix) => (fix.type === 'advice' ? [fix.advice] : []));
}

function fromLog(name: string, overrides: Partial<CrashInput> = {}): CrashInput {
  return input({ logLines: fixture(name).split(/\r?\n/), ...overrides });
}

describe('out of memory', () => {
  it('Java heap: "out of memory", next memory tier is the first fix', () => {
    const verdict = analyzeCrash(fromLog('heap-space'));
    expect(verdict.cause).toEqual({
      code: 'out-of-memory',
      memoryMb: 3072,
      area: 'Java heap space',
      heap: true,
    });
    expect(verdict.rule).toBe('java-heap');
    expect(verdict.evidence).toBe('java.lang.OutOfMemoryError: Java heap space');
    expect(verdict.fixes[0]).toEqual({ type: 'set-memory', mb: 6144 });
    expect(verdict.autoFixable).toBe(true);
  });

  it('Java heap from a crash report', () => {
    const verdict = analyzeCrash(
      input({ crashReport: fixture('crash-report-oom'), exit: { code: -805306369, signal: null } }),
    );
    expect(verdict.cause.code).toBe('out-of-memory');
    expect(verdict.source).toBe('crash-report');
  });

  it('an OutOfMemoryError mid-log, after which the game kept running, is not the cause', () => {
    const lines = [...fixture('heap-space').split('\n'), ...Array<string>(80).fill('[x] tick')];
    const verdict = analyzeCrash(
      input({ logLines: [...lines, 'java.util.zip.ZipException: invalid CEN header'] }),
    );
    expect(verdict.rule).toBe('zip-exception');
  });

  it('Metaspace, direct buffer, array size — no "allocate more" fix', () => {
    for (const area of ['Metaspace', 'Direct buffer memory']) {
      const verdict = analyzeCrash(
        input({ logLines: [`Exception in thread "main" java.lang.OutOfMemoryError: ${area}`] }),
      );
      expect(verdict.cause).toMatchObject({ code: 'out-of-memory', area, heap: false });
      expect(verdict.fixes.some((fix) => fix.type === 'set-memory')).toBe(false);
      expect(verdict.autoFixable).toBe(false);
    }
    const array = analyzeCrash(fromLog('mid-log-oom'));
    expect(array.cause).toMatchObject({ heap: false });
  });

  it('system: does not suggest more memory, lowers it, suggests closing programs, paging file', () => {
    const verdict = analyzeCrash(
      input({
        jvmReport: fixture('hs-err-insufficient'),
        memoryMb: 6144,
        totalMemoryBytes: 8 * GIB,
      }),
    );
    expect(verdict.cause).toEqual({ code: 'system-memory', memoryMb: 6144, kind: 'insufficient' });
    expect(verdict.rule).toBe('jvm-insufficient-memory');
    expect(verdict.fixes.slice(0, 3)).toEqual([
      { type: 'set-memory', mb: 4096 },
      { type: 'advice', advice: 'close-programs' },
      { type: 'advice', advice: 'paging-file' },
    ]);
    const more = verdict.fixes.filter((fix) => fix.type === 'set-memory' && fix.mb > 6144);
    expect(more).toEqual([]);
  });

  it('system: "Could not reserve enough space" and the paging file', () => {
    expect(analyzeCrash(fromLog('jvm-reserve', { memoryMb: 12288 })).rule).toBe('jvm-reserve-heap');
    const paging = analyzeCrash(fromLog('paging-file', { platform: 'darwin' }));
    expect(paging.cause).toMatchObject({ code: 'system-memory', kind: 'paging' });
    expect(paging.fixes).toContainEqual({ type: 'advice', advice: 'paging-file' });
  });

  it('32-bit Java: under 1.5 GB or 64-bit Java, not "2 GB"', () => {
    const verdict = analyzeCrash(fromLog('jvm-reserve', { memoryMb: 2048, arch: 'ia32' }));
    expect(verdict.cause).toMatchObject({ code: 'system-memory', kind: 'reserve-32bit' });
    expect(verdict.fixes.slice(0, 2)).toEqual([
      { type: 'set-memory', mb: 1024 },
      { type: 'advice', advice: 'java-64bit' },
    ]);
    const fromReport = analyzeCrash(
      input({
        logLines: ['Could not reserve enough space for 1572864KB object heap'],
        jvmReport: '# Java VM: OpenJDK 32-Bit Server VM (17.0.9+9, mixed mode, windows-x86)',
        memoryMb: 1024,
      }),
    );
    expect(fromReport.fixes[0]).toEqual({ type: 'advice', advice: 'java-64bit' });
  });

  it('system on macOS has no paging file advice', () => {
    const verdict = analyzeCrash(
      input({ jvmReport: fixture('hs-err-insufficient'), platform: 'darwin', memoryMb: 2048 }),
    );
    expect(verdict.fixes[0]).toEqual({ type: 'advice', advice: 'close-programs' });
    expect(verdict.fixes).not.toContainEqual({ type: 'advice', advice: 'paging-file' });
  });

  it('hit the ceiling: close programs instead of more memory', () => {
    const verdict = analyzeCrash(
      fromLog('heap-space', { memoryMb: 6144, totalMemoryBytes: 8 * GIB }),
    );
    expect(verdict.fixes[0]).toEqual({ type: 'advice', advice: 'close-programs' });
    expect(verdict.autoFixable).toBe(false);
  });
});

describe('Java', () => {
  it('UnsupportedClassVersionError: needs Java 21 instead of 17', () => {
    const verdict = analyzeCrash(fromLog('class-version', { javaMajor: null }));
    expect(verdict.cause).toEqual({
      code: 'java-version',
      direction: 'too-old',
      requiredMajor: 21,
      currentMajor: 17,
    });
    expect(verdict.fixes[0]).toEqual({ type: 'install-java', major: 21 });
    expect(verdict.autoFixable).toBe(true);
  });

  it('Fabric: a mod requires Java 21 but Java 17 is running', () => {
    const verdict = analyzeCrash(fromLog('fabric-java'));
    expect(verdict.rule).toBe('fabric-wrong-version');
    expect(verdict.cause).toEqual({
      code: 'java-version',
      direction: 'too-old',
      requiredMajor: 21,
      currentMajor: 17,
    });
    expect(verdict.fixes[0]).toEqual({ type: 'install-java', major: 21 });
  });

  it('the fix offers a Java version that actually gets installed: 11 → 17, 18 → 21', () => {
    const java11 = analyzeCrash(
      input({
        logLines: [
          'java.lang.UnsupportedClassVersionError: a/B has been compiled by a more recent version of the Java Runtime (class file version 55.0), this version of the Java Runtime only recognizes class file versions up to 52.0',
        ],
      }),
    );
    expect(java11.fixes[0]).toEqual({ type: 'install-java', major: 17 });
    const java18 = analyzeCrash(
      input({
        logLines: [
          'java.lang.UnsupportedClassVersionError: a/B has been compiled by a more recent version of the Java Runtime (class file version 62.0), this version of the Java Runtime only recognizes class file versions up to 61.0',
        ],
      }),
    );
    expect(java18.fixes[0]).toEqual({ type: 'install-java', major: 21 });
  });

  it("an old Java override while the game needs its own — reset Java to the game's version", () => {
    const verdict = analyzeCrash(
      fromLog('class-version', { javaOverride: 17, gameJavaMajor: 21, javaMajor: 17 }),
    );
    expect(verdict.fixes[0]).toEqual({ type: 'reset-java' });
    expect(verdict.autoFixable).toBe(true);
  });

  it('Java too new: with an override — reset it; without one — update the mod', () => {
    const tooNew = fromLog('java-too-new', { javaOverride: 17, gameJavaMajor: 8 });
    const reset = analyzeCrash(tooNew);
    expect(reset.cause).toMatchObject({ code: 'java-version', direction: 'too-new' });
    expect(reset.fixes[0]).toEqual({ type: 'reset-java' });
    const plain = analyzeCrash(fromLog('java-too-new'));
    expect(plain.fixes.map((fix) => fix.type)).toEqual(['advice', 'open-log', 'report']);
  });
});

describe('graphics driver and Windows exit codes', () => {
  it('WGL without OpenGL: update driver, switch to the discrete GPU', () => {
    const verdict = analyzeCrash(fromLog('graphics-wgl'));
    expect(verdict.cause).toEqual({ code: 'graphics', problem: 'no-opengl' });
    expect(verdict.fixes.slice(0, 2)).toEqual([
      { type: 'advice', advice: 'update-driver' },
      { type: 'advice', advice: 'discrete-gpu' },
    ]);
  });

  it('GLFW error 65544 from WGL is a graphics issue with the virtual machine advice', () => {
    const verdict = analyzeCrash(fromLog('graphics-pixel-attributes'));
    expect(verdict.rule).toBe('pixel-format');
    expect(verdict.cause).toEqual({ code: 'graphics', problem: 'pixel-format' });
    expect(verdict.evidence).toContain('GLFW error 65544');
    expect(adviceOf(verdict)).toEqual(['update-driver', 'discrete-gpu', 'vm-graphics']);
  });

  it('the live log of a game the launcher stopped is graphics, whatever Windows appends in its own language', () => {
    const stopped = fromLog('graphics-pixel-attributes', {
      exit: { code: null, signal: 'SIGTERM' },
      virtualMachine: true,
    });
    expect(isClosedByPlayer(stopped)).toBe(false);
    const verdict = analyzeCrash(stopped);
    expect(verdict.cause).toEqual({ code: 'graphics', problem: 'pixel-format' });
    expect(verdict.evidence).toContain('Операция успешно завершена.');
    expect(adviceOf(verdict)[0]).toBe('vm-graphics');
  });

  it('a bare window failure line with a normal exit is still graphics', () => {
    const verdict = analyzeCrash(
      input({
        exit: { code: 0, signal: null },
        logLines: ['[05:06:33] [Render thread/WARN]: Failed to create window: '],
      }),
    );
    expect(verdict.rule).toBe('window-not-created');
    expect(verdict.cause).toEqual({ code: 'graphics', problem: 'context' });
  });

  it('the usual warnings of a nickname launch are never the cause', () => {
    const logLines = [
      '[05:06:14] [Render thread/WARN]: Failed retrieving info for group graphics',
      'java.lang.IllegalStateException: Unexpected registry type 3',
      '[05:06:15] [Render thread/ERROR]: Failed to fetch user properties',
      'com.mojang.authlib.exceptions.MinecraftClientHttpException: Status: 401',
    ];
    expect(analyzeCrash(input({ exit: { code: 0, signal: null }, logLines })).cause).toEqual({
      code: 'closed',
    });
    const crashed = analyzeCrash(input({ logLines }));
    expect(crashed.cause).toEqual({ code: 'unknown' });
    expect(crashed.rule).toBeNull();
  });

  it('a window that did not open is a crash even with exit code 0', () => {
    const quiet = input({
      exit: { code: 0, signal: null },
      logLines: [
        '[19:02:12] [Render thread/WARN]: Failed to create window: ',
        'com.mojang.blaze3d.platform.Window$WindowInitFailed: GLFW error 65544: WGL: Failed to retrieve pixel format attributes',
        '\tat com.mojang.blaze3d.platform.Window.bootCrash(Window.java:204)',
      ],
    });
    expect(isClosedByPlayer(quiet)).toBe(false);
    expect(analyzeCrash(quiet).cause).toEqual({ code: 'graphics', problem: 'pixel-format' });
    expect(isClosedByPlayer(input({ exit: { code: 0, signal: null } }))).toBe(true);
  });

  it('the virtual machine advice: alone in a virtual machine, last when unknown, absent on a real computer', () => {
    const advice = (virtualMachine: boolean | null | undefined): string[] =>
      adviceOf(
        analyzeCrash(
          fromLog(
            'graphics-pixel-attributes',
            virtualMachine === undefined ? {} : { virtualMachine },
          ),
        ),
      );
    expect(advice(true)).toEqual(['vm-graphics']);
    expect(advice(null)).toEqual(['update-driver', 'discrete-gpu', 'vm-graphics']);
    expect(advice(undefined)).toEqual(['update-driver', 'discrete-gpu', 'vm-graphics']);
    expect(advice(false)).toEqual(['update-driver', 'discrete-gpu']);
  });

  it('outside Windows there is no virtual machine advice', () => {
    const verdict = analyzeCrash(
      fromLog('gl-context', { platform: 'linux', virtualMachine: true }),
    );
    expect(adviceOf(verdict)).toEqual(['update-driver']);
  });

  it('GLFW error 65544 with another WGL message is still a graphics issue', () => {
    const verdict = analyzeCrash(
      input({
        logLines: [
          'java.lang.IllegalStateException: GLFW error 65544: WGL: Failed to make context current',
        ],
      }),
    );
    expect(verdict.cause).toEqual({ code: 'graphics', problem: 'context' });
  });

  it('a driver crash gets no virtual machine advice even in a virtual machine', () => {
    const crashed = analyzeCrash(
      input({ exit: { code: -1073741819, signal: null }, virtualMachine: true }),
    );
    expect(adviceOf(crashed)).not.toContain('vm-graphics');
  });

  it('Pixel format not accelerated in an old-style crash report', () => {
    const verdict = analyzeCrash(input({ crashReport: fixture('graphics-pixel') }));
    expect(verdict.cause).toEqual({ code: 'graphics', problem: 'pixel-format' });
  });

  it('LWJGLException without details is not a graphics issue', () => {
    const verdict = analyzeCrash(
      input({ logLines: ['org.lwjgl.LWJGLException: Could not find a native library'] }),
    );
    expect(verdict.cause.code).toBe('unknown');
  });

  it('0xC0000005 and 0xCFFFFFFF without a log: driver issue and "not responding", in both code forms', () => {
    for (const code of [-1073741819, 3221225477]) {
      expect(analyzeCrash(input({ exit: { code, signal: null } })).rule).toBe(
        'windows-access-violation',
      );
    }
    const hung = analyzeCrash(input({ exit: { code: -805306369, signal: null } }));
    expect(hung.cause).toEqual({ code: 'graphics', problem: 'not-responding' });
  });

  it('closing the console window as an unsigned code is still a close', () => {
    expect(isClosedByPlayer(input({ exit: { code: 3221225786, signal: null } }))).toBe(true);
    expect(isClosedByPlayer(input({ exit: { code: -1073741510, signal: null } }))).toBe(true);
  });
});

describe('mods', () => {
  it('duplicate — the older version is disabled, not the newer one', () => {
    const files = ['lithium-fabric-0.14.3+mc1.21.1.jar', 'lithium-fabric-0.13.1+mc1.21.1.jar'];
    const verdict = analyzeCrash(fromLog('fabric-duplicate', { modFiles: files }));
    expect(verdict.cause).toMatchObject({ code: 'mod-duplicate', mod: 'lithium' });
    expect(verdict.fixes[0]).toEqual({
      type: 'disable-mod',
      file: 'lithium-fabric-0.13.1+mc1.21.1.jar',
    });
    expect(verdict.fixes[1]).toEqual({ type: 'open-folder', folder: 'mods' });
  });

  it('sorts duplicates by the version in the filename', () => {
    expect(
      oldestFirst(['lithium-0.14.3.jar', 'lithium-0.13.10.jar', 'lithium-0.13.9.jar']),
    ).toEqual(['lithium-0.13.9.jar', 'lithium-0.13.10.jar', 'lithium-0.14.3.jar']);
  });

  it('Fabric: missing dependency — mod name and dependency', () => {
    const verdict = analyzeCrash(
      fromLog('fabric-missing', { modFiles: ['modmenu-11.0.3.jar', 'iris-1.8.1.jar'] }),
    );
    expect(verdict.cause).toEqual({
      code: 'mod-dependency',
      mod: 'Mod Menu',
      modId: 'modmenu',
      dependency: 'fabric-api',
      range: null,
    });
    expect(verdict.fixes[0]).toEqual({ type: 'advice', advice: 'install-dependency' });
    expect(verdict.fixes[1]).toEqual({ type: 'disable-mod', file: 'modmenu-11.0.3.jar' });
    expect(verdict.autoFixable).toBe(false);
  });

  it('Fabric: a mod built for a different game version', () => {
    const verdict = analyzeCrash(
      fromLog('fabric-minecraft-version', {
        modFiles: ['sodium-fabric-0.5.3+mc1.20.1.jar', 'sodium-extra-0.5.1+mc1.20.1.jar'],
      }),
    );
    expect(verdict.cause).toEqual({
      code: 'mod-version',
      mod: 'Sodium',
      modId: 'sodium',
      dependency: 'Minecraft',
      range: '1.20.1',
      present: '1.20.4',
    });
    expect(verdict.fixes[0]).toEqual({
      type: 'disable-mod',
      file: 'sodium-fabric-0.5.3+mc1.20.1.jar',
    });
  });

  it('Fabric: incompatible mods — disable both, one at a time', () => {
    const verdict = analyzeCrash(
      fromLog('fabric-breaks', { modFiles: ['iris-1.8.1.jar', 'optifabric-1.14.3.jar'] }),
    );
    expect(verdict.cause).toEqual({
      code: 'mod-conflict',
      mod: 'Iris',
      modId: 'iris',
      other: 'OptiFabric',
      otherId: 'optifabric',
      mixin: false,
    });
    expect(verdict.fixes.slice(0, 2)).toEqual([
      { type: 'disable-mod', file: 'iris-1.8.1.jar' },
      { type: 'disable-mod', file: 'optifabric-1.14.3.jar' },
    ]);
  });

  it('modmenu crashed — modmenu is disabled, not a mod whose name starts the same', () => {
    const files = ['modmenu-badges-1.0.jar', 'modmenu-11.0.3.jar'];
    const verdict = analyzeCrash(fromLog('fabric-entrypoint', { modFiles: files }));
    expect(verdict.cause).toMatchObject({ code: 'mod-crash', modId: 'modmenu' });
    expect(verdict.fixes[0]).toEqual({ type: 'disable-mod', file: 'modmenu-11.0.3.jar' });
  });

  it('Mixin: owner determined by the config name', () => {
    const verdict = analyzeCrash(
      fromLog('mixin', { modFiles: ['sodium-fabric-0.6.0+mc1.21.1.jar', 'lithium-0.15.0.jar'] }),
    );
    expect(verdict.cause).toMatchObject({ code: 'mod-conflict', mod: 'sodium', mixin: true });
    expect(verdict.fixes[0]).toEqual({
      type: 'disable-mod',
      file: 'sodium-fabric-0.6.0+mc1.21.1.jar',
    });
  });

  it('an error in sodium-extra.mixins.json disables sodium-extra, not sodium', () => {
    const verdict = analyzeCrash(
      fromLog('mixin-sodium-extra', {
        modFiles: ['sodium-fabric-0.6.0+mc1.21.1.jar', 'sodium-extra-0.6.0+mc1.21.1.jar'],
      }),
    );
    expect(verdict.cause).toMatchObject({ mod: 'sodium-extra' });
    expect(verdict.fixes[0]).toEqual({
      type: 'disable-mod',
      file: 'sodium-extra-0.6.0+mc1.21.1.jar',
    });
  });

  it('Mixin owner: .mixins suffix, mixins. prefix', () => {
    expect(mixinOwner('sodium-extra.mixins.json')).toBe('sodium-extra');
    expect(mixinOwner('mixins.iris.json')).toBe('iris');
    expect(mixinOwner('create.mixins.client.json')).toBe('create');
    expect(mixinOwner('lithium.mixins.json')).toBe('lithium');
    expect(analyzeCrash(fromLog('mixin-prefixed')).cause).toMatchObject({ mod: 'iris' });
  });

  it('several matching files — no automatic fix', () => {
    const verdict = analyzeCrash(
      fromLog('mixin', { modFiles: ['sodium-0.6.0.jar', 'sodium-fabric-0.6.0+mc1.21.1.jar'] }),
    );
    expect(verdict.fixes.some((fix) => fix.type === 'disable-mod')).toBe(false);
    expect(verdict.autoFixable).toBe(false);
  });

  it('shared dependencies are not disabled', () => {
    const verdict = analyzeCrash(
      input({
        logLines: [
          "Mod 'Fabric API' (fabric-api) 0.92.0 is incompatible with any version of mod 'Sodium' (sodium), yet a conflicting version is present: 0.5.3!",
        ].map((line) => `\t - ${line}`),
        modFiles: ['fabric-api-0.92.0+1.20.1.jar', 'sodium-fabric-0.5.3+mc1.20.1.jar'],
      }),
    );
    expect(verdict.fixes.filter((fix) => fix.type === 'disable-mod')).toEqual([
      { type: 'disable-mod', file: 'sodium-fabric-0.5.3+mc1.20.1.jar' },
    ]);
  });

  it('mod name matches the whole filename, not just its start', () => {
    const files = [
      'Sodium-Fabric-0.6.0.jar',
      'sodium-extra-0.6.0.jar',
      'iris-1.8.1.jar',
      'modmenu-11.jar',
      'create-1.20.1-0.5.1.f.jar',
      'createaddition-1.20.1-1.2.4.jar',
      'Sodium (fabric) 0.5.jar',
    ];
    expect(modFilesFor('Mod Menu', files)).toEqual(['modmenu-11.jar']);
    expect(modFilesFor('sodium', files)).toEqual([
      'Sodium-Fabric-0.6.0.jar',
      'Sodium (fabric) 0.5.jar',
    ]);
    expect(modFilesFor('sodium-extra', files)).toEqual(['sodium-extra-0.6.0.jar']);
    expect(modFilesFor('create', files)).toEqual(['create-1.20.1-0.5.1.f.jar']);
    expect(modFilesFor('createaddition', files)).toEqual(['createaddition-1.20.1-1.2.4.jar']);
    expect(modFilesFor('mods/iris-1.8.1.jar', files)).toEqual(['iris-1.8.1.jar']);
    expect(modFilesFor('ab', files)).toEqual([]);
    expect(modFilesFor(null, files)).toEqual([]);
  });
});

describe('files and disk', () => {
  it('corrupt mod: disable the file in mods', () => {
    const verdict = analyzeCrash(fromLog('zip-mod', { modFiles: ['create-1.20.1-0.5.1.f.jar'] }));
    expect(verdict.cause.code).toBe('corrupt-file');
    expect(verdict.fixes[0]).toEqual({ type: 'disable-mod', file: 'create-1.20.1-0.5.1.f.jar' });
  });

  it('corrupt library: re-download it, path relative to the data folder', () => {
    const verdict = analyzeCrash(fromLog('zip-library'));
    expect(verdict.cause.code).toBe('corrupt-file');
    expect(verdict.fixes[0]).toEqual({
      type: 'remove-file',
      path: 'libraries/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar',
    });
  });

  it('two files near the error — unclear which is corrupt, no fix offered', () => {
    const verdict = analyzeCrash(
      input({
        logLines: [
          'java.util.zip.ZipException: zip END header not found',
          'Mod file /game/mods/a-1.0.jar is broken',
          'Mod file /game/mods/b-1.0.jar is broken',
        ],
        modFiles: ['a-1.0.jar', 'b-1.0.jar'],
      }),
    );
    expect(verdict.cause).toEqual({ code: 'corrupt-file', file: null });
    expect(verdict.autoFixable).toBe(false);
  });

  it('a path with spaces and parentheses before the error', () => {
    const verdict = analyzeCrash(
      input({
        logLines: [
          'Failed to read C:\\Users\\Иван Петров\\game\\mods\\Sodium (fabric) 0.5.jar',
          'java.util.zip.ZipException: invalid CEN header (bad entry name)',
        ],
        modFiles: ['Sodium (fabric) 0.5.jar'],
      }),
    );
    expect(verdict.fixes[0]).toEqual({ type: 'disable-mod', file: 'Sodium (fabric) 0.5.jar' });
  });

  it('Invalid or corrupt jarfile', () => {
    const verdict = analyzeCrash(
      input({
        logLines: ['Error: Invalid or corrupt jarfile /games/mc/versions/1.21.11/1.21.11.jar'],
      }),
    );
    expect(verdict.cause).toEqual({
      code: 'corrupt-file',
      file: '/games/mc/versions/1.21.11/1.21.11.jar',
    });
    expect(verdict.fixes[0]).toEqual({ type: 'remove-file', path: 'versions/1.21.11/1.21.11.jar' });
  });

  it('no disk space left, including a Russian cp1251 message', () => {
    const verdict = analyzeCrash(fromLog('disk-full'));
    expect(verdict.cause).toEqual({ code: 'disk-full' });
    expect(verdict.fixes[0]).toEqual({ type: 'advice', advice: 'free-disk' });
    expect(analyzeCrash(fromLog('disk-full-ru')).cause).toEqual({ code: 'disk-full' });
  });

  it('paging file in Russian: both in hs_err and in the output', () => {
    expect(analyzeCrash(input({ jvmReport: fixture('hs-err-paging-ru') })).rule).toBe(
      'jvm-insufficient-memory',
    );
    const russian = analyzeCrash(fromLog('paging-ru-only'));
    expect(russian.rule).toBe('windows-paging-file');
    expect(russian.evidence).toContain('Файл подкачки слишком мал');
  });
});

describe('chat', () => {
  it('[CHAT] and [System] [CHAT] lines are not treated as a crash cause', () => {
    const raw = fixture('chat-injection');
    const lines = gameLogLines(raw, { dropChat: true });
    expect(lines.some((line) => line.includes('[CHAT]'))).toBe(false);
    const verdict = analyzeCrash(input({ logLines: lines, exit: { code: 0, signal: null } }));
    expect(verdict.cause).toEqual({ code: 'closed' });
    const crashed = analyzeCrash(input({ logLines: lines }));
    expect(crashed.cause).toEqual({ code: 'unknown' });
  });
});

describe('rule conflicts', () => {
  it('system memory outranks heap: hs_err has both "insufficient memory" and "Out of Memory Error"', () => {
    const verdict = analyzeCrash(input({ jvmReport: fixture('hs-err-insufficient') }));
    expect(verdict.cause.code).toBe('system-memory');
  });

  it('duplicate outranks the generic "Mod resolution" rule', () => {
    const verdict = analyzeCrash(fromLog('fabric-duplicate'));
    expect(verdict.rule).toBe('fabric-duplicate');
  });

  it("a mod's Mixin outranks a config Mixin on the same line", () => {
    expect(analyzeCrash(fromLog('mixin-mod')).rule).toBe('mixin-mod');
  });

  it('"duplicate mod of" does not yield a mod named "of"', () => {
    const verdict = analyzeCrash(input({ logLines: ['Found a duplicate mod of something'] }));
    expect(verdict.cause).not.toMatchObject({ mod: 'of' });
  });
});

describe('a game stopped while its own error dialog was up', () => {
  const quiet = ['[12:00:01] [Render thread/INFO]: Backend library: LWJGL version 3.3.3+5'];

  it('a game stopped from its dialog is not a player close; without a matching line the cause is graphics', () => {
    const stopped = input({
      logLines: quiet,
      exit: { code: null, signal: 'SIGTERM' },
      gameDialog: true,
    });
    expect(isClosedByPlayer(stopped)).toBe(false);
    expect(analyzeCrash(stopped).cause).toEqual({ code: 'graphics', problem: 'context' });
  });

  it('names the dialog as its rule, so the details can say what happened without a line', () => {
    const verdict = analyzeCrash(
      input({ logLines: quiet, exit: { code: null, signal: 'SIGTERM' }, gameDialog: true }),
    );
    expect(verdict.rule).toBe('game-dialog');
    expect(verdict.evidence).toBeNull();
  });

  it('a line in the log still names the cause', () => {
    const verdict = analyzeCrash(
      fromLog('graphics-pixel-attributes', {
        exit: { code: null, signal: 'SIGTERM' },
        gameDialog: true,
      }),
    );
    expect(verdict.rule).toBe('pixel-format');
  });

  it('the same stop without the dialog stays the player closing the game', () => {
    const closed = input({ logLines: quiet, exit: { code: null, signal: 'SIGTERM' } });
    expect(analyzeCrash(closed).cause).toEqual({ code: 'closed' });
  });
});

describe('joining a server before the game has loaded', () => {
  const lines = (): string[] => fixture('join-before-load').split(/\r?\n/);
  const connecting = (line: string): boolean => line.includes('Connecting to play.example.net');

  it('the live 1.16.5 crash on a slow machine: its own cause and a launch without the join', () => {
    const verdict = analyzeCrash(fromLog('join-before-load', { exit: { code: -1, signal: null } }));
    expect(verdict.rule).toBe('join-before-load');
    expect(verdict.cause).toEqual({ code: 'join-before-load' });
    expect(verdict.evidence).toBe('java.lang.NullPointerException: Tesselating block in world');
    expect(verdict.fixes.map((fix) => fix.type)).toEqual([
      'launch-without-join',
      'open-log',
      'report',
    ]);
    expect(verdict.autoFixable).toBe(true);
  });

  it('reads the order from the head of the log when the tail no longer has the connect line', () => {
    const all = lines();
    const tail = all.filter((line) => !connecting(line));
    const verdict = analyzeCrash(input({ logLines: tail, logOrder: logOrderOf(all.join('\n')) }));
    expect(verdict.rule).toBe('join-before-load');
  });

  it('the same exception without a join ahead of the resource load is not this cause', () => {
    const all = lines();
    const withoutJoin = analyzeCrash(input({ logLines: all.filter((line) => !connecting(line)) }));
    expect(withoutJoin.cause.code).toBe('unknown');
    const connect = all.findIndex(connecting);
    const reordered = [
      ...all.slice(0, connect),
      ...all.slice(connect + 2).filter((line) => !line.includes('Tesselating')),
      all[connect] ?? '',
      'java.lang.NullPointerException: Tesselating block in world',
    ];
    expect(analyzeCrash(input({ logLines: reordered })).cause.code).toBe('unknown');
  });
});

describe('closed or unknown', () => {
  it('closed manually: launcher stop, 143, SIGTERM, normal exit', () => {
    expect(analyzeCrash(fromLog('normal-exit', { exit: { code: 0, signal: null } })).cause).toEqual(
      { code: 'closed' },
    );
    expect(analyzeCrash(fromLog('heap-space', { stoppedByUser: true })).cause.code).toBe('closed');
    expect(
      analyzeCrash(fromLog('normal-exit', { exit: { code: 143, signal: null } })).cause.code,
    ).toBe('closed');
    expect(
      analyzeCrash(fromLog('normal-exit', { exit: { code: null, signal: 'SIGTERM' } })).fixes,
    ).toEqual([]);
  });

  it('exit code 0 but the log has a crash report — it is still a crash', () => {
    const verdict = analyzeCrash(
      input({ exit: { code: 0, signal: null }, crashReport: fixture('crash-report-oom') }),
    );
    expect(verdict.cause.code).toBe('out-of-memory');
  });

  it('launcher stop after a crash with a report — it is still a crash', () => {
    const verdict = analyzeCrash(
      input({ stoppedByUser: true, crashReport: fixture('crash-report-oom') }),
    );
    expect(verdict.cause.code).toBe('out-of-memory');
  });

  it('unknown: with the log, the crash-reports folder and a report', () => {
    const verdict = analyzeCrash(fromLog('unknown'));
    expect(verdict.cause).toEqual({ code: 'unknown' });
    expect(verdict.rule).toBeNull();
    expect(verdict.fixes).toEqual([{ type: 'open-log' }, { type: 'report' }]);
    const withReport = analyzeCrash(
      fromLog('unknown', { crashReport: '---- Minecraft Crash Report ----' }),
    );
    expect(withReport.fixes[0]).toEqual({ type: 'open-folder', folder: 'crash-reports' });
  });

  it('the log and report fixes always come last', () => {
    for (const name of ['heap-space', 'class-version', 'graphics-wgl', 'fabric-duplicate']) {
      const fixes = analyzeCrash(fromLog(name)).fixes;
      expect(fixes.slice(-2)).toEqual([{ type: 'open-log' }, { type: 'report' }]);
    }
  });
});
