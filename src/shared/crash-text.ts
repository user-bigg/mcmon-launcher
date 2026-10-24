import {
  GAME_DIALOG_RULE,
  signedExitCode,
  type CrashAdvice,
  type CrashAnalysis,
  type CrashCause,
  type CrashExit,
  type CrashFix,
} from './crash';
import { crashRu } from './i18n/crash.ru';
import { fill } from './i18n/format';
import { ru } from './i18n/ru';

export interface CrashFixText {
  title: string;
  text: string | null;
  action: string | null;
}

export interface CrashText {
  title: string;
  text: string;
  summary: string;
  fixes: CrashFixText[];
}

type Values = Record<string, string>;

const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function formatMemory(mb: number): string {
  if (mb < 1024) {
    return fill(crashRu.values.mb, { value: String(Math.round(mb)) });
  }
  return fill(crashRu.values.gb, { value: decimal.format(Math.round((mb / 1024) * 10) / 10) });
}

function rangeSuffix(range: string | null): string {
  return range === null || range === '*' ? '' : fill(crashRu.values.range, { range });
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function firstMemoryFix(fixes: CrashFix[]): number | null {
  const fix = fixes.find((item) => item.type === 'set-memory');
  return fix?.type === 'set-memory' ? fix.mb : null;
}

function firstJavaFix(fixes: CrashFix[]): number | null {
  const fix = fixes.find((item) => item.type === 'install-java');
  return fix?.type === 'install-java' ? fix.major : null;
}

function heapText(
  cause: Extract<CrashCause, { code: 'out-of-memory' }>,
  fixes: CrashFix[],
): Pick<CrashText, 'text' | 'summary'> {
  const strings = crashRu.causes['out-of-memory'];
  const suggested = firstMemoryFix(fixes);
  if (cause.heap === false) {
    return {
      text: fill(strings.textArea, { area: cause.area ?? '' }),
      summary: strings.summaryNoFix,
    };
  }
  const memory = cause.memoryMb === null ? null : formatMemory(cause.memoryMb);
  let text: string;
  if (suggested === null) {
    text = memory === null ? strings.textNoFixNoMemory : fill(strings.textNoFix, { memory });
  } else {
    text = memory === null ? strings.textNoMemory : fill(strings.text, { memory });
  }
  return {
    text,
    summary:
      suggested === null
        ? strings.summaryNoFix
        : fill(strings.summary, { memory: formatMemory(suggested) }),
  };
}

function systemMemoryText(
  cause: Extract<CrashCause, { code: 'system-memory' }>,
  fixes: CrashFix[],
): Pick<CrashText, 'text' | 'summary'> {
  const strings = crashRu.causes['system-memory'];
  const suggested = firstMemoryFix(fixes);
  const summary =
    suggested === null
      ? strings.summaryNoFix
      : fill(strings.summary, { memory: formatMemory(suggested) });
  if (cause.kind === 'reserve-32bit') {
    return { text: strings.text32bit, summary };
  }
  if (cause.kind === 'threads') {
    return { text: strings.textThreads, summary };
  }
  return {
    text:
      cause.memoryMb === null
        ? strings.textNoMemory
        : fill(strings.text, { memory: formatMemory(cause.memoryMb) }),
    summary,
  };
}

function javaText(
  cause: Extract<CrashCause, { code: 'java-version' }>,
  fixes: CrashFix[],
): Pick<CrashText, 'text' | 'summary'> {
  const strings = crashRu.causes['java-version'];
  const required = cause.requiredMajor === null ? null : String(cause.requiredMajor);
  const current = cause.currentMajor === null ? null : String(cause.currentMajor);
  let text: string = strings.textUnknown;
  if (cause.direction === 'too-new') {
    text = strings.textTooNew;
  } else if (required !== null && current !== null) {
    text = fill(strings.textTooOld, { required, current });
  } else if (required !== null) {
    text = fill(strings.textTooOldNoCurrent, { required });
  }
  const major = firstJavaFix(fixes);
  let summary: string = strings.summaryNoFix;
  if (major !== null) {
    summary = fill(strings.summary, { required: String(major) });
  } else if (fixes.some((fix) => fix.type === 'reset-java')) {
    summary = strings.summaryReset;
  }
  return { text, summary };
}

// In a virtual machine the driver advice is dropped, so the text must not promise that a
// driver update helps.
function inVirtualMachine(fixes: readonly CrashFix[]): boolean {
  const first = fixes[0];
  return first?.type === 'advice' && first.advice === 'vm-graphics';
}

function graphicsText(
  cause: Extract<CrashCause, { code: 'graphics' }>,
  fixes: readonly CrashFix[],
): Pick<CrashText, 'text' | 'summary'> {
  const strings = crashRu.causes.graphics;
  if (inVirtualMachine(fixes)) {
    return { text: strings.textVirtualMachine, summary: strings.summaryVirtualMachine };
  }
  switch (cause.problem) {
    case 'display':
      return { text: strings.textDisplay, summary: strings.summary };
    case 'driver-crash':
      return { text: strings.textDriverCrash, summary: strings.summary };
    case 'not-responding':
      return { text: strings.textNotResponding, summary: strings.summaryNotResponding };
    case 'no-opengl':
    case 'pixel-format':
    case 'context':
      return {
        text: advises(fixes, 'update-macos') ? strings.textMac : strings.text,
        summary: strings.summary,
      };
  }
}

function advises(fixes: readonly CrashFix[], advice: CrashAdvice): boolean {
  return fixes.some((fix) => fix.type === 'advice' && fix.advice === advice);
}

function modConflictText(
  cause: Extract<CrashCause, { code: 'mod-conflict' }>,
): Pick<CrashText, 'text' | 'summary'> {
  const strings = crashRu.causes['mod-conflict'];
  if (cause.mod === null) {
    return { text: strings.textNoMod, summary: strings.summaryNoMod };
  }
  const summary = fill(strings.summary, { mod: cause.mod });
  if (cause.other === null) {
    return { text: fill(strings.textMixin, { mod: cause.mod }), summary };
  }
  return { text: fill(strings.text, { mod: cause.mod, other: cause.other }), summary };
}

function modVersionText(
  cause: Extract<CrashCause, { code: 'mod-version' }>,
): Pick<CrashText, 'text' | 'summary'> {
  const strings = crashRu.causes['mod-version'];
  const values: Values = {
    mod: cause.mod ?? '',
    dependency: cause.dependency,
    range: cause.range ?? crashRu.values.anyVersion,
    present: cause.present ?? '',
  };
  if (cause.mod === null) {
    return { text: fill(strings.textNoMod, values), summary: strings.summaryNoMod };
  }
  let template: string = strings.text;
  if (cause.dependency.toLowerCase() === 'minecraft') {
    template = cause.range === null ? strings.textMinecraftNoRange : strings.textMinecraft;
  } else if (cause.present === null) {
    template = strings.textNoPresent;
  }
  return { text: fill(template, values), summary: fill(strings.summary, values) };
}

function withMod(
  mod: string | null,
  strings: { text: string; textNoMod: string; summary: string; summaryNoMod: string },
  values: Values = {},
): Pick<CrashText, 'text' | 'summary'> {
  return mod === null
    ? { text: fill(strings.textNoMod, values), summary: fill(strings.summaryNoMod, values) }
    : {
        text: fill(strings.text, { ...values, mod }),
        summary: fill(strings.summary, { ...values, mod }),
      };
}

function causeText(analysis: CrashAnalysis): Pick<CrashText, 'text' | 'summary'> {
  const { cause, fixes } = analysis;
  const causes = crashRu.causes;
  switch (cause.code) {
    case 'out-of-memory':
      return heapText(cause, fixes);
    case 'system-memory':
      return systemMemoryText(cause, fixes);
    case 'java-version':
      return javaText(cause, fixes);
    case 'graphics':
      return graphicsText(cause, fixes);
    case 'mod-duplicate':
      return withMod(cause.mod, causes['mod-duplicate']);
    case 'mod-conflict':
      return modConflictText(cause);
    case 'mod-dependency': {
      const values = {
        mod: cause.mod ?? '',
        dependency: cause.dependency,
        range: rangeSuffix(cause.range),
      };
      const strings = causes['mod-dependency'];
      return {
        text: fill(cause.mod === null ? strings.textNoMod : strings.text, values),
        summary: fill(strings.summary, values),
      };
    }
    case 'mod-version':
      return modVersionText(cause);
    case 'mod-crash':
      return withMod(cause.mod, causes['mod-crash']);
    case 'corrupt-file':
      return {
        text:
          cause.file === null
            ? causes['corrupt-file'].textNoFile
            : fill(causes['corrupt-file'].text, { file: fileName(cause.file) }),
        summary: causes['corrupt-file'].summary,
      };
    case 'closed':
    case 'disk-full':
    case 'join-before-load':
    case 'unknown':
      return { text: causes[cause.code].text, summary: causes[cause.code].summary };
  }
}

function causeValues(cause: CrashCause): Values {
  const values: Values = {};
  if ('mod' in cause && cause.mod !== null) {
    values.mod = cause.mod;
  }
  if ('dependency' in cause) {
    values.dependency = cause.dependency;
    values.range = rangeSuffix(cause.range);
  }
  return values;
}

function memoryFixText(analysis: CrashAnalysis, mb: number): CrashFixText {
  const strings = crashRu.fixes['set-memory'];
  const current = analysis.memoryMb;
  const values = {
    memory: formatMemory(mb),
    current: current === null ? '' : formatMemory(current),
    total: formatMemory(analysis.totalMemoryMb),
  };
  if (current !== null && mb < current) {
    return {
      title: fill(strings.titleLess, values),
      text: strings.textLess,
      action: strings.actionLess,
    };
  }
  return {
    title: fill(current === null ? strings.titleMoreNoCurrent : strings.titleMore, values),
    text: fill(strings.textMore, values),
    action: strings.actionMore,
  };
}

function adviceText(
  analysis: CrashAnalysis,
  fix: Extract<CrashFix, { type: 'advice' }>,
): CrashFixText {
  const values = causeValues(analysis.cause);
  if (fix.advice === 'update-mod') {
    const strings = crashRu.advice['update-mod'];
    return {
      title: values.mod === undefined ? strings.titleNoMod : fill(strings.title, values),
      text: strings.text,
      action: null,
    };
  }
  const strings = crashRu.advice[fix.advice];
  return { title: fill(strings.title, values), text: fill(strings.text, values), action: null };
}

export function describeFix(analysis: CrashAnalysis, fix: CrashFix): CrashFixText {
  const fixes = crashRu.fixes;
  switch (fix.type) {
    case 'set-memory':
      return memoryFixText(analysis, fix.mb);
    case 'install-java': {
      const values = { major: String(fix.major) };
      return {
        title: fill(fixes['install-java'].title, values),
        text: fill(fixes['install-java'].text, values),
        action: fixes['install-java'].action,
      };
    }
    case 'reset-java':
      return {
        title: fixes['reset-java'].title,
        text: fixes['reset-java'].text,
        action: fixes['reset-java'].action,
      };
    case 'disable-mod':
      return {
        title: fill(fixes['disable-mod'].title, { file: fix.file }),
        text: fixes['disable-mod'].text,
        action: fixes['disable-mod'].action,
      };
    case 'remove-file':
      return {
        title: fill(fixes['remove-file'].title, { file: fileName(fix.path) }),
        text: fixes['remove-file'].text,
        action: fixes['remove-file'].action,
      };
    case 'launch-without-join':
      return {
        title: fixes['launch-without-join'].title,
        text: fixes['launch-without-join'].text,
        action: fixes['launch-without-join'].action,
      };
    case 'open-log':
      return { title: fixes['open-log'].title, text: null, action: fixes['open-log'].action };
    case 'open-folder':
      return {
        title: fixes['open-folder'][fix.folder],
        text: null,
        action: fixes['open-folder'].action,
      };
    case 'report':
      return { title: fixes.report.title, text: fixes.report.text, action: fixes.report.action };
    case 'advice':
      return adviceText(analysis, fix);
  }
}

export function describeCrash(analysis: CrashAnalysis): CrashText {
  return {
    title: crashRu.causes[analysis.cause.code].title,
    ...causeText(analysis),
    fixes: analysis.fixes.map((fix) => describeFix(analysis, fix)),
  };
}

export interface CrashDetails {
  evidence: string | null;
  note: string | null;
  exit: string | null;
}

function exitLine(exit: CrashExit): string | null {
  if (exit.code !== null) {
    return fill(ru.crash.exit, { code: String(signedExitCode(exit.code)) });
  }
  return exit.signal === null ? null : fill(ru.crash.exitSignal, { signal: exit.signal });
}

// A game stopped from its own error dialog dies before it writes the line about the window.
export function crashDetails(analysis: CrashAnalysis): CrashDetails {
  const dialog = analysis.evidence === null && analysis.rule === GAME_DIALOG_RULE;
  return {
    evidence: analysis.evidence,
    note: dialog ? ru.crash.dialogStopped : null,
    exit: exitLine(analysis.exit),
  };
}
