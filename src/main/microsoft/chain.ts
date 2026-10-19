import type { MicrosoftErrorCode } from '@shared/microsoft';
import type { FetchLike } from '../launch/json-cache';
import { isRecord } from '../site/guards';
import { MicrosoftFailure, microsoftFailure } from './errors';

const MINECRAFT_RELYING_PARTY = 'rp://api.minecraftservices.com/';
const MINECRAFT_API = 'https://api.minecraftservices.com';
const PROFILE_ID = /^[0-9a-f]{32}$/i;
const PROFILE_NAME = /^[A-Za-z0-9_]{1,16}$/;
const DEFAULT_LIFETIME_S = 3600;
const MAX_LIFETIME_S = 7 * 24 * 3600;

const XSTS_ERRORS = new Map<number, MicrosoftErrorCode>([
  [2148916233, 'no_xbox_profile'],
  [2148916235, 'xbox_region'],
  [2148916236, 'xbox_adult_required'],
  [2148916237, 'xbox_adult_required'],
  [2148916238, 'xbox_child'],
]);

export interface MinecraftSession {
  uuid: string;
  nick: string;
  accessToken: string;
  expiresAt: number;
}

interface MinecraftProfile {
  uuid: string;
  nick: string;
}

async function step<T>(
  run: () => Promise<T>,
  codeOf: (error: unknown) => MicrosoftErrorCode,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof MicrosoftFailure ? error : microsoftFailure(codeOf(error));
  }
}

function xstsCode(error: unknown): MicrosoftErrorCode {
  const xerr = Number(isRecord(error) ? error.XErr : undefined);
  return XSTS_ERRORS.get(xerr) ?? 'xbox_failed';
}

function loginCode(error: unknown): MicrosoftErrorCode {
  return isRecord(error) && error.status === 403 ? 'app_not_approved' : 'failed';
}

function userHash(response: unknown): string {
  const claims = isRecord(response) ? response.DisplayClaims : null;
  const users: unknown = isRecord(claims) ? claims.xui : null;
  const first: unknown = Array.isArray(users) ? users[0] : null;
  const hash = isRecord(first) ? first.uhs : null;
  if (typeof hash !== 'string' || hash.length === 0) {
    throw microsoftFailure('xbox_failed');
  }
  return hash;
}

async function getJson(fetch: FetchLike, path: string, accessToken: string): Promise<Response> {
  return fetch(`${MINECRAFT_API}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
}

async function ownsGame(fetch: FetchLike, accessToken: string): Promise<boolean> {
  const response = await getJson(fetch, '/entitlements/mcstore', accessToken);
  if (!response.ok) {
    throw microsoftFailure('failed');
  }
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && Array.isArray(body.items) && body.items.length > 0;
}

async function readProfile(
  fetch: FetchLike,
  accessToken: string,
): Promise<MinecraftProfile | null> {
  const response = await getJson(fetch, '/minecraft/profile', accessToken);
  if (response.status === 404) {
    return null;
  }
  const body: unknown = response.ok ? await response.json().catch(() => null) : null;
  if (
    !isRecord(body) ||
    typeof body.id !== 'string' ||
    typeof body.name !== 'string' ||
    !PROFILE_ID.test(body.id) ||
    !PROFILE_NAME.test(body.name)
  ) {
    throw microsoftFailure('failed');
  }
  return { uuid: body.id.toLowerCase(), nick: body.name };
}

function lifetimeMs(value: unknown): number {
  const seconds =
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_LIFETIME_S;
  return Math.min(seconds, MAX_LIFETIME_S) * 1000;
}

// The steps of @xmcl/user are called one by one: its acquireXBoxToken also registers a device
// key and asks for a second XSTS token, which the Minecraft sign-in does not need.
export async function minecraftSession(
  fetch: FetchLike,
  microsoftAccessToken: string,
  now: () => number,
): Promise<MinecraftSession> {
  const { MicrosoftAuthenticator } = await import('@xmcl/user');
  // The library only calls fetch(url, init) with a string url, which is what FetchLike takes.
  const xbox = new MicrosoftAuthenticator({ fetch: fetch as typeof globalThis.fetch });
  const user = await step(
    () => xbox.authenticateXboxLive(microsoftAccessToken),
    () => 'xbox_failed',
  );
  const xsts = await step(
    () => xbox.authorizeXboxLive(user.Token, MINECRAFT_RELYING_PARTY),
    xstsCode,
  );
  const login = await step(
    () => xbox.loginMinecraftWithXBox(userHash(xsts), xsts.Token),
    loginCode,
  );
  const accessToken = login.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw microsoftFailure('failed');
  }
  const expiresAt = now() + lifetimeMs(login.expires_in);
  // Game Pass accounts have a profile but an empty entitlement list, so the profile decides;
  // purchases are asked only to tell 'no nickname yet' from 'no game'.
  const profile = await readProfile(fetch, accessToken);
  if (profile === null) {
    throw microsoftFailure((await ownsGame(fetch, accessToken)) ? 'no_profile' : 'not_owned');
  }
  return { ...profile, accessToken, expiresAt };
}
