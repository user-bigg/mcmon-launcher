import { MAX_VOTE_NICK_LENGTH } from '@shared/account';
import {
  MAX_ALERT_CURSOR_LENGTH,
  MAX_ALERT_ID,
  MAX_ALERT_ITEMS,
  PLAYER_ALERT_KINDS,
  type AlertSettings,
} from '@shared/alerts';
import { isValidServerId } from '@shared/launch';
import {
  isReportReason,
  MAX_REPORT_NOTE_LENGTH,
  reportReady,
  type ReportDraft,
} from '@shared/report';
import { SCENE_KEY_PATTERN, SCENE_TIMES, type SceneTime } from '@shared/scenes';
import { parseServerAddress, type ServerAddress } from '@shared/server-address';
import {
  MAX_LIVE_IDS,
  MAX_PER_PAGE,
  MAX_QUERY_LENGTH,
  SERVER_ACCESS_FILTERS,
  SERVER_SORTS,
  type ServerQuery,
} from '@shared/site';
import { integer, isRecord, line, oneOf, text } from './guards';

export type Checked<T> =
  { ok: true; value: T } | { ok: false; error: { code: 'invalid-request'; field: string } };

const QUERY_KEYS = new Set(['q', 'version', 'mode', 'access', 'sort', 'page', 'per_page']);
const VERSION_FILTER = /^[A-Za-z0-9.+_-]{1,32}([–-][A-Za-z0-9.+_-]{1,32})?$/;
const MODE = /^[a-z0-9_-]{1,32}$/;
const MAX_MODES = 10;
const MAX_PAGE = 10_000;
const MAX_ADDRESS_LENGTH = 261;

function invalid(field: string): Checked<never> {
  return { ok: false, error: { code: 'invalid-request', field } };
}

function checkMode(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_MODES) {
    return null;
  }
  const modes = value.filter((item): item is string => typeof item === 'string' && MODE.test(item));
  return modes.length === value.length ? [...new Set(modes)] : null;
}

export function checkServerQuery(value: unknown): Checked<ServerQuery> {
  const source = value === undefined ? {} : value;
  if (!isRecord(source) || Object.keys(source).some((key) => !QUERY_KEYS.has(key))) {
    return invalid('query');
  }
  const query: ServerQuery = {};
  if (source.q !== undefined) {
    const q = line(source.q, MAX_QUERY_LENGTH);
    if (q === null) {
      return invalid('q');
    }
    if (q.trim() !== '') {
      query.q = q.trim();
    }
  }
  if (source.version !== undefined) {
    if (typeof source.version !== 'string' || !VERSION_FILTER.test(source.version)) {
      return invalid('version');
    }
    query.version = source.version;
  }
  if (source.mode !== undefined) {
    const mode = checkMode(source.mode);
    if (mode === null) {
      return invalid('mode');
    }
    query.mode = mode;
  }
  if (source.access !== undefined) {
    const access = oneOf(source.access, SERVER_ACCESS_FILTERS);
    if (access === null) {
      return invalid('access');
    }
    query.access = access;
  }
  if (source.sort !== undefined) {
    const sort = oneOf(source.sort, SERVER_SORTS);
    if (sort === null) {
      return invalid('sort');
    }
    query.sort = sort;
  }
  if (source.page !== undefined) {
    const page = integer(source.page, 1, MAX_PAGE);
    if (page === null) {
      return invalid('page');
    }
    query.page = page;
  }
  if (source.per_page !== undefined) {
    const perPage = integer(source.per_page, 1, MAX_PER_PAGE);
    if (perPage === null) {
      return invalid('per_page');
    }
    query.per_page = perPage;
  }
  return { ok: true, value: query };
}

export function checkServerId(value: unknown): Checked<number> {
  return isValidServerId(value) ? { ok: true, value } : invalid('id');
}

export function checkLiveIds(value: unknown): Checked<number[]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIVE_IDS) {
    return invalid('ids');
  }
  if (!value.every((id) => isValidServerId(id))) {
    return invalid('ids');
  }
  return { ok: true, value: [...new Set(value)] };
}

export function checkScene(
  scene: unknown,
  time: unknown,
): Checked<{ scene: string; time: SceneTime }> {
  if (typeof scene !== 'string' || !SCENE_KEY_PATTERN.test(scene)) {
    return invalid('scene');
  }
  const checkedTime = oneOf(time, SCENE_TIMES);
  return checkedTime === null ? invalid('time') : { ok: true, value: { scene, time: checkedTime } };
}

export function checkAddress(value: unknown): Checked<ServerAddress> {
  if (typeof value !== 'string' || value.length > MAX_ADDRESS_LENGTH) {
    return invalid('address');
  }
  const address = parseServerAddress(value);
  return address === null ? invalid('address') : { ok: true, value: address };
}

export function checkFavorite(
  id: unknown,
  favorite: unknown,
): Checked<{ id: number; favorite: boolean }> {
  if (!isValidServerId(id)) {
    return invalid('id');
  }
  return typeof favorite === 'boolean'
    ? { ok: true, value: { id, favorite } }
    : invalid('favorite');
}

const REPORT_KEYS = new Set(['reason', 'note']);

export function checkReport(
  id: unknown,
  draft: unknown,
): Checked<{ id: number; draft: ReportDraft }> {
  if (!isValidServerId(id)) {
    return invalid('id');
  }
  if (!isRecord(draft) || Object.keys(draft).some((key) => !REPORT_KEYS.has(key))) {
    return invalid('draft');
  }
  if (!isReportReason(draft.reason)) {
    return invalid('reason');
  }
  const note = text(draft.note ?? '', MAX_REPORT_NOTE_LENGTH)?.trim() ?? null;
  if (note === null) {
    return invalid('note_length');
  }
  const checked = { reason: draft.reason, note };
  return reportReady(checked) ? { ok: true, value: { id, draft: checked } } : invalid('note');
}

export function checkVote(id: unknown, nick: unknown): Checked<{ id: number; nick: string }> {
  if (!isValidServerId(id)) {
    return invalid('id');
  }
  const checked = line(nick, MAX_VOTE_NICK_LENGTH)?.trim() ?? '';
  return checked === '' ? invalid('nick') : { ok: true, value: { id, nick: checked } };
}

const CURSOR = /^[A-Za-z0-9_\-.:=]+$/;

export function checkAlertCursor(value: unknown): Checked<string | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  const cursor = line(value, MAX_ALERT_CURSOR_LENGTH);
  return cursor !== null && CURSOR.test(cursor) ? { ok: true, value: cursor } : invalid('after');
}

export function checkAlertSettings(value: unknown): Checked<AlertSettings> {
  if (!isRecord(value) || Object.keys(value).length !== PLAYER_ALERT_KINDS.length) {
    return invalid('settings');
  }
  const [wipe, up, removed] = PLAYER_ALERT_KINDS.map((kind) => value[kind]);
  return typeof wipe === 'boolean' && typeof up === 'boolean' && typeof removed === 'boolean'
    ? { ok: true, value: { favorite_wipe: wipe, watched_up: up, server_removed: removed } }
    : invalid('settings');
}

export function checkAlertIds(value: unknown): Checked<number[] | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ALERT_ITEMS) {
    return invalid('ids');
  }
  const ids = value.filter((id): id is number => integer(id, 1, MAX_ALERT_ID) !== null);
  return ids.length === value.length ? { ok: true, value: ids } : invalid('ids');
}
