import {
  GAME_DIALOG_RULE,
  isAutomaticFix,
  WINDOW_GRAPHICS_PROBLEMS,
  type CrashCause,
  type CrashExit,
  type CrashFix,
} from '@shared/crash';
import { lowerMemoryStepMb, memoryCeilingMb, nextMemoryStepMb } from '@shared/memory';
import {
  CRASH_RULES,
  EXIT_CODE_RULES,
  type CrashRule,
  type CrashSource,
  type RuleContext,
  logOrderOf,
  type LogOrder,
} from './crash-rules';
import { javaMajorFor } from './java-components';
import { isWindowFailure } from './window-signs';

export type { CrashSource } from './crash-rules';

export interface CrashInput {
  exit: CrashExit;
  stoppedByUser: boolean;
  gameDialog?: boolean;
  logLines: string[];
  logOrder?: LogOrder;
  crashReport: string | null;
  jvmReport: string | null;
  memoryMb: number | null;
  totalMemoryBytes: number;
  javaMajor: number | null;
  modFiles: string[];
  platform: NodeJS.Platform;
  arch?: string;
  virtualMachine?: boolean | null;
  gameJavaMajor?: number | null;
  javaOverride?: number | null;
}

export interface CrashVerdict {
  cause: CrashCause;
  rule: string | null;
  source: CrashSource | null;
  evidence: string | null;
  fixes: CrashFix[];
  autoFixable: boolean;
}

interface RuleMatch {
  rule: { id: string };
  cause: CrashCause;
  source: CrashSource | null;
  evidence: string | null;
}

const EVIDENCE_MAX = 300;
const DUPLICATE_FIX_LIMIT = 2;
const JAVA_32_MAX_MB = 1024;
const MIN_NAME_KEY = 3;

const NORMAL_EXIT_CODES = new Set([0, 130, 143, -1073741510, 3221225786]);
const NORMAL_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP']);
const CRASH_MARKERS = [
  '---- Minecraft Crash Report ----',
  '#@!@# Game crashed!',
  'Reported exception thrown!',
  'Unreported exception thrown!',
  'Exception in thread "main"',
  'Error occurred during initialization of VM',
  'A fatal error has been detected by the Java Runtime Environment',
  'Could not create the Java Virtual Machine',
];
const GAME_FILE_ROOTS = ['libraries', 'versions', 'assets'] as const;
const CLOSING_FIXES: CrashFix[] = [{ type: 'open-log' }, { type: 'report' }];
const MOD_EXTENSION = /\.(?:jar|zip|litemod)$/i;
const VERSION_START = /[-_+ ](?=v?\d)|(?<=[a-z])(?=\d+\.\d)/i;
const LOADER_SUFFIX =
  /[-_ ](?:fabric|forge|neoforge|quilt|mc)$|\s*\((?:fabric|forge|neoforge|quilt)\)$/i;
const SHARED_DEPENDENCIES = new Set([
  'minecraft',
  'java',
  'fabricloader',
  'fabric',
  'fabricapi',
  'fabriclanguagekotlin',
  'quiltloader',
  'quiltedfabricapi',
  'qsl',
  'forge',
  'neoforge',
  'fml',
  'javafml',
  'architectury',
  'architecturyapi',
  'clothconfig',
  'clothconfigapi',
  'kotlinforforge',
  'geckolib',
  'balm',
  'yacl',
  'yetanotherconfiglib',
]);

export function maxMemoryMb(totalMemoryBytes: number): number {
  return memoryCeilingMb(totalMemoryBytes);
}

export function suggestMoreMemory(current: number | null, totalMemoryBytes: number): number | null {
  return nextMemoryStepMb(current, totalMemoryBytes);
}

export function suggestLessMemory(current: number | null): number | null {
  return lowerMemoryStepMb(current);
}

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function modNamePart(file: string): string {
  const stem = file.replace(MOD_EXTENSION, '');
  const cut = VERSION_START.exec(stem);
  return cut === null ? stem : stem.slice(0, cut.index);
}

function fileKeys(file: string): string[] {
  const name = modNamePart(file);
  return [squash(name), squash(name.replace(LOADER_SUFFIX, ''))];
}

export function isSharedDependency(name: string | null): boolean {
  return name !== null && SHARED_DEPENDENCIES.has(squash(name));
}

// A mod name from the log is matched against the whole file name, not its prefix: otherwise
// 'create' matches createaddition and 'sodium' matches sodium-extra.
export function modFilesFor(name: string | null, modFiles: string[]): string[] {
  if (name === null) {
    return [];
  }
  const fileName = baseName(name.trim());
  if (modFiles.includes(fileName)) {
    return [fileName];
  }
  const wanted = squash(fileName.replace(MOD_EXTENSION, ''));
  if (wanted.length < MIN_NAME_KEY) {
    return [];
  }
  return modFiles.filter((file) => fileKeys(file).includes(wanted));
}

function modFilesForAny(names: (string | null | undefined)[], modFiles: string[]): string[] {
  for (const name of names) {
    const files = modFilesFor(name ?? null, modFiles);
    if (files.length > 0) {
      return files;
    }
  }
  return [];
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  const line = text.slice(start, end === -1 ? undefined : end).trim();
  return line.length > EVIDENCE_MAX ? `${line.slice(0, EVIDENCE_MAX - 1)}…` : line;
}

function sources(input: CrashInput): [CrashSource, string][] {
  const list: [CrashSource, string | null][] = [
    ['crash-report', input.crashReport],
    ['jvm-report', input.jvmReport],
    ['log', input.logLines.join('\n')],
  ];
  return list.filter((item): item is [CrashSource, string] => item[1] !== null && item[1] !== '');
}

function matchRule(
  rule: CrashRule,
  texts: [CrashSource, string][],
  context: RuleContext,
): RuleMatch | null {
  const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace('g', '')}g`);
  for (const [source, text] of texts) {
    for (const match of text.matchAll(pattern)) {
      const cause = rule.cause({ match, text, source, context });
      if (cause !== null) {
        return { rule, cause, source, evidence: lineAt(text, match.index) };
      }
    }
  }
  return null;
}

export function isJava32(input: Pick<CrashInput, 'arch' | 'jvmReport'>): boolean {
  return (
    input.arch === 'ia32' ||
    /\b32-Bit (?:Server|Client) VM\b|Java HotSpot\(TM\) Client VM/.test(input.jvmReport ?? '')
  );
}

function exitCodeMatch(exit: CrashExit): RuleMatch | null {
  const rule = EXIT_CODE_RULES.find((item) => exit.code !== null && item.codes.includes(exit.code));
  return rule === undefined ? null : { rule, cause: rule.cause, source: null, evidence: null };
}

export function findCause(input: CrashInput): RuleMatch | null {
  const texts = sources(input);
  const context: RuleContext = {
    logOrder: input.logOrder ?? logOrderOf(input.logLines.join('\n')),
    memoryMb: input.memoryMb,
    javaMajor: input.javaMajor,
    java32: isJava32(input),
  };
  for (const rule of CRASH_RULES) {
    const found = matchRule(rule, texts, context);
    if (found !== null) {
      return found;
    }
  }
  return exitCodeMatch(input.exit);
}

function isNormalExit(exit: CrashExit): boolean {
  return (
    (exit.code !== null && NORMAL_EXIT_CODES.has(exit.code)) ||
    (exit.code === null && exit.signal !== null && NORMAL_SIGNALS.has(exit.signal))
  );
}

function hasCrashMarkers(input: CrashInput): boolean {
  if (input.crashReport !== null || input.jvmReport !== null) {
    return true;
  }
  // The game catches a window that did not open and exits with code 0, or the launcher stops
  // it first: either way the exit looks normal, and only the log tells.
  return input.logLines.some(
    (line) => isWindowFailure(line) || CRASH_MARKERS.some((marker) => line.includes(marker)),
  );
}

export function isClosedByPlayer(input: CrashInput): boolean {
  if (input.gameDialog === true) {
    return false;
  }
  if (input.stoppedByUser) {
    return input.crashReport === null && input.jvmReport === null;
  }
  return isNormalExit(input.exit) && !hasCrashMarkers(input);
}

function disableFix(names: (string | null | undefined)[], modFiles: string[]): CrashFix[] {
  if (names.every((name) => name === null || name === undefined || isSharedDependency(name))) {
    return [];
  }
  const files = modFilesForAny(names, modFiles);
  return files.length === 1 && files[0] !== undefined
    ? [{ type: 'disable-mod', file: files[0] }]
    : [];
}

function disableFixes(groups: (string | null | undefined)[][], modFiles: string[]): CrashFix[] {
  const seen = new Set<string>();
  const fixes: CrashFix[] = [];
  for (const names of groups) {
    for (const fix of disableFix(names, modFiles)) {
      if (fix.type === 'disable-mod' && !seen.has(fix.file)) {
        seen.add(fix.file);
        fixes.push(fix);
      }
    }
  }
  return fixes;
}

function versionPart(file: string): string {
  return file.replace(MOD_EXTENSION, '').slice(modNamePart(file).length);
}

export function oldestFirst(files: readonly string[]): string[] {
  return [...files].sort((a, b) =>
    versionPart(a).localeCompare(versionPart(b), 'en', { numeric: true }),
  );
}

function duplicateFixes(
  cause: Extract<CrashCause, { code: 'mod-duplicate' }>,
  modFiles: string[],
): CrashFix[] {
  const listed = cause.files.filter((file) => modFiles.includes(file));
  const candidates = listed.length >= 2 ? listed : modFilesFor(cause.mod, modFiles);
  if (candidates.length < 2) {
    return [];
  }
  return oldestFirst(candidates)
    .slice(0, -1)
    .slice(0, DUPLICATE_FIX_LIMIT)
    .map((file): CrashFix => ({ type: 'disable-mod', file }));
}

function gameFilePath(file: string): string | null {
  const segments = file.replace(/\\/g, '/').split('/');
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const segment = segments[index] ?? '';
    if ((GAME_FILE_ROOTS as readonly string[]).includes(segment)) {
      const relative = segments.slice(index);
      return relative.includes('..') ? null : relative.join('/');
    }
  }
  return null;
}

function corruptFixes(file: string | null, modFiles: string[]): CrashFix[] {
  if (file === null) {
    return [];
  }
  const normalized = file.replace(/\\/g, '/');
  if (normalized.includes('/mods/') || !normalized.includes('/')) {
    const name = baseName(normalized);
    return modFiles.includes(name) ? [{ type: 'disable-mod', file: name }] : [];
  }
  const relative = gameFilePath(normalized);
  return relative === null ? [] : [{ type: 'remove-file', path: relative }];
}

function memoryFixes(
  cause: Extract<CrashCause, { code: 'out-of-memory' }>,
  input: CrashInput,
): CrashFix[] {
  if (cause.heap === false) {
    return /Direct buffer/i.test(cause.area ?? '')
      ? [{ type: 'advice', advice: 'lower-render-distance' }]
      : [{ type: 'advice', advice: 'update-mod' }];
  }
  const more = suggestMoreMemory(input.memoryMb, input.totalMemoryBytes);
  const fixes: CrashFix[] = more === null ? [] : [{ type: 'set-memory', mb: more }];
  if (more === null) {
    fixes.push({ type: 'advice', advice: 'close-programs' });
  }
  fixes.push({ type: 'advice', advice: 'lower-render-distance' });
  return fixes;
}

function java32Fixes(input: CrashInput): CrashFix[] {
  const fixes: CrashFix[] =
    input.memoryMb === null || input.memoryMb > JAVA_32_MAX_MB
      ? [{ type: 'set-memory', mb: JAVA_32_MAX_MB }]
      : [];
  fixes.push({ type: 'advice', advice: 'java-64bit' });
  return fixes;
}

function systemMemoryFixes(
  cause: Extract<CrashCause, { code: 'system-memory' }>,
  input: CrashInput,
): CrashFix[] {
  if (cause.kind === 'reserve-32bit') {
    return java32Fixes(input);
  }
  const less = suggestLessMemory(input.memoryMb);
  const fixes: CrashFix[] = less === null ? [] : [{ type: 'set-memory', mb: less }];
  fixes.push({ type: 'advice', advice: 'close-programs' });
  if (input.platform === 'win32' || cause.kind === 'paging') {
    fixes.push({ type: 'advice', advice: 'paging-file' });
  }
  return fixes;
}

export function javaFixes(
  cause: Extract<CrashCause, { code: 'java-version' }>,
  input: CrashInput,
): CrashFix[] {
  const override = input.javaOverride ?? null;
  if (cause.direction === 'too-new') {
    return override === null
      ? [{ type: 'advice', advice: 'update-mod' }]
      : [{ type: 'reset-java' }];
  }
  const required = cause.requiredMajor;
  if (required === null) {
    return override === null ? [] : [{ type: 'reset-java' }];
  }
  const game = input.gameJavaMajor ?? null;
  if (override !== null && game !== null && game >= required) {
    return [{ type: 'reset-java' }];
  }
  const major = javaMajorFor(required);
  if (major === null) {
    return [{ type: 'advice', advice: 'update-mod' }];
  }
  return [{ type: 'install-java', major }];
}

function graphicsFixes(
  cause: Extract<CrashCause, { code: 'graphics' }>,
  input: CrashInput,
): CrashFix[] {
  const fixes: CrashFix[] = [{ type: 'advice', advice: 'update-driver' }];
  if (input.platform === 'win32') {
    fixes.push({ type: 'advice', advice: 'discrete-gpu' });
  }
  if (cause.problem === 'driver-crash' && input.platform === 'win32') {
    fixes.push({ type: 'advice', advice: 'antivirus' });
  }
  if (cause.problem === 'not-responding') {
    fixes.push({ type: 'advice', advice: 'lower-render-distance' });
  }
  return withVirtualMachineAdvice(fixes, cause, input);
}

function withVirtualMachineAdvice(
  fixes: CrashFix[],
  cause: Extract<CrashCause, { code: 'graphics' }>,
  input: CrashInput,
): CrashFix[] {
  const virtualMachine = input.virtualMachine ?? null;
  const fits = input.platform === 'win32' && WINDOW_GRAPHICS_PROBLEMS.includes(cause.problem);
  if (!fits || virtualMachine === false) {
    return fixes;
  }
  const advice: CrashFix = { type: 'advice', advice: 'vm-graphics' };
  // A virtual machine has neither a vendor driver to update nor a second card to switch to.
  return virtualMachine === true ? [advice] : [...fixes, advice];
}

function modsFolder(fixes: CrashFix[]): CrashFix[] {
  return [...fixes, { type: 'open-folder', folder: 'mods' }];
}

function primaryFixes(cause: CrashCause, input: CrashInput): CrashFix[] {
  const { modFiles } = input;
  switch (cause.code) {
    case 'closed':
      return [];
    case 'out-of-memory':
      return memoryFixes(cause, input);
    case 'system-memory':
      return systemMemoryFixes(cause, input);
    case 'java-version':
      return javaFixes(cause, input);
    case 'graphics':
      return graphicsFixes(cause, input);
    case 'mod-duplicate':
      return modsFolder(duplicateFixes(cause, modFiles));
    case 'mod-conflict':
      return modsFolder(
        disableFixes(
          [
            [cause.modId, cause.mod],
            [cause.otherId, cause.other],
          ],
          modFiles,
        ),
      );
    case 'mod-dependency':
      return modsFolder([
        { type: 'advice', advice: 'install-dependency' },
        ...disableFixes([[cause.modId, cause.mod]], modFiles),
      ]);
    case 'mod-version':
      return modsFolder([
        ...disableFixes([[cause.modId, cause.mod]], modFiles),
        { type: 'advice', advice: 'update-mod' },
      ]);
    case 'mod-crash':
      return modsFolder([
        ...disableFixes([[cause.modId, cause.mod]], modFiles),
        { type: 'advice', advice: 'update-mod' },
      ]);
    case 'corrupt-file':
      return corruptFixes(cause.file, modFiles);
    case 'disk-full':
      return [
        { type: 'advice', advice: 'free-disk' },
        { type: 'open-folder', folder: 'instance' },
      ];
    case 'join-before-load':
      return [{ type: 'launch-without-join' }];
    case 'unknown':
      return input.crashReport === null ? [] : [{ type: 'open-folder', folder: 'crash-reports' }];
  }
}

export function fixesFor(cause: CrashCause, input: CrashInput): CrashFix[] {
  if (cause.code === 'closed') {
    return [];
  }
  return [...primaryFixes(cause, input), ...CLOSING_FIXES];
}

function verdict(cause: CrashCause, input: CrashInput, match: RuleMatch | null): CrashVerdict {
  const fixes = fixesFor(cause, input);
  return {
    cause,
    rule: match?.rule.id ?? null,
    source: match?.source ?? null,
    evidence: match?.evidence ?? null,
    fixes,
    autoFixable: fixes[0] !== undefined && isAutomaticFix(fixes[0]),
  };
}

// The game showed its own error dialog before its window: the line about the failed
// window comes only after "OK", so a game stopped from the dialog leaves no line to match.
const GAME_DIALOG_MATCH: RuleMatch = {
  rule: { id: GAME_DIALOG_RULE },
  cause: { code: 'graphics', problem: 'context' },
  source: null,
  evidence: null,
};

export function analyzeCrash(input: CrashInput): CrashVerdict {
  if (isClosedByPlayer(input)) {
    return verdict({ code: 'closed' }, input, null);
  }
  const match = findCause(input);
  if (match === null && input.gameDialog === true) {
    return verdict(GAME_DIALOG_MATCH.cause, input, GAME_DIALOG_MATCH);
  }
  return verdict(match?.cause ?? { code: 'unknown' }, input, match);
}
