import { isLoaderId } from '@shared/instance';
import { isValidNick, isValidServerId } from '@shared/launch';
import {
  isModSlug,
  isModVersion,
  MAX_ENABLED_MODS,
  MOD_STATES,
  type TelemetryMod,
} from '@shared/mods';
import type { SiteError } from '@shared/site';
import {
  ACTION_NAMES,
  APP_ALIVE_STATES,
  APP_START_REASONS,
  BEHAVIOR_ONLY_FIELDS,
  CATALOG_TABS,
  isBehaviorEvent,
  isBehaviorType,
  isLaunchId,
  isUuid,
  LAUNCH_TELEMETRY_TYPES,
  LINK_KINDS,
  PLAY_SOURCES,
  TELEMETRY_BATCH_SIZE,
  TELEMETRY_FIELDS,
  TELEMETRY_SCREENS,
  TELEMETRY_SKINS,
  VOTE_OUTCOMES,
  type ActionEvent,
  type AppAliveState,
  type BehaviorTelemetryEvent,
  type LaunchTelemetryEvent,
  type TelemetryEvent,
  type TelemetryEventType,
  type TelemetryLane,
  type TelemetryPacket,
} from '@shared/telemetry';
import { isRecord, list } from './guards';
import type { Posted } from './http';

export const MAX_QUEUED_EVENTS = 1000;
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000] as const;
const PERIODIC_FLUSH_MS = 15 * 60_000;
const SOON_MS = 2000;
export const BEHAVIOR_FLUSH_MS = 60_000;
export const ALIVE_MS = 5 * 60_000;
const QUEUE_FORMAT = 2;
const UNTAGGED_FORMAT = 1;

export type TelemetryHeader = Omit<TelemetryPacket, 'events'>;

export interface TelemetrySession {
  user: number;
  token: string;
}

interface QueuedEvent {
  user: number | null;
  event: TelemetryEvent;
}

const EVICTION_ORDER: readonly (readonly TelemetryEventType[])[] = [
  ['screen.viewed', 'action'],
  ['app.started', 'app.closed', 'vote.finished'],
  LAUNCH_TELEMETRY_TYPES,
];

export interface QueueStore {
  read: () => Promise<unknown>;
  write: (data: unknown) => Promise<void>;
}

export interface TelemetryQueueDeps {
  store: QueueStore;
  header: () => Promise<TelemetryHeader>;
  session: () => TelemetrySession | null;
  send: (packet: TelemetryPacket, token: string | null, lane: TelemetryLane) => Promise<Posted>;
  isOnline: () => boolean;
  behavior: boolean;
  aliveState: () => AppAliveState;
  now: () => number;
  newId: () => string;
  setTimer: (run: () => void, ms: number) => () => void;
  log: (message: string) => void;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableNumber(value: unknown): number | null {
  return finite(value) ? value : null;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return allowed.find((item) => item === value) ?? null;
}

function count(value: unknown): number | null {
  return finite(value) && value >= 0 ? Math.round(value) : null;
}

type Fields = Record<string, unknown>;
type ActionExtras = Omit<ActionEvent, 'type' | 'at' | 'name' | 'server_id'>;

function playExtras(event: Fields): ActionExtras | null {
  const source = oneOf(PLAY_SOURCES, event.source);
  return source === null || !isLaunchId(event.launch_id)
    ? null
    : { source, launch_id: event.launch_id };
}

function searchExtras(event: Fields): ActionExtras | null {
  const length = count(event.length);
  const results = count(event.results);
  return length === null || results === null ? null : { length, results };
}

function actionExtras(name: ActionEvent['name'], event: Fields): ActionExtras | null {
  switch (name) {
    case 'play':
      return playExtras(event);
    case 'link_open': {
      const kind = oneOf(LINK_KINDS, event.kind);
      return kind === null ? null : { kind };
    }
    case 'search':
      return searchExtras(event);
    case 'tab': {
      const tab = oneOf(CATALOG_TABS, event.tab);
      return tab === null ? null : { tab };
    }
    default:
      return {};
  }
}

function actionEvent(at: string, event: Fields): BehaviorTelemetryEvent | null {
  const name = oneOf(ACTION_NAMES, event.name);
  const extras = name === null ? null : actionExtras(name, event);
  if (name === null || extras === null) {
    return null;
  }
  const serverId = isValidServerId(event.server_id) ? event.server_id : null;
  return { type: 'action', at, name, server_id: serverId, ...extras };
}

function appEvent(at: string, event: Fields): BehaviorTelemetryEvent | null {
  switch (event.type) {
    case 'app.started': {
      const reason = oneOf(APP_START_REASONS, event.reason);
      return reason === null ? null : { type: 'app.started', at, reason };
    }
    case 'app.closed': {
      const duration = count(event.duration_s);
      return duration === null ? null : { type: 'app.closed', at, duration_s: duration };
    }
    case 'app.alive': {
      const state = oneOf(APP_ALIVE_STATES, event.state);
      return state === null ? null : { type: 'app.alive', at, state };
    }
    default:
      return null;
  }
}

function behaviorEvent(at: string, event: Fields): BehaviorTelemetryEvent | null {
  switch (event.type) {
    case 'screen.viewed': {
      const screen = oneOf(TELEMETRY_SCREENS, event.screen);
      const serverId =
        screen === 'server' && isValidServerId(event.server_id) ? event.server_id : null;
      return screen === null ? null : { type: 'screen.viewed', at, screen, server_id: serverId };
    }
    case 'action':
      return actionEvent(at, event);
    case 'vote.finished': {
      const outcome = oneOf(VOTE_OUTCOMES, event.outcome);
      return outcome === null || !isValidServerId(event.server_id)
        ? null
        : { type: 'vote.finished', at, server_id: event.server_id, outcome };
    }
    default:
      return appEvent(at, event);
  }
}

function telemetryMod(value: unknown): TelemetryMod | null {
  if (!isRecord(value) || !isModSlug(value.slug)) {
    return null;
  }
  const state = MOD_STATES.find((item) => item === value.state);
  if (state === undefined) {
    return null;
  }
  if (state !== 'on') {
    return { slug: value.slug, state };
  }
  return isModVersion(value.version) ? { slug: value.slug, state, version: value.version } : null;
}

// Each mod is named once and a list with nothing in it is not sent at all.
function telemetryModsOf(value: unknown): { mods?: TelemetryMod[] } {
  const mods: TelemetryMod[] = [];
  for (const item of list(value).slice(0, MAX_ENABLED_MODS)) {
    const mod = telemetryMod(item);
    if (mod !== null && !mods.some((known) => known.slug === mod.slug)) {
      mods.push(mod);
    }
  }
  return mods.length === 0 ? {} : { mods };
}

function launchEvent(event: Fields & { at: string }): LaunchTelemetryEvent | null {
  const serverId = finite(event.server_id) ? event.server_id : null;
  switch (event.type) {
    case 'install.finished':
      return {
        type: 'install.finished',
        at: event.at,
        minecraft: String(event.minecraft),
        loader: isLoaderId(event.loader) ? event.loader : 'vanilla',
        outcome: event.outcome === 'ok' ? 'ok' : 'error',
        error_code: typeof event.error_code === 'string' ? event.error_code : null,
        duration_s: finite(event.duration_s) ? event.duration_s : 0,
        bytes: finite(event.bytes) ? event.bytes : 0,
      };
    case 'launch.started': {
      const nick =
        serverId !== null && typeof event.nick === 'string' && isValidNick(event.nick)
          ? { nick: event.nick }
          : {};
      const launchId = isLaunchId(event.launch_id) ? { launch_id: event.launch_id } : {};
      const skins = TELEMETRY_SKINS.find((value) => value === event.skins);
      const clientMod = TELEMETRY_SKINS.find((value) => value === event.client_mod);
      return {
        type: 'launch.started',
        at: event.at,
        server_id: serverId,
        minecraft: String(event.minecraft),
        loader: isLoaderId(event.loader) ? event.loader : 'vanilla',
        account: event.account === 'microsoft' ? 'microsoft' : 'nick',
        ram_mb: finite(event.ram_mb) ? event.ram_mb : 0,
        java_major: finite(event.java_major) ? event.java_major : 0,
        ...nick,
        ...launchId,
        ...(skins === undefined ? {} : { skins }),
        ...(clientMod === undefined ? {} : { client_mod: clientMod }),
        ...telemetryModsOf(event.mods),
      };
    }
    case 'launch.finished':
      return {
        type: 'launch.finished',
        at: event.at,
        server_id: serverId,
        outcome: event.outcome === 'ok' || event.outcome === 'crash' ? event.outcome : 'exit',
        exit_code: nullableNumber(event.exit_code),
        duration_s: finite(event.duration_s) ? event.duration_s : 0,
        time_to_window_s: nullableNumber(event.time_to_window_s),
      };
    default:
      return null;
  }
}

function typedEvent(event: unknown, behavior: boolean): TelemetryEvent | null {
  if (!isRecord(event) || typeof event.at !== 'string') {
    return null;
  }
  const launch = launchEvent({ ...event, at: event.at });
  if (launch !== null || !behavior) {
    return launch;
  }
  const clean = behaviorEvent(event.at, event);
  return clean !== null && isUuid(event.id) ? { ...clean, id: event.id } : clean;
}

function withSchemaFields(event: TelemetryEvent, behavior: boolean): TelemetryEvent {
  const fields: readonly string[] = TELEMETRY_FIELDS[event.type];
  const hidden: readonly string[] = behavior ? [] : BEHAVIOR_ONLY_FIELDS;
  const allowed = ['type', ...fields.filter((field) => !hidden.includes(field))];
  return Object.fromEntries(
    Object.entries(event).filter(([key]) => allowed.includes(key)),
  ) as TelemetryEvent;
}

export function sanitizeEvent(event: unknown, behavior = false): TelemetryEvent | null {
  const typed = typedEvent(event, behavior);
  return typed === null ? null : withSchemaFields(typed, behavior);
}

export function rendererEvent(event: unknown, at: string): TelemetryEvent | null {
  if (!isRecord(event) || (event.type !== 'screen.viewed' && event.type !== 'action')) {
    return null;
  }
  return sanitizeEvent({ ...event, at, id: undefined }, true);
}

export function capped(events: readonly QueuedEvent[]): QueuedEvent[] {
  let excess = events.length - MAX_QUEUED_EVENTS;
  let kept = [...events];
  for (const tier of EVICTION_ORDER) {
    kept = kept.filter((item) => {
      const evicted = excess > 0 && tier.includes(item.event.type);
      excess -= evicted ? 1 : 0;
      return !evicted;
    });
  }
  return kept;
}

export function retryDelay(failures: number, error: SiteError): number {
  if (error.code === 'rate-limited' && error.retryAfterS !== undefined) {
    return error.retryAfterS * 1000;
  }
  return RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0];
}

function isDropped(error: SiteError): boolean {
  return error.code === 'invalid-request';
}

function queuedOf(item: unknown, behavior: boolean): QueuedEvent | null {
  if (!isRecord(item)) {
    return null;
  }
  const event = sanitizeEvent(item.event, behavior);
  const user = typeof item.user === 'number' && Number.isInteger(item.user) ? item.user : null;
  return event === null ? null : { user, event };
}

function restoredQueue(value: unknown, behavior: boolean): QueuedEvent[] {
  if (!isRecord(value)) {
    return [];
  }
  if (value.format === UNTAGGED_FORMAT) {
    return list(value.events).flatMap((item) => {
      const event = sanitizeEvent(item, behavior);
      return event === null ? [] : [{ user: null, event }];
    });
  }
  if (value.format !== QUEUE_FORMAT) {
    return [];
  }
  return list(value.events).flatMap((item) => {
    const queued = queuedOf(item, behavior);
    return queued === null ? [] : [queued];
  });
}

function laneOf(item: QueuedEvent): TelemetryLane {
  return isBehaviorType(item.event.type) ? 'behavior' : 'launch';
}

function nextBatch(events: readonly QueuedEvent[], lane: TelemetryLane): QueuedEvent[] {
  const pending = events.filter((item) => laneOf(item) === lane);
  const user = pending[0]?.user ?? null;
  const end = pending.findIndex(
    (item, index) => index >= TELEMETRY_BATCH_SIZE || item.user !== user,
  );
  return pending.slice(0, end === -1 ? pending.length : end);
}

export class TelemetryQueue {
  private events: QueuedEvent[] = [];
  private loaded: Promise<void> | null = null;
  private sending: Promise<void> | null = null;
  private failures = 0;
  private behaviorFailures = 0;
  private cancelRetry: (() => void) | null = null;
  private cancelPeriodic: (() => void) | null = null;
  private cancelBehavior: (() => void) | null = null;
  private cancelBehaviorRetry: (() => void) | null = null;
  private cancelAlive: (() => void) | null = null;
  private closing: QueuedEvent | null = null;
  private closeAttempt = 0;
  private readonly wanted = new Set<TelemetryLane>();
  private dirty = false;
  private persisting: Promise<void> | null = null;

  constructor(private readonly deps: TelemetryQueueDeps) {}

  start(): void {
    void this.load().then(() => {
      this.schedule(SOON_MS);
    });
    this.periodic();
    this.armAlive();
  }

  dispose(): void {
    this.cancelRetry?.();
    this.cancelPeriodic?.();
    this.cancelBehavior?.();
    this.cancelBehaviorRetry?.();
    this.cancelAlive?.();
  }

  get size(): number {
    return this.events.length;
  }

  push(event: TelemetryEvent): void {
    void this.add(event);
  }

  async close(event: TelemetryEvent): Promise<void> {
    if (!this.deps.behavior) {
      return;
    }
    this.closeAttempt += 1;
    const attempt = this.closeAttempt;
    const queued = await this.add(event);
    if (attempt !== this.closeAttempt) {
      this.drop(queued);
      return;
    }
    this.closing = queued;
    await this.flush();
    await this.settled();
  }

  // The launcher stays open after all: the farewell event must not reach the site later.
  reopen(): void {
    this.closeAttempt += 1;
    this.drop(this.closing);
    this.closing = null;
  }

  private drop(queued: QueuedEvent | null): void {
    if (queued !== null && this.events.includes(queued)) {
      this.events = this.events.filter((item) => item !== queued);
      this.persist();
    }
  }

  private async add(event: TelemetryEvent): Promise<QueuedEvent | null> {
    const clean = sanitizeEvent(event, this.deps.behavior);
    if (clean === null || clean.type === 'app.alive') {
      return null;
    }
    const queued = { user: this.deps.session()?.user ?? null, event: this.identified(clean) };
    await this.load();
    this.events = capped([...this.events, queued]);
    this.persist();
    if (clean.type === 'launch.finished' && this.failures === 0) {
      this.schedule(SOON_MS);
    } else if (isBehaviorType(clean.type)) {
      this.scheduleBehavior();
    }
    return queued;
  }

  // The site drops repeats by this id, so it is given once and survives retries and restarts.
  private identified(event: TelemetryEvent): TelemetryEvent {
    return isBehaviorEvent(event) && event.id === undefined
      ? { ...event, id: this.deps.newId() }
      : event;
  }

  async preview(): Promise<{ queued: number; packet: TelemetryPacket }> {
    await this.load();
    const launches = nextBatch(this.events, 'launch');
    const batch = launches.length > 0 ? launches : nextBatch(this.events, 'behavior');
    return {
      queued: this.events.length,
      packet: { ...(await this.deps.header()), events: batch.map((item) => item.event) },
    };
  }

  flush(): Promise<void> {
    return this.run(['launch', 'behavior']);
  }

  load(): Promise<void> {
    this.loaded ??= this.deps.store.read().then((value) => {
      const restored = restoredQueue(value, this.deps.behavior).map((item) => ({
        ...item,
        event: this.identified(item.event),
      }));
      this.events = capped([...restored, ...this.events]);
    });
    return this.loaded;
  }

  private run(lanes: readonly TelemetryLane[]): Promise<void> {
    for (const lane of lanes) {
      this.wanted.add(lane);
    }
    this.sending ??= this.drain().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async drain(): Promise<void> {
    await this.load();
    while (this.wanted.size > 0) {
      const lanes = [...this.wanted];
      this.wanted.clear();
      await this.sendAll(lanes);
    }
  }

  // Launches go first and in their own packets: hours played must not wait for the behavior
  // allowance, and a refused behavior packet must not hold them back.
  private async sendAll(lanes: readonly TelemetryLane[]): Promise<void> {
    const launchError = lanes.includes('launch') ? await this.sendLane('launch') : null;
    if (launchError !== null) {
      this.retryLater(launchError);
    }
    if (!lanes.includes('behavior') || this.cancelBehaviorRetry !== null) {
      return;
    }
    const behaviorError = await this.sendLane('behavior');
    if (behaviorError !== null) {
      this.retryBehaviorLater(behaviorError);
    }
  }

  private async sendLane(lane: TelemetryLane): Promise<SiteError | null> {
    for (;;) {
      const batch = nextBatch(this.events, lane);
      if (batch.length === 0) {
        return null;
      }
      if (!this.deps.isOnline()) {
        return { code: 'offline' };
      }
      const sent = await this.deps.send(
        { ...(await this.deps.header()), events: batch.map((item) => item.event) },
        this.tokenFor(batch[0]?.user ?? null),
        lane,
      );
      if (!sent.ok && !isDropped(sent.error)) {
        return sent.error;
      }
      this.settle(lane, sent);
      this.events = this.events.filter((item) => !batch.includes(item));
      this.persist();
    }
  }

  private settle(lane: TelemetryLane, sent: Posted): void {
    if (sent.ok) {
      this.armAlive();
    } else {
      this.deps.log(`telemetry: batch rejected ${sent.error.siteCode ?? sent.error.code}`);
    }
    if (lane === 'launch') {
      this.failures = 0;
    } else {
      this.behaviorFailures = 0;
    }
  }

  // Hours played go to the account that was signed in when the game ran; a later sign-in as
  // someone else, or a sign-out, sends the earlier events as a guest instead.
  private tokenFor(user: number | null): string | null {
    const session = this.deps.session();
    return user !== null && session?.user === user ? session.token : null;
  }

  private retryLater(error: SiteError): void {
    this.failures += 1;
    this.schedule(retryDelay(this.failures, error));
  }

  private retryBehaviorLater(error: SiteError): void {
    this.behaviorFailures += 1;
    this.cancelBehaviorRetry = this.deps.setTimer(
      () => {
        this.cancelBehaviorRetry = null;
        void this.run(this.dueLanes());
      },
      retryDelay(this.behaviorFailures, error),
    );
  }

  private dueLanes(): TelemetryLane[] {
    return this.cancelRetry === null ? ['launch', 'behavior'] : ['behavior'];
  }

  private schedule(ms: number): void {
    this.cancelRetry?.();
    this.cancelRetry = this.deps.setTimer(() => {
      this.cancelRetry = null;
      void this.flush();
    }, ms);
  }

  private periodic(): void {
    this.cancelPeriodic = this.deps.setTimer(() => {
      if (this.cancelRetry === null) {
        void this.flush();
      }
      this.periodic();
    }, PERIODIC_FLUSH_MS);
  }

  private scheduleBehavior(): void {
    this.cancelBehavior ??= this.deps.setTimer(() => {
      this.cancelBehavior = null;
      void this.run(this.dueLanes());
    }, BEHAVIOR_FLUSH_MS);
  }

  // Armed again after every accepted batch, so the timer only fires after ALIVE_MS of silence.
  private armAlive(): void {
    if (!this.deps.behavior) {
      return;
    }
    this.cancelAlive?.();
    this.cancelAlive = this.deps.setTimer(() => {
      this.cancelAlive = null;
      void this.alive().catch(() => undefined);
    }, ALIVE_MS);
  }

  private async alive(): Promise<void> {
    this.armAlive();
    if (this.sending !== null || !this.deps.isOnline()) {
      return;
    }
    const event: TelemetryEvent = {
      type: 'app.alive',
      id: this.deps.newId(),
      at: new Date(this.deps.now()).toISOString(),
      state: this.deps.aliveState(),
    };
    await this.deps.send(
      { ...(await this.deps.header()), events: [event] },
      this.deps.session()?.token ?? null,
      'behavior',
    );
  }

  // One write at a time and at most one waiting: a burst of events rewrites the file once more
  // with the latest state instead of once per event.
  private persist(): void {
    this.dirty = true;
    this.persisting ??= this.writeWhileDirty().finally(() => {
      this.persisting = null;
    });
  }

  private async writeWhileDirty(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      await this.deps.store
        .write({ format: QUEUE_FORMAT, events: [...this.events] })
        .catch(() => undefined);
    }
  }

  async settled(): Promise<void> {
    while (this.persisting !== null) {
      await this.persisting;
    }
  }
}
