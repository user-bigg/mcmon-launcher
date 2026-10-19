import {
  ACCOUNT_ERROR_CODES,
  type AccountError,
  type AccountErrorCode,
  type AccountResult,
} from '@shared/account';
import {
  REPORT_ERROR_CODES,
  type MyReport,
  type ReportError,
  type ReportOnlyCode,
  type ReportResult,
} from '@shared/report';
import type { SiteError } from '@shared/site';
import type { Sent } from '../site/http';

const BY_TRANSPORT: Record<SiteError['code'], AccountErrorCode> = {
  'invalid-request': 'invalid_request',
  offline: 'offline',
  timeout: 'timeout',
  'rate-limited': 'rate_limited',
  'not-found': 'server_not_found',
  'invalid-response': 'invalid_response',
  'server-error': 'server_error',
  unauthorized: 'unauthenticated',
  'blocked-host': 'server_error',
};

function isAccountCode(value: string | undefined): value is AccountErrorCode {
  return (ACCOUNT_ERROR_CODES as readonly string[]).includes(value ?? '');
}

export function accountError(error: SiteError): AccountError {
  const code = isAccountCode(error.siteCode) ? error.siteCode : BY_TRANSPORT[error.code];
  return {
    code,
    ...(error.retryAfterS === undefined ? {} : { retryAfterS: error.retryAfterS }),
    ...(error.nextVoteAt === undefined ? {} : { nextVoteAt: error.nextVoteAt }),
  };
}

function isReportCode(value: string | undefined): value is ReportOnlyCode {
  return (REPORT_ERROR_CODES as readonly string[]).includes(value ?? '');
}

export function reportError(error: SiteError): ReportError {
  const base = accountError(error);
  return {
    ...base,
    code: isReportCode(error.siteCode) ? error.siteCode : base.code,
    ...(error.reportedAt === undefined ? {} : { reportedAt: error.reportedAt }),
    ...(error.limit === undefined ? {} : { limit: error.limit }),
    ...(error.resetsAt === undefined ? {} : { resetsAt: error.resetsAt }),
  };
}

export function reportResult(sent: Sent<MyReport>): ReportResult {
  return sent.ok ? sent : { ok: false, error: reportError(sent.error) };
}

export function accountResult<T>(sent: Sent<T>): AccountResult<T> {
  return sent.ok ? sent : { ok: false, error: accountError(sent.error) };
}

export function accountFailure(code: AccountErrorCode): { ok: false; error: AccountError } {
  return { ok: false, error: { code } };
}
