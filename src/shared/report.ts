import type { AccountError, AccountErrorCode } from './account';

export const MAX_REPORT_NOTE_LENGTH = 1000;
export const MIN_OTHER_NOTE_LENGTH = 10;
export const MAX_REPORT_REASONS = 20;
export const OTHER_REASON = 'other';
export const REPORT_REASON_PATTERN = /^[a-z_]{1,32}$/;

export interface ReportReason {
  code: string;
  label: string;
}

export interface ReportDraft {
  reason: string;
  note: string;
}

export interface MyReport {
  at: string;
}

export interface ServerReport {
  mine: MyReport | null;
  allowed: boolean;
}

export const REPORT_ERROR_CODES = [
  'email_unverified',
  'own_server',
  'note_required',
  'already_reported',
  'daily_limit',
  'too_frequent',
] as const;
export type ReportOnlyCode = (typeof REPORT_ERROR_CODES)[number];
export type ReportErrorCode = AccountErrorCode | ReportOnlyCode;

export interface ReportError extends Omit<AccountError, 'code'> {
  code: ReportErrorCode;
  reportedAt?: string;
  limit?: number;
  resetsAt?: string;
}

export type ReportResult = { ok: true; value: MyReport } | { ok: false; error: ReportError };

export function isReportReason(value: unknown): value is string {
  return typeof value === 'string' && REPORT_REASON_PATTERN.test(value);
}

export function noteRequired(reason: string): boolean {
  return reason === OTHER_REASON;
}

export function reportReady(draft: ReportDraft): boolean {
  if (!isReportReason(draft.reason) || draft.note.length > MAX_REPORT_NOTE_LENGTH) {
    return false;
  }
  return !noteRequired(draft.reason) || draft.note.trim().length >= MIN_OTHER_NOTE_LENGTH;
}
