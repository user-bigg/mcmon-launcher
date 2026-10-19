export interface ServerAddress {
  host: string;
  port: number | null;
}

export const DEFAULT_SERVER_PORT = 25565;

const MAX_ADDRESS_LENGTH = 261;
const FORBIDDEN_CHARACTERS = /[\s/\\?#@%]/u;
const BRACKETED = /^\[([0-9A-Fa-f:.]+)\](?::(\d{1,5}))?$/;
const PLAIN = /^([^:[\]]+)(?::(\d{1,5}))?$/;
const LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;

function parsePort(value: string | undefined): number | null | undefined {
  if (value === undefined) {
    return null;
  }
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

function isAscii(value: string): boolean {
  return /^[\x21-\x7e]+$/.test(value);
}

function normalizeHostname(raw: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(`http://${raw}`).hostname;
  } catch {
    return null;
  }
  if (isAscii(raw) && hostname !== raw.toLowerCase()) {
    return null;
  }
  const host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (host.length === 0 || host.length > 253) {
    return null;
  }
  const labels = host.split('.');
  if (!labels.every((label) => LABEL.test(label))) {
    return null;
  }
  return labels.every((label) => /^\d+$/.test(label)) && !isIpv4(host) ? null : host;
}

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function normalizeIpv6(raw: string): string | null {
  try {
    return new URL(`http://[${raw}]`).hostname;
  } catch {
    return null;
  }
}

export function parseServerAddress(value: string): ServerAddress | null {
  const address = value.trim();
  if (address.length === 0 || address.length > MAX_ADDRESS_LENGTH) {
    return null;
  }
  if (FORBIDDEN_CHARACTERS.test(address)) {
    return null;
  }
  const bracketed = BRACKETED.exec(address);
  const plain = bracketed === null ? PLAIN.exec(address) : null;
  const match = bracketed ?? plain;
  if (match === null) {
    return null;
  }
  const port = parsePort(match[2]);
  const rawHost = match[1] ?? '';
  const host = bracketed === null ? normalizeHostname(rawHost) : normalizeIpv6(rawHost);
  if (host === null || port === undefined) {
    return null;
  }
  return { host, port };
}

const PUNY_BASE = 36;
const PUNY_TMIN = 1;
const PUNY_TMAX = 26;
const PUNY_SKEW = 38;
const PUNY_DAMP = 700;
const PUNY_INITIAL_BIAS = 72;
const PUNY_INITIAL_N = 128;
const MAX_CODE_POINT = 0x10ffff;
const ACE_PREFIX = 'xn--';
const READABLE_LABEL = /^[\p{L}\p{M}\p{N}_-]+$/u;

function punyAdapt(delta: number, points: number, first: boolean): number {
  let scaled = first ? Math.floor(delta / PUNY_DAMP) : Math.floor(delta / 2);
  scaled += Math.floor(scaled / points);
  let k = 0;
  while (scaled > ((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) / 2) {
    scaled = Math.floor(scaled / (PUNY_BASE - PUNY_TMIN));
    k += PUNY_BASE;
  }
  return k + Math.floor(((PUNY_BASE - PUNY_TMIN + 1) * scaled) / (scaled + PUNY_SKEW));
}

function punyDigit(char: string): number {
  if (/[0-9]/.test(char)) {
    return char.charCodeAt(0) - 22;
  }
  return /[a-z]/.test(char) ? char.charCodeAt(0) - 97 : PUNY_BASE;
}

function punyThreshold(k: number, bias: number): number {
  return k <= bias ? PUNY_TMIN : k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias;
}

function decodePunycode(input: string): string | null {
  const delimiter = input.lastIndexOf('-');
  const output = Array.from({ length: Math.max(delimiter, 0) }, (_, at) => input.charCodeAt(at));
  let n = PUNY_INITIAL_N;
  let bias = PUNY_INITIAL_BIAS;
  let i = 0;
  let index = delimiter > 0 ? delimiter + 1 : 0;
  while (index < input.length) {
    const previous = i;
    let weight = 1;
    for (let k = PUNY_BASE; ; k += PUNY_BASE) {
      const digit = punyDigit(input[index] ?? '');
      index += 1;
      if (digit >= PUNY_BASE) {
        return null;
      }
      i += digit * weight;
      const threshold = punyThreshold(k, bias);
      if (digit < threshold) {
        break;
      }
      weight *= PUNY_BASE - threshold;
    }
    const length = output.length + 1;
    bias = punyAdapt(i - previous, length, previous === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > MAX_CODE_POINT) {
      return null;
    }
    output.splice(i, 0, n);
    i += 1;
  }
  return String.fromCodePoint(...output);
}

function readableLabel(label: string): string {
  if (!label.startsWith(ACE_PREFIX)) {
    return label;
  }
  const decoded = decodePunycode(label.slice(ACE_PREFIX.length));
  return decoded !== null && READABLE_LABEL.test(decoded) ? decoded : label;
}

export function displayHost(host: string): string {
  return host.includes(':') ? host : host.split('.').map(readableLabel).join('.');
}

export function formatServerAddress(address: ServerAddress): string {
  return address.port === null ? address.host : `${address.host}:${String(address.port)}`;
}

// The game finds a saved server by the exact text of its address, so the server list and the
// quick play argument spell one server the same way: the port exactly as the owner or the
// player entered it, 25565 included, and none at all when it was not entered (the game then
// looks for the SRV record itself).
export function gameListAddress(address: ServerAddress): string {
  return formatServerAddress(address);
}

// An IPv6 host is kept in brackets, as in a URL; sockets and the client mod take it bare.
export function bareHost(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}
