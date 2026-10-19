const MAX_LOG_TEXT = 200;

const SECRET_LINE = /\b(set-cookie|cookie|authorization|x-[a-z-]*token)\b\s*["']?\s*[:=].*/i;
const BEARER = /\b(bearer|basic)\s+\S+/gi;
const REPEATED_ERROR = /^(Error:\s+)+(?=Error:)/;

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

function textOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${code} ${error.message}` : error.message;
  }
  return String(error);
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? '').split(/\s*Headers:/i, 1)[0] ?? '';
}

// electron-updater puts the whole response into an HttpError message: the status line, then
// "Headers: {…}" with set-cookie of the site session. Only the status and the first line go out.
export function logTextOf(error: unknown): string {
  const status = statusOf(error);
  if (status !== null) {
    return `HTTP ${String(status)}`;
  }
  // The logger gets `Error: ${error.stack}`, and a stack starts with "Error:" by itself.
  const line = firstLine(textOf(error))
    .replace(REPEATED_ERROR, '')
    .replace(SECRET_LINE, '$1: [removed]')
    .replace(BEARER, '$1 [removed]')
    .trim();
  return line.length > MAX_LOG_TEXT ? `${line.slice(0, MAX_LOG_TEXT)}…` : line;
}
