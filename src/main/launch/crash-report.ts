import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CrashAnalysis, CrashReportPackage, CrashReportPreview } from '@shared/crash';
import { serverIdOfFolder } from '@shared/instance';
import { redactLines, redactText, type RedactOptions } from './crash-redact';

export interface CrashReportInput {
  analysis: CrashAnalysis;
  logLines: string[];
  crashReport: string | null;
  jvmReport: string | null;
  modFiles: string[];
  loader: string;
  launcher: { name: string; version: string };
  system: { platform: string; arch: string; release: string };
  redact: RedactOptions;
  now: number;
}

const LOG_TAIL_LINES = 200;
const CRASH_REPORT_LINES = 200;
const JVM_REPORT_LINES = 80;
const MOD_LIMIT = 500;
export const KEEP_REPORTS = 10;
const REPORT_FILE = /^crash-[a-z0-9-]{8,64}\.json$/;

function lines(text: string | null, limit: number): string[] {
  if (text === null) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || (index > 0 && (all[index - 1] ?? '') !== ''))
    .slice(0, limit);
}

export function buildCrashReport(input: CrashReportInput): CrashReportPackage {
  const { analysis, redact } = input;
  return {
    format: 1,
    created_at: new Date(input.now).toISOString(),
    launcher: input.launcher,
    system: { ...input.system, total_memory_mb: analysis.totalMemoryMb },
    game: {
      instance_kind: 'server',
      server_id: serverIdOfFolder(analysis.instance),
      minecraft: analysis.minecraft,
      loader: input.loader,
      java_major: analysis.javaMajor,
      memory_mb: analysis.memoryMb,
    },
    exit: {
      code: analysis.exit.code,
      signal: analysis.exit.signal,
      uptime_s: analysis.uptimeMs === null ? null : Math.round(analysis.uptimeMs / 1000),
    },
    cause: {
      code: analysis.cause.code,
      rule: analysis.rule,
      evidence: analysis.evidence === null ? null : redactText(analysis.evidence, redact),
    },
    mods: redactLines(input.modFiles.slice(0, MOD_LIMIT), redact),
    log_tail: redactLines(input.logLines.slice(-LOG_TAIL_LINES), redact),
    crash_report: redactLines(lines(input.crashReport, CRASH_REPORT_LINES), redact),
    jvm_report: redactLines(lines(input.jvmReport, JVM_REPORT_LINES), redact),
  };
}

export function crashReportFileName(analysisId: string): string {
  return `crash-${analysisId}.json`;
}

export async function pruneReports(dir: string, keep = KEEP_REPORTS): Promise<void> {
  const names = (await readdir(dir).catch(() => [])).filter((name) => REPORT_FILE.test(name));
  const dated = await Promise.all(
    names.map(async (name) => ({
      path: join(dir, name),
      mtime: (await stat(join(dir, name)).catch(() => null))?.mtimeMs ?? 0,
    })),
  );
  const old = dated.sort((a, b) => b.mtime - a.mtime).slice(keep);
  await Promise.all(old.map((item) => rm(item.path, { force: true }).catch(() => undefined)));
}

export async function writeCrashReport(
  dir: string,
  analysisId: string,
  report: CrashReportPackage,
): Promise<CrashReportPreview> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, crashReportFileName(analysisId));
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path, body);
  await pruneReports(dir);
  return { path, bytes: Buffer.byteLength(body), report };
}
