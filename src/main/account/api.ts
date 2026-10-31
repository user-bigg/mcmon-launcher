import {
  PLAY_CHECK_TIMEOUT_MS,
  type PinnedNick,
  type SiteNick,
  type PlayCheckQuery,
  type VotePause,
  type VoteResult,
} from '@shared/account';
import type { AlertFeed, AlertSettings } from '@shared/alerts';
import type { OwnedServer, OwnedServerDetails } from '@shared/owner';
import type { MyReport, ReportDraft } from '@shared/report';
import type { TelemetryDevice } from '@shared/telemetry';
import type { Sent, SiteHttp } from '../site/http';
import {
  parseCapeAnswer,
  parseSkinAnswer,
  type CapeAnswer,
  type LocalTexture,
  type SkinAnswer,
} from '../site/look';
import {
  parseAlertFeed,
  parseAlertSettings,
  parseEmpty,
  parseSiteNick,
  parseFavoriteFlag,
  parseFavoriteIds,
  parseIssuedToken,
  parseNickChange,
  parseOwnedServer,
  parseOwnedServers,
  parsePlayAllowed,
  parseProfile,
  parseReportResult,
  parseVotePauses,
  parseVoteResult,
  parseWatchFlag,
  type IssuedToken,
  type PlayAllowed,
  type Profile,
} from './parse';

export interface TokenRequest {
  code: string;
  verifier: string;
  install: string;
  device: TelemetryDevice;
}

export interface AccountApi {
  exchange: (request: TokenRequest) => Promise<Sent<IssuedToken>>;
  revoke: (token: string) => Promise<Sent<true>>;
  me: (token: string) => Promise<Sent<Profile>>;
  favorites: (token: string) => Promise<Sent<number[]>>;
  setFavorite: (token: string, id: number, favorite: boolean) => Promise<Sent<boolean>>;
  vote: (token: string, id: number, nick: string) => Promise<Sent<VoteResult>>;
  report: (token: string, id: number, draft: ReportDraft) => Promise<Sent<MyReport>>;
  alerts: (token: string, after: string | null) => Promise<Sent<AlertFeed>>;
  readAlerts: (token: string, ids: number[] | null) => Promise<Sent<true>>;
  clearAlerts: (token: string) => Promise<Sent<true>>;
  setWatch: (token: string, id: number, watch: boolean) => Promise<Sent<boolean>>;
  alertSettings: (token: string) => Promise<Sent<AlertSettings>>;
  setAlertSettings: (token: string, settings: AlertSettings) => Promise<Sent<AlertSettings>>;
  ownedServers: (token: string) => Promise<Sent<OwnedServer[]>>;
  ownedServer: (token: string, id: number) => Promise<Sent<OwnedServerDetails>>;
  votePauses: (token: string) => Promise<Sent<VotePause[]>>;
  setNick: (token: string, nick: string) => Promise<Sent<PinnedNick>>;
  playCheck: (token: string | null, query: PlayCheckQuery) => Promise<Sent<PlayAllowed>>;
  setSkin: (token: string, preset: string) => Promise<Sent<SkinAnswer>>;
  removeSkin: (token: string) => Promise<Sent<SkinAnswer>>;
  setCape: (token: string, preset: string) => Promise<Sent<CapeAnswer>>;
  removeCape: (token: string) => Promise<Sent<CapeAnswer>>;
  addNick: (token: string, nick: string) => Promise<Sent<SiteNick>>;
  removeNick: (token: string, nick: string) => Promise<Sent<true>>;
  setAvatarNick: (token: string, nick: string) => Promise<Sent<true>>;
  setNickSkin: (token: string, nick: string, preset: string) => Promise<Sent<true>>;
  removeNickSkin: (token: string, nick: string) => Promise<Sent<true>>;
  setNickCape: (token: string, nick: string, preset: string | null) => Promise<Sent<true>>;
}

function nickPath(nick: string, rest = ''): string {
  return `/me/nicks/${encodeURIComponent(nick)}${rest}`;
}

export function createAccountApi(
  http: SiteHttp,
  local: LocalTexture = (remote) => remote,
): AccountApi {
  const skinAnswer = (body: unknown): SkinAnswer | null => parseSkinAnswer(body, local);
  const capeAnswer = (body: unknown): CapeAnswer | null => parseCapeAnswer(body, local);
  return {
    exchange: (request) =>
      http.send('/auth/token', {
        method: 'POST',
        token: null,
        body: request,
        parse: parseIssuedToken,
        bucket: 'account',
      }),
    revoke: (token) => http.send('/auth/token', { method: 'DELETE', token, parse: parseEmpty }),
    me: (token) =>
      http.send('/me', { method: 'GET', token, parse: (body) => parseProfile(body, local) }),
    favorites: (token) =>
      http.send('/me/favorites', { method: 'GET', token, parse: parseFavoriteIds }),
    setFavorite: (token, id, favorite) =>
      http.send(`/me/favorites/${String(id)}`, {
        method: favorite ? 'PUT' : 'DELETE',
        token,
        parse: parseFavoriteFlag,
      }),
    vote: (token, id, nick) =>
      http.send(`/servers/${String(id)}/votes`, {
        method: 'POST',
        token,
        body: { nick },
        parse: parseVoteResult,
        bucket: 'account',
      }),
    report: (token, id, draft) =>
      http.send(`/servers/${String(id)}/reports`, {
        method: 'POST',
        token,
        body: { reason: draft.reason, note: draft.note },
        parse: parseReportResult,
        bucket: 'account',
      }),
    alerts: (token, after) =>
      http.send(after === null ? '/me/alerts' : `/me/alerts?after=${encodeURIComponent(after)}`, {
        method: 'GET',
        token,
        parse: parseAlertFeed,
      }),
    readAlerts: (token, ids) =>
      http.send('/me/alerts/read', {
        method: 'POST',
        token,
        body: ids === null ? {} : { ids },
        parse: parseEmpty,
      }),
    clearAlerts: (token) =>
      http.send('/me/alerts/clear', { method: 'POST', token, body: {}, parse: parseEmpty }),
    setWatch: (token, id, watch) =>
      http.send(`/me/watches/${String(id)}`, {
        method: watch ? 'PUT' : 'DELETE',
        token,
        parse: (body) => parseWatchFlag(body) ?? watch,
      }),
    alertSettings: (token) =>
      http.send('/me/alert-settings', { method: 'GET', token, parse: parseAlertSettings }),
    setAlertSettings: (token, settings) =>
      http.send('/me/alert-settings', {
        method: 'PUT',
        token,
        body: settings,
        parse: parseAlertSettings,
      }),
    ownedServers: (token) =>
      http.send('/me/servers', { method: 'GET', token, parse: parseOwnedServers }),
    ownedServer: (token, id) =>
      http.send(`/me/servers/${String(id)}`, { method: 'GET', token, parse: parseOwnedServer }),
    votePauses: (token) => http.send('/me/votes', { method: 'GET', token, parse: parseVotePauses }),
    setNick: (token, nick) =>
      http.send('/me/nick', {
        method: 'PUT',
        token,
        body: { nick },
        parse: parseNickChange,
        bucket: 'account',
      }),
    playCheck: (token, query) =>
      http.send('/play/check', {
        method: 'POST',
        token,
        body: {
          ...(query.serverId === null ? {} : { server_id: query.serverId }),
          nick: query.nick,
          auth: query.auth,
        },
        parse: parsePlayAllowed,
        bucket: 'account',
        timeoutMs: PLAY_CHECK_TIMEOUT_MS,
      }),
    setSkin: (token, preset) =>
      http.send('/me/skin', {
        method: 'PUT',
        token,
        body: { preset },
        parse: skinAnswer,
        bucket: 'skin',
      }),
    removeSkin: (token) =>
      http.send('/me/skin', { method: 'DELETE', token, parse: skinAnswer, bucket: 'skin' }),
    setCape: (token, preset) =>
      http.send('/me/cape', {
        method: 'PUT',
        token,
        body: { preset },
        parse: capeAnswer,
        bucket: 'cape',
      }),
    removeCape: (token) =>
      http.send('/me/cape', { method: 'DELETE', token, parse: capeAnswer, bucket: 'cape' }),
    addNick: (token, nick) =>
      http.send('/me/nicks', {
        method: 'POST',
        token,
        body: { nick },
        parse: parseSiteNick,
        bucket: 'account',
      }),
    removeNick: (token, nick) =>
      http.send(nickPath(nick), { method: 'DELETE', token, parse: parseEmpty, bucket: 'account' }),
    setAvatarNick: (token, nick) =>
      http.send('/me/avatar', {
        method: 'PUT',
        token,
        body: { nick },
        parse: parseEmpty,
        bucket: 'account',
      }),
    setNickSkin: (token, nick, preset) =>
      http.send(nickPath(nick, '/skin'), {
        method: 'PUT',
        token,
        body: { preset },
        parse: parseEmpty,
        bucket: 'skin',
      }),
    removeNickSkin: (token, nick) =>
      http.send(nickPath(nick, '/skin'), {
        method: 'DELETE',
        token,
        parse: parseEmpty,
        bucket: 'skin',
      }),
    setNickCape: (token, nick, preset) =>
      http.send(nickPath(nick, '/cape'), {
        method: 'PUT',
        token,
        body: { cape: preset },
        parse: parseEmpty,
        bucket: 'cape',
      }),
  };
}
