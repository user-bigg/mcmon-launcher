import type { CrashReportPacket, CrashUpload } from '@shared/telemetry';
import type { Posted } from './http';

export type CrashReportHeader = Omit<CrashReportPacket, keyof CrashUpload>;

export interface CrashReportsOptions {
  header: () => Promise<CrashReportHeader>;
  post: (packet: CrashReportPacket) => Promise<Posted>;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

export const CRASH_RETRY_MS = 60_000;
const RETRIED = new Set(['offline', 'timeout', 'server-error']);

// The site skips a repeat with the same launch_id, so only a report that has one is sent again.
export async function sendCrashReport(
  options: CrashReportsOptions,
  report: CrashUpload,
): Promise<boolean> {
  const packet = { ...(await options.header()), ...report };
  const first = await options.post(packet);
  if (first.ok) {
    return true;
  }
  if (report.launch_id === undefined || !RETRIED.has(first.error.code)) {
    options.log(`crash report: not sent (${first.error.code})`);
    return false;
  }
  await options.sleep(CRASH_RETRY_MS);
  const second = await options.post(packet);
  if (!second.ok) {
    options.log(`crash report: not sent (${second.error.code})`);
  }
  return second.ok;
}
