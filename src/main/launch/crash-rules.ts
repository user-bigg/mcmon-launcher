import type { CrashCause, SystemMemoryKind } from '@shared/crash';

export type CrashSource = 'log' | 'crash-report' | 'jvm-report';

// Offsets of the first join line and the first resource reload in the game log.
export interface LogOrder {
  connectAt: number | null;
  loadAt: number | null;
}

export interface RuleContext {
  logOrder: LogOrder;
  memoryMb: number | null;
  javaMajor: number | null;
  java32: boolean;
}

export interface RuleHit {
  match: RegExpExecArray;
  text: string;
  source: CrashSource;
  context: RuleContext;
}

export interface CrashRule {
  id: string;
  origin: string;
  pattern: RegExp;
  cause: (hit: RuleHit) => CrashCause | null;
}

export interface ExitCodeRule {
  id: string;
  origin: string;
  codes: readonly number[];
  cause: CrashCause;
}

const MOD_REF = String.raw`(?:mod )?(?:'([^']+)' \(([\w.-]+)\)|([\w.-]+))`;
const JAR_PATH =
  /[\\/](mods|libraries|versions)[\\/]((?:[^\\/\r\n'"[\]]+[\\/])*[^\\/\r\n'"[\]]*?\.jar)\b/g;
const JAR_SEARCH_LINES = 6;
const CLASS_VERSION_OFFSET = 44;
const LOG_TAIL_LINES = 60;
const CRASH_REPORT_HEAD = 'A detailed walkthrough of the error';
const NON_HEAP_AREAS =
  /Metaspace|Compressed class space|Direct buffer memory|Requested array size/i;
const MIXIN_CONFIG = String.raw`((?:mixins?\.[\w-]+(?:\.[\w-]+){0,5}|[\w-]+(?:\.[\w-]+){0,5}?\.mixins?(?:\.[\w-]+){0,3})\.json)`;

const CONNECTING = /Connecting to [^\s,]+, \d+/;
const RESOURCES_LOADING = 'Reloading ResourceManager';

export const NO_LOG_ORDER: LogOrder = { connectAt: null, loadAt: null };

export function logOrderOf(text: string, offset = 0): LogOrder {
  const connect = CONNECTING.exec(text)?.index;
  const load = text.indexOf(RESOURCES_LOADING);
  return {
    connectAt: connect === undefined ? null : offset + connect,
    loadAt: load === -1 ? null : offset + load,
  };
}

// 1.16.5 on a slow machine, as seen on a real launch: with --server the game connects before
// its first resource reload, the world arrives without the block atlas and rendering a block
// throws. Without the connect line ahead of the reload the same exception means something else.
function joinedBeforeLoad(order: LogOrder): boolean {
  if (order.connectAt === null) {
    return false;
  }
  return order.loadAt === null || order.connectAt < order.loadAt;
}

function group(hit: RuleHit, index: number): string | null {
  const value = hit.match[index]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function required(hit: RuleHit, index: number): string {
  return group(hit, index) ?? '';
}

function classFileToJava(value: string | null): number | null {
  const major = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(major) && major > CLASS_VERSION_OFFSET
    ? major - CLASS_VERSION_OFFSET
    : null;
}

function leadingNumber(value: string | null): number | null {
  const digits = value === null ? null : /\d+/.exec(value)?.[0];
  return digits === undefined || digits === null ? null : Number.parseInt(digits, 10);
}

export function fabricRange(phrase: string): string | null {
  const text = phrase.trim();
  const rules: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [/^any version$/, (): null => null],
    [/^version (\S+) or later$/, (m): string | null => `≥${m[1] ?? ''}`],
    [/^version (\S+) or earlier$/, (m): string | null => `≤${m[1] ?? ''}`],
    [/^any version after (\S+)$/, (m): string | null => `>${m[1] ?? ''}`],
    [/^any version before (\S+)$/, (m): string | null => `<${m[1] ?? ''}`],
    [/^any (\S+)\.x version$/, (m): string | null => `${m[1] ?? ''}.x`],
    [/^version (\S+)$/, (m): string | null => m[1] ?? null],
    [
      /^any version between (\S+) \((?:in|ex)clusive\) and (\S+) \((?:in|ex)clusive\)$/,
      (m): string | null => `${m[1] ?? ''}–${m[2] ?? ''}`,
    ],
  ];
  for (const [pattern, format] of rules) {
    const match = pattern.exec(text);
    if (match !== null) {
      return format(match);
    }
  }
  return text.length > 0 ? text : null;
}

export function mavenRange(range: string): string | null {
  const text = range.trim();
  if (text.length === 0 || text === '*' || text === '[0,)') {
    return null;
  }
  const lower = /^\[([^,\]]+),\)$/.exec(text);
  if (lower?.[1] !== undefined) {
    return `≥${lower[1]}`;
  }
  const exact = /^\[([^,\]]+)\]$/.exec(text);
  return exact?.[1] ?? text;
}

interface ModName {
  name: string;
  id: string;
}

function fabricRef(hit: RuleHit, first: number): ModName {
  const name = group(hit, first) ?? group(hit, first + 2) ?? '';
  const id = group(hit, first + 1) ?? group(hit, first + 2) ?? name;
  return { name, id: id.toLowerCase() };
}

export function mixinOwner(config: string | null): string | null {
  if (config === null) {
    return null;
  }
  const name = config.replace(/\.json$/i, '');
  const prefixed = /^mixins?\.([\w-]+)/i.exec(name);
  if (prefixed?.[1] !== undefined) {
    return prefixed[1];
  }
  const suffixed = /^(.+?)\.mixins?(?:\.|$)/i.exec(name);
  const owner = suffixed?.[1] ?? name.split('.')[0] ?? '';
  return owner.length > 0 ? owner : null;
}

function linesAround(text: string, index: number, radius: number): string {
  let start = index;
  for (let step = 0; step <= radius && start > 0; step += 1) {
    start = text.lastIndexOf('\n', start - 1);
    if (start === -1) {
      start = 0;
      break;
    }
  }
  let end = index;
  for (let step = 0; step <= radius && end !== -1; step += 1) {
    end = text.indexOf('\n', end + 1);
  }
  return text.slice(start, end === -1 ? undefined : end);
}

// The file path is searched on the error line and its neighbours. Two different files nearby
// means it is unclear which one is corrupted, and then there is no automatic fix.
export function nearbyJar(hit: RuleHit): string | null {
  const around = linesAround(hit.text, hit.match.index, JAR_SEARCH_LINES);
  const found = new Set(
    [...around.matchAll(JAR_PATH)].map((match) => `/${match[1] ?? ''}/${match[2] ?? ''}`),
  );
  return found.size === 1 ? ([...found][0] ?? null) : null;
}

function splitFiles(list: string): string[] {
  return list
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['".]$/g, ''))
    .map((item) => item.split(/[\\/]/).pop() ?? item)
    .filter((item) => item.length > 0);
}

function plainRef(id: string): ModName {
  return { name: id, id: id.toLowerCase() };
}

function dependencyCause(
  mod: ModName | null,
  dependency: ModName,
  range: string | null,
  present: string | null,
): CrashCause {
  const id = dependency.id;
  if (id === 'java') {
    return {
      code: 'java-version',
      direction: 'too-old',
      requiredMajor: leadingNumber(range),
      currentMajor: leadingNumber(present),
    };
  }
  const name = id === 'minecraft' ? 'Minecraft' : dependency.name;
  const modName = mod?.name ?? null;
  const modId = mod?.id ?? null;
  if (present !== null || id === 'minecraft') {
    return { code: 'mod-version', mod: modName, modId, dependency: name, range, present };
  }
  return { code: 'mod-dependency', mod: modName, modId, dependency: name, range };
}

function named(name: string | null, id: string | null): ModName | null {
  if (name === null && id === null) {
    return null;
  }
  return { name: name ?? id ?? '', id: (id ?? name ?? '').toLowerCase() };
}

const systemMemory =
  (kind: SystemMemoryKind) =>
  (hit: RuleHit): CrashCause => ({
    code: 'system-memory',
    memoryMb: hit.context.memoryMb,
    kind,
  });

function lineOf(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end);
}

function lineNumberFromEnd(text: string, index: number): number {
  let count = 0;
  for (
    let cursor = text.indexOf('\n', index);
    cursor !== -1;
    cursor = text.indexOf('\n', cursor + 1)
  ) {
    count += 1;
  }
  return count;
}

// OutOfMemoryError also appears mid-log, after which the game keeps running. The crash cause
// is only the one in the report header, in 'Exception in thread', or at the end of the log.
export function isCrashPosition(hit: RuleHit): boolean {
  if (hit.source === 'jvm-report') {
    return true;
  }
  if (hit.source === 'crash-report') {
    const walkthrough = hit.text.indexOf(CRASH_REPORT_HEAD);
    return walkthrough === -1 || hit.match.index < walkthrough;
  }
  const line = lineOf(hit.text, hit.match.index);
  return (
    line.includes('Exception in thread') ||
    lineNumberFromEnd(hit.text, hit.match.index) < LOG_TAIL_LINES
  );
}

const heap =
  (area: (hit: RuleHit) => string | null) =>
  (hit: RuleHit): CrashCause => {
    const value = area(hit);
    return {
      code: 'out-of-memory',
      memoryMb: hit.context.memoryMb,
      area: value,
      heap: value === null || !NON_HEAP_AREAS.test(value),
    };
  };

const graphics =
  (problem: Extract<CrashCause, { code: 'graphics' }>['problem']) => (): CrashCause => ({
    code: 'graphics',
    problem,
  });

const javaTooNew = (hit: RuleHit): CrashCause => ({
  code: 'java-version',
  direction: 'too-new',
  requiredMajor: null,
  currentMajor: hit.context.javaMajor,
});

const modConflict = (mod: ModName | null, other: ModName | null, mixin: boolean): CrashCause => ({
  code: 'mod-conflict',
  mod: mod?.name ?? null,
  modId: mod?.id ?? null,
  other: other?.name ?? null,
  otherId: other?.id ?? null,
  mixin,
});

export const CRASH_RULES: readonly CrashRule[] = [
  {
    id: 'jvm-insufficient-memory',
    origin: 'HMCL MEMORY_EXCEEDED; Millida launch.rs',
    pattern: /There is insufficient memory for the Java Runtime Environment to continue/,
    cause: systemMemory('insufficient'),
  },
  {
    id: 'jvm-out-of-physical-ram',
    origin: 'HMCL OUT_OF_MEMORY',
    pattern: /The system is out of physical RAM or swap space/,
    cause: systemMemory('insufficient'),
  },
  {
    id: 'jvm-reserve-heap',
    origin: 'HMCL JVM_32BIT; Millida launch.rs',
    pattern: /Could not reserve enough space for (?:\d+KB )?object heap/,
    cause: (hit) => systemMemory(hit.context.java32 ? 'reserve-32bit' : 'reserve')(hit),
  },
  {
    id: 'windows-paging-file',
    origin: 'Millida launch.rs',
    pattern:
      /paging file is too small|Файл подкачки слишком мал|DOS error\/errno=1455\b|error='[^']*' \(DOS error\/errno=1455\)/i,
    cause: systemMemory('paging'),
  },
  {
    id: 'native-thread',
    origin: 'MC Monitor',
    pattern: /OutOfMemoryError: unable to create (?:new )?native thread/,
    cause: systemMemory('threads'),
  },
  {
    id: 'too-small-heap',
    origin: 'HMCL OUT_OF_MEMORY',
    pattern:
      /Too small (?:maximum|initial) heap|Initial heap size set to a larger value than the maximum heap size/,
    cause: heap(() => null),
  },
  {
    id: 'java-heap',
    origin: 'HMCL OUT_OF_MEMORY',
    pattern: /java\.lang\.OutOfMemoryError(?::[ \t]*([^\r\n]+))?/,
    cause: (hit) => (isCrashPosition(hit) ? heap((item) => group(item, 1))(hit) : null),
  },
  {
    id: 'out-of-memory-error',
    origin: 'HMCL OUT_OF_MEMORY',
    pattern: /Out of Memory Error/,
    cause: (hit) => (isCrashPosition(hit) ? heap(() => null)(hit) : null),
  },
  {
    id: 'disk-full',
    origin: 'MC Monitor',
    pattern:
      /No space left on device|There is not enough space on the disk|Недостаточно места на диске|\bENOSPC\b/,
    cause: () => ({ code: 'disk-full' }),
  },
  {
    id: 'class-version',
    origin: 'HMCL TOO_OLD_JAVA',
    pattern:
      /UnsupportedClassVersionError: \S+ has been compiled by a more recent version of the Java Runtime \(class file version (\d+)(?:\.\d+)?\), this version of the Java Runtime only recognizes class file versions up to (\d+)/,
    cause: (hit) => ({
      code: 'java-version',
      direction: 'too-old',
      requiredMajor: classFileToJava(group(hit, 1)),
      currentMajor: classFileToJava(group(hit, 2)) ?? hit.context.javaMajor,
    }),
  },
  {
    id: 'class-version-legacy',
    origin: 'HMCL TOO_OLD_JAVA',
    pattern: /UnsupportedClassVersionError: \S+ : Unsupported major\.minor version (\d+)\.\d+/,
    cause: (hit) => ({
      code: 'java-version',
      direction: 'too-old',
      requiredMajor: classFileToJava(group(hit, 1)),
      currentMajor: hit.context.javaMajor,
    }),
  },
  {
    id: 'corrupt-jar',
    origin: 'MC Monitor',
    pattern: /Invalid or corrupt jarfile ([^\r\n]+)/,
    cause: (hit) => ({ code: 'corrupt-file', file: group(hit, 1) }),
  },
  {
    id: 'sha1-digest',
    origin: 'HMCL FILE_CHANGED',
    pattern: /SecurityException: SHA1 digest error for (\S+)/,
    cause: (hit) => ({ code: 'corrupt-file', file: nearbyJar(hit) ?? group(hit, 1) }),
  },
  {
    id: 'zip-exception',
    origin: 'MC Monitor',
    pattern: /java\.util\.zip\.Zip(?:Exception|Error): [^\r\n]+/,
    cause: (hit) => ({ code: 'corrupt-file', file: nearbyJar(hit) }),
  },
  {
    id: 'opengl-not-supported',
    origin: 'HMCL OPENGL_NOT_SUPPORTED',
    pattern: /The driver does not appear to support OpenGL/,
    cause: graphics('no-opengl'),
  },
  {
    id: 'pixel-format',
    origin: 'HMCL GRAPHICS_DRIVER',
    pattern:
      /Pixel format not accelerated|Couldn't set pixel format|WGL: Failed to (?:retrieve pixel format attributes?|find a suitable pixel format|describe pixel format|set selected pixel format)/,
    cause: graphics('pixel-format'),
  },
  {
    id: 'gl-context',
    origin: 'HMCL GRAPHICS_DRIVER',
    pattern:
      /GLX: Failed to create context|WGL: Failed to create OpenGL context|GLFW error (?:65542|65543)|GLFW error 65544: (?:WGL|GLX|EGL)|org\.lwjgl\.LWJGLException: (?:Could not create context|No OpenGL context found|Pixel format)/,
    cause: graphics('context'),
  },
  {
    id: 'window-not-created',
    origin: 'MC Monitor',
    pattern:
      /(?:IllegalStateException|RuntimeException): Failed to create (?:the GLFW )?window|\/WARN\]: Failed to create window: /,
    cause: graphics('context'),
  },
  {
    id: 'driver-access-violation',
    origin: 'HMCL GRAPHICS_DRIVER',
    pattern:
      /EXCEPTION_ACCESS_VIOLATION[\s\S]{0,4000}?# C {2}\[(?:ig\w*|atio\w*|atig\w*|nvoglv\w*|amdxc\w*)/,
    cause: graphics('driver-crash'),
  },
  {
    id: 'macos-display',
    origin: 'HMCL MACOS_FAILED_TO_FIND_SERVICE_PORT_FOR_DISPLAY',
    pattern: /GLFW error before init: \[0x10008\]Cocoa: Failed to find service port for display/,
    cause: graphics('display'),
  },
  {
    id: 'join-before-load',
    origin: 'MC Monitor',
    pattern: /java\.lang\.NullPointerException: Tesselating block in world/,
    cause: (hit) => (joinedBeforeLoad(hit.context.logOrder) ? { code: 'join-before-load' } : null),
  },

  {
    id: 'fabric-duplicate',
    origin: 'HMCL DUPLICATED_MOD; Millida duplicate_of',
    pattern:
      /(?:Found a duplicate mod|[Dd]uplicate mod:?) '?(?!of\b)([\w.-]+)'?(?: at ([^\r\n]+))?/,
    cause: (hit): CrashCause => {
      const at = group(hit, 2);
      return {
        code: 'mod-duplicate',
        mod: group(hit, 1),
        files: at === null ? [] : splitFiles(at),
      };
    },
  },

  {
    id: 'fabric-missing',
    origin: 'Millida fabric_requirement; Fabric Loader resolution.depends.missing',
    pattern: new RegExp(
      String.raw`'([^']+)' \(([\w.-]+)\) \S+ requires (.+?) of ${MOD_REF}, which is missing!`,
    ),
    cause: (hit) =>
      dependencyCause(
        named(group(hit, 1), group(hit, 2)),
        fabricRef(hit, 4),
        fabricRange(required(hit, 3)),
        null,
      ),
  },
  {
    id: 'fabric-wrong-version',
    origin: 'Millida fabric_requirement; Fabric Loader resolution.depends.mismatch',
    pattern: new RegExp(
      String.raw`'([^']+)' \(([\w.-]+)\) \S+ requires (.+?) of ${MOD_REF}, but only the wrong versions? (?:is|are) present: ([^!\r\n]+)!`,
    ),
    cause: (hit) =>
      dependencyCause(
        named(group(hit, 1), group(hit, 2)),
        fabricRef(hit, 4),
        fabricRange(required(hit, 3)),
        group(hit, 7),
      ),
  },
  {
    id: 'fabric-legacy-missing',
    origin: 'HMCL MOD_RESOLUTION_MISSING, MOD_RESOLUTION_MISSING_MINECRAFT',
    pattern: /Could not find required mod: (\S+) requires \{([\w.-]+) @ \[?([^\]}]*)\]?\}/,
    cause: (hit) =>
      dependencyCause(
        named(group(hit, 1), group(hit, 1)),
        plainRef(required(hit, 2)),
        mavenRange(required(hit, 3)),
        null,
      ),
  },

  {
    id: 'fabric-breaks',
    origin: 'Millida fabric_requirement; Fabric Loader resolution.breaks.invalid',
    pattern: new RegExp(
      String.raw`'([^']+)' \(([\w.-]+)\) \S+ is incompatible with (.+?) of ${MOD_REF}`,
    ),
    cause: (hit) => modConflict(named(group(hit, 1), group(hit, 2)), fabricRef(hit, 4), false),
  },
  {
    id: 'fabric-legacy-conflict',
    origin: 'HMCL MOD_RESOLUTION_CONFLICT',
    pattern: /Found conflicting mods: (\S+) conflicts with (\S+)/,
    cause: (hit) =>
      modConflict(named(group(hit, 1), group(hit, 1)), named(group(hit, 2), group(hit, 2)), false),
  },

  {
    id: 'mixin-mod',
    origin: 'HMCL MIXIN_APPLY_MOD_FAILED; Millida mixin_owner_of',
    pattern: /Mixin apply for mod ([\w.-]+) failed/,
    cause: (hit) => modConflict(named(group(hit, 1), group(hit, 1)), null, true),
  },
  {
    id: 'mixin-config',
    origin: 'HMCL MODMIXIN_FAILURE; Millida mixin_owner_of',
    pattern: new RegExp(
      String.raw`(?:Mixin (?:apply|prepare) failed |MixinApplyError|InvalidInjectionException|InjectionError)[^\r\n]{0,400}?\b${MIXIN_CONFIG}`,
    ),
    cause: (hit): CrashCause => {
      const owner = mixinOwner(group(hit, 1));
      return modConflict(named(owner, owner), null, true);
    },
  },
  {
    id: 'mixin-failed-during',
    origin: 'HMCL MODMIXIN_FAILURE',
    pattern: new RegExp(String.raw`\b${MIXIN_CONFIG}(?::[\w.$]{1,200})?\] FAILED during`),
    cause: (hit): CrashCause => {
      const owner = mixinOwner(group(hit, 1));
      return modConflict(named(owner, owner), null, true);
    },
  },
  {
    id: 'java-too-new',
    origin: 'HMCL JAVA_VERSION_IS_TOO_HIGH, JDK_9',
    pattern:
      /Unsupported class file major version \d+|java\.lang\.ClassCastException: (?:class jdk\.|java\.base\/jdk)|because module java\.base does not export|java\.lang\.NoSuchFieldException: ucp|Unable to make protected final java\.lang\.Class java\.lang\.ClassLoader\.defineClass/,
    cause: javaTooNew,
  },
  {
    id: 'fabric-entrypoint',
    origin: 'HMCL LOADING_CRASHED_FABRIC',
    pattern: /Could not execute entrypoint stage '[^']*' due to errors, provided by '([^']+)'/,
    cause: (hit) => ({ code: 'mod-crash', mod: group(hit, 1), modId: group(hit, 1) }),
  },

  {
    id: 'mod-resolution',
    origin: 'HMCL MOD_RESOLUTION, FABRIC_WARNINGS',
    pattern:
      /Incompatible mods? (?:set|found)!|Mod resolution failed|ModResolutionException|Missing or unsupported mandatory dependencies/,
    cause: () => modConflict(null, null, false),
  },
];

const UINT32 = 2 ** 32;

function signedAndUnsigned(code: number): number[] {
  return [code, code + UINT32];
}

export const EXIT_CODE_RULES: readonly ExitCodeRule[] = [
  {
    id: 'windows-access-violation',
    origin: 'Millida earlyexit.rs',
    codes: signedAndUnsigned(-1073741819),
    cause: { code: 'graphics', problem: 'driver-crash' },
  },
  {
    id: 'windows-stack-buffer-overrun',
    origin: 'Millida earlyexit.rs',
    codes: signedAndUnsigned(-1073740791),
    cause: { code: 'graphics', problem: 'driver-crash' },
  },
  {
    id: 'windows-not-responding',
    origin: 'MC Monitor',
    codes: signedAndUnsigned(-805306369),
    cause: { code: 'graphics', problem: 'not-responding' },
  },
];
