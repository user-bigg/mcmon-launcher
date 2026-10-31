import {
  MAX_LOGIN_CODE_INPUT,
  parsePlayCheckQuery,
  type AccountService,
  type NickResult,
  type PlayCheck,
} from '@shared/account';
import { isValidNick } from '@shared/launch';
import { parseLookChange, type LookResult } from '@shared/look';
import { IpcChannels } from '@shared/ipc';
import { handleInvokes, listenSubscriptions, type InvokeHandlers } from '../ipc';
import { accountFailure } from './errors';
import type { AccountManager } from './manager';

const UNTRUSTED = accountFailure('forbidden');
const FAILED = accountFailure('server_error');

export type AccountControl = Pick<
  AccountManager,
  | 'state'
  | 'connect'
  | 'reopen'
  | 'submitCode'
  | 'cancel'
  | 'logout'
  | 'refresh'
  | 'setNick'
  | 'playCheck'
  | 'addSiteNick'
  | 'removeSiteNick'
  | 'setAvatarNick'
  | 'wear'
  | 'resetLook'
  | 'onEvent'
>;

const UNCHECKED: PlayCheck = { kind: 'unchecked' };
const NOT_WORN: LookResult = { ok: false, error: { code: 'failed' } };

function nickCall(
  nick: unknown,
  call: (nick: string) => Promise<NickResult>,
): NickResult | Promise<NickResult> {
  return typeof nick === 'string' && isValidNick(nick)
    ? call(nick)
    : { ok: false, error: { code: 'invalid_nick' } };
}

export function accountHandlers(manager: AccountControl): InvokeHandlers<AccountService> {
  return {
    state: () => manager.state(),
    connect: () => manager.connect(),
    reopen: () => manager.reopen(),
    submitCode: (code) =>
      typeof code === 'string' && code.length <= MAX_LOGIN_CODE_INPUT
        ? manager.submitCode(code)
        : accountFailure('invalid_code_format'),
    cancel: () => manager.cancel(),
    logout: () => manager.logout(),
    refresh: () => manager.refresh(),
    setNick: (nick) =>
      typeof nick === 'string' && isValidNick(nick)
        ? manager.setNick(nick)
        : { ok: false, error: { code: 'invalid_nick' } },
    playCheck: (query): PlayCheck | Promise<PlayCheck> => {
      const parsed = parsePlayCheckQuery(query);
      // Only the nickname is the window's to check: a check for a server would issue a play
      // code and cancel the one the running game holds.
      return parsed === null ? UNCHECKED : manager.playCheck({ ...parsed, serverId: null });
    },
    addSiteNick: (nick) => nickCall(nick, (valid) => manager.addSiteNick(valid)),
    removeSiteNick: (nick) => nickCall(nick, (valid) => manager.removeSiteNick(valid)),
    setAvatarNick: (nick) => nickCall(nick, (valid) => manager.setAvatarNick(valid)),
    wear: (change): LookResult | Promise<LookResult> => {
      const parsed = parseLookChange(change);
      return parsed === null ? NOT_WORN : manager.wear(parsed);
    },
    resetLook: (nick) =>
      nick === undefined
        ? manager.resetLook()
        : typeof nick === 'string' && isValidNick(nick)
          ? manager.resetLook(nick)
          : NOT_WORN,
  };
}

export function registerAccountIpc(
  manager: AccountControl,
  devServerUrl: string | undefined,
): void {
  handleInvokes<AccountService>(IpcChannels.account.invoke, accountHandlers(manager), {
    devServerUrl,
    untrusted: UNTRUSTED,
    onError: () => FAILED,
  });
  const { events } = IpcChannels.account;
  const subscribers = listenSubscriptions(events, devServerUrl);
  manager.onEvent((event) => {
    subscribers.send(events.event, event);
  });
}
