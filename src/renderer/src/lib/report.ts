import type { AccountErrorCode } from '@shared/account';
import { fill, formatNumber, plural } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import {
  MIN_OTHER_NOTE_LENGTH,
  REPORT_ERROR_CODES,
  type ReportError,
  type ReportOnlyCode,
} from '@shared/report';
import { accountErrorText } from './account';
import { moscowDate, moscowTime, sameMoscowDay } from './time';

function isReportOnly(code: string): code is ReportOnlyCode {
  return (REPORT_ERROR_CODES as readonly string[]).includes(code);
}

function withMinNote(text: string): string {
  return fill(text, {
    min: formatNumber(MIN_OTHER_NOTE_LENGTH),
    unit: plural(MIN_OTHER_NOTE_LENGTH, ru.plural.charsShorter),
  });
}

export function noteRequiredText(): string {
  return withMinNote(ru.report.noteRequired);
}

export function reportedText(at: string): string {
  return fill(ru.report.reported, { date: moscowDate(at) });
}

export function limitText(error: ReportError, now: Date): string {
  if (error.limit === undefined) {
    return ru.report.errors.daily_limit;
  }
  const count = formatNumber(error.limit);
  const unit = plural(error.limit, ru.plural.reports);
  const resetsAt = error.resetsAt;
  return resetsAt !== undefined && sameMoscowDay(resetsAt, now)
    ? fill(ru.report.limitToday, { count, unit, time: moscowTime(resetsAt) })
    : fill(ru.report.limit, { count, unit });
}

export function reportErrorText(error: ReportError): string {
  const code = error.code;
  if (code === 'note_required') {
    return withMinNote(ru.report.errors.note_required);
  }
  if (isReportOnly(code)) {
    return ru.report.errors[code];
  }
  if (code === 'server_not_found') {
    return ru.report.errors.server_not_found;
  }
  return accountErrorText({ ...error, code: code satisfies AccountErrorCode });
}
