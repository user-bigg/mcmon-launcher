import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CrashCause } from '@shared/crash';
import { analyzeCrash, type CrashInput } from './crash-analyzer';
import { CRASH_RULES, EXIT_CODE_RULES, fabricRange, mavenRange } from './crash-rules';
import { decodeLines } from './text-decode';

const GIB = 1024 ** 3;

function fixture(name: string): string {
  return decodeLines(readFileSync(join(import.meta.dirname, 'fixtures', 'crash', `${name}.txt`)));
}

type Where = 'log' | 'crash-report' | 'jvm-report';

interface RuleCase {
  rule: string;
  fixture: string;
  where?: Where;
  cause: Partial<CrashCause> & { code: CrashCause['code'] };
  overrides?: Partial<CrashInput>;
}

const CASES: RuleCase[] = [
  {
    rule: 'jvm-insufficient-memory',
    fixture: 'hs-err-insufficient',
    where: 'jvm-report',
    cause: { code: 'system-memory', kind: 'insufficient' },
  },
  {
    rule: 'jvm-out-of-physical-ram',
    fixture: 'hs-err-physical',
    where: 'jvm-report',
    cause: { code: 'system-memory' },
  },
  {
    rule: 'jvm-reserve-heap',
    fixture: 'jvm-reserve',
    cause: { code: 'system-memory', kind: 'reserve' },
  },
  {
    rule: 'windows-paging-file',
    fixture: 'paging-file',
    cause: { code: 'system-memory', kind: 'paging' },
  },
  {
    rule: 'native-thread',
    fixture: 'native-thread',
    cause: { code: 'system-memory', kind: 'threads' },
  },
  {
    rule: 'too-small-heap',
    fixture: 'too-small-heap',
    cause: { code: 'out-of-memory', heap: true },
  },
  {
    rule: 'java-heap',
    fixture: 'heap-space',
    cause: { code: 'out-of-memory', area: 'Java heap space' },
  },
  {
    rule: 'out-of-memory-error',
    fixture: 'oom-screen',
    cause: { code: 'out-of-memory', area: null },
  },
  { rule: 'disk-full', fixture: 'disk-full-ru', cause: { code: 'disk-full' } },
  { rule: 'join-before-load', fixture: 'join-before-load', cause: { code: 'join-before-load' } },
  {
    rule: 'class-version',
    fixture: 'class-version',
    cause: { code: 'java-version', requiredMajor: 21 },
  },
  {
    rule: 'class-version-legacy',
    fixture: 'class-version-legacy',
    cause: { code: 'java-version', requiredMajor: 8 },
  },
  {
    rule: 'corrupt-jar',
    fixture: 'corrupt-jar',
    cause: { code: 'corrupt-file', file: 'C:\\Games\\MC\\versions\\1.21.11\\1.21.11.jar' },
  },
  {
    rule: 'sha1-digest',
    fixture: 'sha1-digest',
    cause: {
      code: 'corrupt-file',
      file: '/libraries/net/minecraft/client/1.20.1-20230612.114412/client-1.20.1-20230612.114412-srg.jar',
    },
  },
  { rule: 'zip-exception', fixture: 'zip-library', cause: { code: 'corrupt-file' } },
  {
    rule: 'opengl-not-supported',
    fixture: 'graphics-wgl',
    cause: { code: 'graphics', problem: 'no-opengl' },
  },
  {
    rule: 'pixel-format',
    fixture: 'graphics-pixel',
    where: 'crash-report',
    cause: { code: 'graphics', problem: 'pixel-format' },
  },
  { rule: 'gl-context', fixture: 'gl-context', cause: { code: 'graphics', problem: 'context' } },
  {
    rule: 'window-not-created',
    fixture: 'window-not-created',
    cause: { code: 'graphics', problem: 'context' },
  },
  {
    rule: 'driver-access-violation',
    fixture: 'hs-err-driver',
    where: 'jvm-report',
    cause: { code: 'graphics', problem: 'driver-crash' },
  },
  {
    rule: 'macos-display',
    fixture: 'macos-display',
    cause: { code: 'graphics', problem: 'display' },
  },

  {
    rule: 'fabric-duplicate',
    fixture: 'fabric-duplicate',
    cause: {
      code: 'mod-duplicate',
      mod: 'lithium',
      files: ['lithium-fabric-0.13.1+mc1.21.1.jar', 'lithium-fabric-0.14.3+mc1.21.1.jar'],
    },
  },

  {
    rule: 'fabric-missing',
    fixture: 'fabric-missing',
    cause: { code: 'mod-dependency', dependency: 'fabric-api' },
  },
  {
    rule: 'fabric-wrong-version',
    fixture: 'fabric-minecraft-version',
    cause: { code: 'mod-version', dependency: 'Minecraft' },
  },
  {
    rule: 'fabric-legacy-missing',
    fixture: 'fabric-legacy-missing',
    cause: { code: 'mod-dependency', mod: 'appleskin', dependency: 'fabric', range: '>=0.28.0' },
  },

  {
    rule: 'fabric-breaks',
    fixture: 'fabric-breaks',
    cause: { code: 'mod-conflict', mod: 'Iris', other: 'OptiFabric' },
  },
  {
    rule: 'fabric-legacy-conflict',
    fixture: 'fabric-legacy-conflict',
    cause: { code: 'mod-conflict', mod: 'optifabric', other: 'sodium' },
  },

  {
    rule: 'mixin-mod',
    fixture: 'mixin-mod',
    cause: { code: 'mod-conflict', mod: 'create', mixin: true },
  },
  {
    rule: 'mixin-config',
    fixture: 'mixin-prefixed',
    cause: { code: 'mod-conflict', mod: 'iris', mixin: true },
  },
  {
    rule: 'mixin-failed-during',
    fixture: 'mixin-failed-during',
    cause: { code: 'mod-conflict', mod: 'lithium', mixin: true },
  },
  {
    rule: 'java-too-new',
    fixture: 'java-too-new',
    cause: { code: 'java-version', direction: 'too-new' },
  },
  {
    rule: 'fabric-entrypoint',
    fixture: 'fabric-entrypoint',
    cause: { code: 'mod-crash', mod: 'modmenu' },
  },

  { rule: 'mod-resolution', fixture: 'mod-resolution', cause: { code: 'mod-conflict', mod: null } },
];

function caseInput(item: RuleCase): CrashInput {
  const text = fixture(item.fixture);
  const where = item.where ?? 'log';
  return {
    exit: { code: 1, signal: null },
    stoppedByUser: false,
    logLines: where === 'log' ? text.split('\n') : [],
    crashReport: where === 'crash-report' ? text : null,
    jvmReport: where === 'jvm-report' ? text : null,
    memoryMb: 3072,
    totalMemoryBytes: 16 * GIB,
    javaMajor: 17,
    modFiles: [],
    platform: 'win32',
    ...item.overrides,
  };
}

describe('each rule has its own fixture', () => {
  it('every rule in the table has a matching fixture case', () => {
    const covered = new Set(CASES.map((item) => item.rule));
    expect(CRASH_RULES.map((rule) => rule.id).filter((id) => !covered.has(id))).toEqual([]);
    expect(CASES).toHaveLength(CRASH_RULES.length);
  });

  it.each(CASES)('$rule', (item) => {
    const verdict = analyzeCrash(caseInput(item));
    expect(verdict.rule).toBe(item.rule);
    expect(verdict.cause).toMatchObject(item.cause);
    expect(verdict.evidence?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('rules table', () => {
  it('rules have unique ids, patterns without the g flag', () => {
    const ids = [...CRASH_RULES, ...EXIT_CODE_RULES].map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of CRASH_RULES) {
      expect(rule.pattern.flags, rule.id).not.toContain('g');
    }
  });

  it('Fabric and Maven version ranges', () => {
    expect(fabricRange('any version')).toBeNull();
    expect(fabricRange('version 0.6.0 or later')).toBe('≥0.6.0');
    expect(fabricRange('version 1.20.1')).toBe('1.20.1');
    expect(fabricRange('any 1.21.x version')).toBe('1.21.x');
    expect(fabricRange('any version between 1.0 (inclusive) and 2.0 (exclusive)')).toBe('1.0–2.0');
    expect(mavenRange('[9.1.12,)')).toBe('≥9.1.12');
    expect(mavenRange('[1.0]')).toBe('1.0');
    expect(mavenRange('*')).toBeNull();
  });
});
