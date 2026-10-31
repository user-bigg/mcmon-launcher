import { displayHost, formatServerAddress, type ServerAddress } from '@shared/server-address';

export interface RedactOptions {
  nick: string | null;
  userName: string | null;
  homeDir: string | null;
  gameRoot: string | null;
  server?: readonly string[];
}

export const SERVER_MARKER = '<server>';

const MIN_NAME_LENGTH = 3;
const LONG_SECRET_LENGTH = 40;
const LINE_MAX = 500;

const ENV_LINE =
  /^(\s*(?:USERNAME|USER|LOGNAME|HOME|USERPROFILE|HOMEPATH|COMPUTERNAME|HOSTNAME|USERDOMAIN|USERDOMAIN_ROAMINGPROFILE|LOCALAPPDATA|APPDATA|OneDrive\w*)\s*=).*$/gim;
const WINDOWS_PROFILE =
  /([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\r\n"':;<>|*?]{1,64}(?=[\\/]|$|["'\s:;,)\]])/gim;
const UNIX_PROFILE = /(\/(?:Users|home)\/)[^/\s"':;]+/g;
const SETTING_USER = /(Setting user: )[A-Za-z0-9_]{1,16}\b/g;
const ARGUMENT_SECRET = /(--(?:accessToken|uuid|xuid|clientId|username)\s+)\S+/gi;
const KEY_SECRET =
  /((?:access_?token|refresh_?token|client_?token|session(?:_?id)?|auth_?xuid|xuid|password|passwd)["']?\s*[=:]\s*["']?)[^\s,&"'\]})]+/gi;
const SESSION_TOKEN = /\btoken:[^\s:]+(?::[0-9a-f-]+)?/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const UUID = /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi;
const IPV4 = /(?<![\w.-])(?:\d{1,3}\.){3}\d{1,3}(?![\w-]|\.\d)/g;
const IPV6 = /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%\w+)?(?![\w:])/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LONG_SECRET = /[A-Za-z0-9_+/-]{40,}={0,2}/g;
const HEX_DIGEST = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const CLASS_SEGMENT = /^[A-Za-z_$][\w$-]*$/;

// Words that appear in every log: a nickname or user name from this list cannot be removed
// as a word, or half the log disappears. Such names are hidden only in paths and in
// 'Setting user'.
const COMMON_WORDS = new Set([
  'admin',
  'alex',
  'client',
  'debug',
  'error',
  'false',
  'game',
  'info',
  'java',
  'main',
  'minecraft',
  'mods',
  'null',
  'player',
  'render',
  'server',
  'steve',
  'test',
  'thread',
  'true',
  'user',
  'warn',
  'worker',
  'world',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replacePath(text: string, path: string | null, marker: string): string {
  if (path === null || path.length < MIN_NAME_LENGTH) {
    return text;
  }
  const variants = new Set([path, path.replace(/\\/g, '/'), path.replace(/\//g, '\\')]);
  let result = text;
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(escapeRegExp(variant), 'gi'), marker);
  }
  return result;
}

export function isRedactableWord(word: string | null): word is string {
  return word !== null && word.length >= MIN_NAME_LENGTH && !COMMON_WORDS.has(word.toLowerCase());
}

function replaceWord(text: string, word: string | null, marker: string): string {
  if (!isRedactableWord(word)) {
    return text;
  }
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(word)}(?![\\p{L}\\p{N}_])`, 'giu');
  return text.replace(pattern, marker);
}

function replaceProfileFolder(text: string, userName: string | null): string {
  if (userName === null || userName.length === 0) {
    return text;
  }
  const name = escapeRegExp(userName);
  const pattern = new RegExp(
    `([A-Za-z]:[\\\\/]+(?:Users|Documents and Settings)[\\\\/]+|/(?:Users|home)/)${name}(?=[\\\\/]|$|[^\\p{L}\\p{N}_])`,
    'giu',
  );
  return text.replace(pattern, '$1<user>');
}

function isClassPath(value: string): boolean {
  const segments = value.split('/');
  return (
    segments.length >= 2 &&
    segments.every((segment) => CLASS_SEGMENT.test(segment)) &&
    segments.some((segment) => /^[a-z]+$/.test(segment))
  );
}

function hideLongSecrets(text: string): string {
  return text.replace(LONG_SECRET, (value) => {
    if (value.length < LONG_SECRET_LENGTH || HEX_DIGEST.test(value) || isClassPath(value)) {
      return value;
    }
    return /\d/.test(value) && /[A-Za-z]/.test(value) ? '<token>' : value;
  });
}

export function isPrivateIpv4(value: string): boolean {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part > 255)) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function isPrivateIpv6(value: string): boolean {
  const address = value.toLowerCase().split('%')[0] ?? '';
  if (!address.includes('::') && address.split(':').length !== 8) {
    return false;
  }
  return (
    address === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(address) || /^fe[89ab][0-9a-f]?:/.test(address)
  );
}

// Server addresses stay in the report (they tell the server owner
// where the player connected); only LAN and loopback addresses are removed, since they
// describe the player's network.
function hideAddresses(text: string): string {
  return text
    .replace(IPV4, (value) => (isPrivateIpv4(value) ? '<ip>' : value))
    .replace(IPV6, (value) => (isPrivateIpv6(value) ? '<ip>' : value));
}

export function serverWords(address: ServerAddress): string[] {
  const words = [formatServerAddress(address), address.host, displayHost(address.host)];
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

// A launcher-only server keeps its address out of the launcher's own screens: the game prints
// it as typed and as resolved, so every address in the text goes, public ones included.
export function concealServer(text: string, words: readonly string[]): string {
  let result = text;
  for (const word of words) {
    if (word !== '') {
      result = result.replace(new RegExp(escapeRegExp(word), 'gi'), SERVER_MARKER);
    }
  }
  return result
    .replace(IPV4, SERVER_MARKER)
    .replace(IPV6, (value) => (looksLikeIpv6(value) ? SERVER_MARKER : value));
}

// Clock times ('12:34:56') match the IPv6 pattern too: an address is either compressed or full.
function looksLikeIpv6(value: string): boolean {
  const colons = value.replace(/[^:]/g, '').length;
  return /[0-9a-f]/i.test(value) && (value.includes('::') || colons === 7);
}

const LAUNCH_SECRET = /(--(?:accessToken|clientId|xuid)\s+)\S+/gi;
const SECRET_VARIABLE = /^(\s*\w*(?:token|key|secret|passw|credential|auth)\w*\s*=).*$/gim;

// Reports to MC Monitor keep paths and nicks (the site uses them against spam); only what
// signs in as the player goes, plus secret-looking variables from a JVM report's environment.
// Long hashes stay: asset paths are full of them and they are what the report is read for.
export function redactSecrets(text: string): string {
  return text
    .replace(SECRET_VARIABLE, '$1<hidden>')
    .replace(LAUNCH_SECRET, '$1<hidden>')
    .replace(KEY_SECRET, '$1<hidden>')
    .replace(SESSION_TOKEN, 'token:<hidden>')
    .replace(JWT, '<token>');
}

export function redactText(text: string, options: RedactOptions): string {
  const concealed = options.server === undefined ? text : concealServer(text, options.server);
  let result = replacePath(concealed, options.gameRoot, '<game>');
  result = replacePath(result, options.homeDir, '~');
  result = replaceProfileFolder(result, options.userName);
  result = result
    .replace(ENV_LINE, '$1<hidden>')
    .replace(WINDOWS_PROFILE, '$1<user>')
    .replace(UNIX_PROFILE, '$1<user>')
    .replace(SETTING_USER, '$1<nick>')
    .replace(ARGUMENT_SECRET, '$1<hidden>')
    .replace(KEY_SECRET, '$1<hidden>')
    .replace(SESSION_TOKEN, 'token:<hidden>')
    .replace(JWT, '<token>')
    .replace(UUID, '<uuid>')
    .replace(EMAIL, '<email>');
  result = hideAddresses(result);
  result = hideLongSecrets(result);
  result = replaceWord(result, options.userName, '<user>');
  return replaceWord(result, options.nick, '<nick>');
}

export function redactLines(lines: string[], options: RedactOptions): string[] {
  return lines.map((line) => {
    const clean = redactText(line, options);
    return clean.length > LINE_MAX ? `${clean.slice(0, LINE_MAX - 1)}…` : clean;
  });
}
