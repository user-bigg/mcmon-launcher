import {
  ACCOUNT_ID_PATTERN,
  isValidNick,
  isValidServerId,
  isValidVersionId,
  MAX_LAUNCH_NAME_LENGTH,
  type LaunchAccount,
  type LaunchRequest,
  type LaunchResult,
  type LaunchTarget,
} from '@shared/launch';
import { isAllowedMemoryMb } from '@shared/memory';
import { isLaunchId } from '@shared/telemetry';
import { parseServerAddress } from '@shared/server-address';

type Parsed<T> = LaunchResult<T>;

function invalid(field: string): Parsed<never> {
  return { ok: false, error: { code: 'invalid-request', field } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLaunchTarget(value: unknown): Parsed<LaunchTarget> {
  if (!isRecord(value)) {
    return invalid('target');
  }
  const { kind, minecraft, serverId, address } = value;
  if (typeof minecraft !== 'string' || !isValidVersionId(minecraft)) {
    return invalid('minecraft');
  }
  if (kind !== 'server') {
    return invalid('kind');
  }
  if (!isValidServerId(serverId)) {
    return invalid('serverId');
  }
  if (typeof address !== 'string' || parseServerAddress(address) === null) {
    return invalid('address');
  }
  return { ok: true, value: { kind, serverId, minecraft, address } };
}

function parseAccount(value: unknown): Parsed<LaunchAccount> {
  if (!isRecord(value)) {
    return invalid('account');
  }
  if (value.kind === 'nick') {
    return typeof value.nick === 'string' && isValidNick(value.nick)
      ? { ok: true, value: { kind: 'nick', nick: value.nick } }
      : invalid('nick');
  }
  if (value.kind === 'account') {
    return typeof value.id === 'string' && ACCOUNT_ID_PATTERN.test(value.id)
      ? { ok: true, value: { kind: 'account', id: value.id } }
      : invalid('account');
  }
  return invalid('account');
}

function parseMemory(value: unknown, totalMemoryBytes: number): Parsed<number | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    isAllowedMemoryMb(value, totalMemoryBytes)
    ? { ok: true, value }
    : invalid('memoryMb');
}

function parseFlag(value: unknown, field: string): Parsed<boolean | undefined> {
  return value === undefined || typeof value === 'boolean' ? { ok: true, value } : invalid(field);
}

// The name is shown in the tray menu and becomes the entry of the game's server list (cleaned
// further there), so a bad one is dropped instead of failing the launch.
function launchName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const name = Array.from(value.replace(/\s+/g, ' ').trim())
    .slice(0, MAX_LAUNCH_NAME_LENGTH)
    .join('');
  return name === '' ? null : name;
}

export function parseLaunchRequest(
  value: unknown,
  totalMemoryBytes: number,
): Parsed<LaunchRequest> {
  if (!isRecord(value)) {
    return invalid('request');
  }
  const target = parseLaunchTarget(value.target);
  if (!target.ok) {
    return target;
  }
  const account = parseAccount(value.account);
  if (!account.ok) {
    return account;
  }
  const memoryMb = parseMemory(value.memoryMb, totalMemoryBytes);
  const joinServer = parseFlag(value.joinServer, 'joinServer');
  const serverSkins = parseFlag(value.serverSkins, 'serverSkins');
  const serverModpack = parseFlag(value.serverModpack, 'serverModpack');
  for (const field of [memoryMb, joinServer, serverSkins, serverModpack]) {
    if (!field.ok) {
      return field;
    }
  }
  const request: LaunchRequest = { target: target.value, account: account.value };
  if (memoryMb.ok && memoryMb.value !== undefined) {
    request.memoryMb = memoryMb.value;
  }
  if (joinServer.ok && joinServer.value !== undefined) {
    request.joinServer = joinServer.value;
  }
  if (serverSkins.ok && serverSkins.value !== undefined) {
    request.serverSkins = serverSkins.value;
  }
  if (serverModpack.ok && serverModpack.value !== undefined) {
    request.serverModpack = serverModpack.value;
  }
  if (isLaunchId(value.launchId)) {
    request.launchId = value.launchId;
  }
  const name = launchName(value.name);
  if (name !== null) {
    request.name = name;
  }
  return { ok: true, value: request };
}

export function parseLogLines(value: unknown, max: number): Parsed<number> {
  if (value === undefined) {
    return { ok: true, value: 200 };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    return invalid('lines');
  }
  return { ok: true, value };
}
