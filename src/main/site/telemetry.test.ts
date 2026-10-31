import { describe, expect, it, vi } from 'vitest';
import {
  BEHAVIOR_ONLY_FIELDS,
  BEHAVIOR_TELEMETRY_TYPES,
  TELEMETRY_FIELDS,
  type AppAliveState,
  type LaunchTelemetryEvent,
  type TelemetryEvent,
  type TelemetryLane,
  type TelemetryPacket,
} from '@shared/telemetry';
import { emptyDevice } from '../device/collect';
import type { Posted } from './http';
import {
  ALIVE_MS,
  BEHAVIOR_FLUSH_MS,
  MAX_QUEUED_EVENTS,
  rendererEvent,
  RETRY_DELAYS_MS,
  sanitizeEvent,
  TelemetryQueue,
  type TelemetryHeader,
  type TelemetrySession,
} from './telemetry';

const HEADER: TelemetryHeader = {
  install: '6f1c3b9e-1111-4222-8333-444455556666',
  launcher: '0.1.0',
  os: 'windows',
  arch: 'x64',
  device: emptyDevice(),
};

function finished(index: number): LaunchTelemetryEvent {
  return {
    type: 'launch.finished',
    at: `2026-10-03T12:00:${String(index % 60).padStart(2, '0')}Z`,
    server_id: 3,
    outcome: 'ok',
    exit_code: 0,
    duration_s: index,
    time_to_window_s: 20,
  };
}

function started(patch: Record<string, unknown> = {}): LaunchTelemetryEvent {
  return {
    type: 'launch.started',
    at: '2026-10-03T12:00:00Z',
    server_id: 3,
    minecraft: '1.21.11',
    loader: 'vanilla',
    account: 'nick',
    ram_mb: 4096,
    java_major: 21,
    ...patch,
  };
}

const AT = '2026-10-12T09:00:00.000Z';

function viewed(serverId: number): TelemetryEvent {
  return { type: 'screen.viewed', at: AT, screen: 'server', server_id: serverId };
}

function closed(index: number): TelemetryEvent {
  return { type: 'app.closed', at: AT, duration_s: index };
}

function typesOf(packets: TelemetryPacket[]): string[] {
  return packets.flatMap((packet) => packet.events.map((event) => event.type));
}

interface Timer {
  run: () => void;
  ms: number;
}

interface Built {
  queue: TelemetryQueue;
  sent: TelemetryPacket[];
  tokens: (string | null)[];
  signIn: (session: TelemetrySession | null) => void;
  timers: Timer[];
  disk: () => unknown;
  offline: () => void;
  lanes: TelemetryLane[];
  writes: () => number;
}

type Answer = (lane: TelemetryLane) => Posted | undefined;

function eventId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function setup(
  replies: Posted[] = [],
  stored?: unknown,
  behavior = false,
  answer: Answer = () => undefined,
): Built {
  let disk: unknown = stored;
  const timers: Timer[] = [];
  const sent: TelemetryPacket[] = [];
  const tokens: (string | null)[] = [];
  let session: TelemetrySession | null = null;
  let online = true;
  let writes = 0;
  let ids = 0;
  const lanes: TelemetryLane[] = [];
  const queue = new TelemetryQueue({
    store: {
      read: (): Promise<unknown> => Promise.resolve(disk),
      write: (data): Promise<void> => {
        writes += 1;
        disk = structuredClone(data);
        return Promise.resolve();
      },
    },
    header: (): Promise<TelemetryHeader> => Promise.resolve(HEADER),
    session: (): TelemetrySession | null => session,
    send: (packet, token, lane): Promise<Posted> => {
      sent.push(structuredClone(packet));
      tokens.push(token);
      lanes.push(lane);
      return Promise.resolve(answer(lane) ?? replies.shift() ?? { ok: true });
    },
    isOnline: (): boolean => online,
    behavior,
    aliveState: (): AppAliveState => 'foreground',
    now: (): number => Date.parse(AT),
    newId: (): string => {
      ids += 1;
      return eventId(ids);
    },
    setTimer: (run, ms): (() => void) => {
      const timer = { run, ms };
      timers.push(timer);
      return (): void => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    log: vi.fn(),
  });
  return {
    queue,
    sent,
    tokens,
    signIn: (next): void => {
      session = next;
    },
    timers,
    disk: (): unknown => disk,
    offline: (): void => {
      online = false;
    },
    lanes,
    writes: (): number => writes,
  };
}

function fire(timers: Timer[], ms: number): void {
  const timer = timers.find((item) => item.ms === ms);
  if (timer !== undefined) {
    timers.splice(timers.indexOf(timer), 1);
    timer.run();
  }
}

async function settle(queue: TelemetryQueue): Promise<void> {
  await queue.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await queue.settled();
}

describe('telemetry queue', () => {
  it('accumulates events on disk and sends them in batches of up to 50', async () => {
    const { queue, sent, disk } = setup();
    for (let index = 0; index < 120; index += 1) {
      queue.push(finished(index));
    }
    await settle(queue);
    expect(disk()).toMatchObject({ format: 2 });
    await queue.flush();
    expect(sent.map((packet) => packet.events.length)).toEqual([50, 50, 20]);
    expect(sent[0]).toMatchObject(HEADER);
    expect(queue.size).toBe(0);
    await queue.settled();
    expect(disk()).toEqual({ format: 2, events: [] });
  });

  it('launch.finished triggers a send soon after', async () => {
    const { queue, timers } = setup();
    queue.push(finished(1));
    await settle(queue);
    expect(timers.some((timer) => timer.ms === 2000)).toBe(true);
  });

  it('network error: events remain, retry with a growing pause', async () => {
    const { queue, sent, timers } = setup([
      { ok: false, error: { code: 'offline' } },
      { ok: false, error: { code: 'server-error', status: 503 } },
    ]);
    queue.push(finished(1));
    await settle(queue);
    await queue.flush();
    expect(queue.size).toBe(1);
    expect(timers.at(-1)?.ms).toBe(RETRY_DELAYS_MS[0]);
    await queue.flush();
    expect(timers.at(-1)?.ms).toBe(RETRY_DELAYS_MS[1]);
    await queue.flush();
    expect(queue.size).toBe(0);
    expect(sent).toHaveLength(3);
  });

  it('429 waits for Retry-After', async () => {
    const { queue, timers } = setup([
      { ok: false, error: { code: 'rate-limited', retryAfterS: 90 } },
    ]);
    queue.push(finished(1));
    await settle(queue);
    await queue.flush();
    expect(timers.at(-1)?.ms).toBe(90_000);
  });

  it('without network it does not try to send', async () => {
    const { queue, sent, offline } = setup();
    offline();
    queue.push(finished(1));
    await settle(queue);
    await queue.flush();
    expect(sent).toHaveLength(0);
    expect(queue.size).toBe(1);
  });

  it('survives a restart: events are read back from disk', async () => {
    const { queue, sent, tokens, signIn } = setup([], {
      format: 2,
      events: [{ user: 7, event: finished(1) }, { user: 7, event: { type: 'x' } }, 'мусор'],
    });
    signIn({ user: 7, token: 'seven' });
    await queue.flush();
    expect(sent[0]?.events).toHaveLength(1);
    expect(tokens).toEqual(['seven']);
  });

  it('an old-format queue without marks is sent as a guest', async () => {
    const { queue, sent, tokens, signIn } = setup([], { format: 1, events: [finished(1), 'x'] });
    signIn({ user: 7, token: 'seven' });
    await queue.flush();
    expect(sent[0]?.events).toHaveLength(1);
    expect(tokens).toEqual([null]);
  });

  it('the token is taken from the account at event time, not send time', async () => {
    const { queue, sent, tokens, signIn } = setup();
    queue.push(finished(1));
    signIn({ user: 1, token: 'one' });
    queue.push(finished(2));
    queue.push(finished(3));
    signIn({ user: 2, token: 'two' });
    queue.push(finished(4));
    await settle(queue);
    await queue.flush();
    expect(sent.map((packet) => packet.events.map((event) => event.at.slice(-3)))).toEqual([
      ['01Z'],
      ['02Z', '03Z'],
      ['04Z'],
    ]);
    expect(tokens).toEqual([null, null, 'two']);
    queue.push(finished(5));
    signIn(null);
    await settle(queue);
    await queue.flush();
    expect(tokens.at(-1)).toBeNull();
  });

  it('a guest launch stays with the install while the player is signed in', async () => {
    const { queue, tokens, signIn } = setup();
    signIn({ user: 1, token: 'one' });
    queue.push(finished(1), true);
    await settle(queue);
    await queue.flush();
    queue.push(finished(2));
    await settle(queue);
    await queue.flush();
    expect(tokens).toEqual([null, 'one']);
  });

  it("sample batch for the 'Privacy' screen — the first 50 events as is", async () => {
    const { queue } = setup();
    queue.push(started());
    await settle(queue);
    const preview = await queue.preview();
    expect(preview.queued).toBe(1);
    expect(preview.packet).toEqual({ ...HEADER, events: [started()] });
  });
});

describe('nickname and extra fields', () => {
  it('the account is microsoft or nick, anything else goes as nick', () => {
    expect(sanitizeEvent(started({ account: 'microsoft' }))).toMatchObject({
      account: 'microsoft',
    });
    expect(sanitizeEvent(started({ account: 'elyby' }))).toMatchObject({ account: 'nick' });
  });

  it('nickname only in launch.started on auto sign-in to a server', () => {
    expect(sanitizeEvent(started({ nick: 'Frostbyte' }))).toMatchObject({ nick: 'Frostbyte' });
    expect(sanitizeEvent(started({ nick: 'Frostbyte', server_id: null }))).not.toHaveProperty(
      'nick',
    );
    expect(sanitizeEvent({ ...finished(1), nick: 'Frostbyte' })).not.toHaveProperty('nick');
    expect(sanitizeEvent(started({ nick: 'C:\\Users\\Иван' }))).not.toHaveProperty('nick');
  });

  it('skins in launch.started passes only as one of the three values of the API schema', () => {
    for (const skins of ['on', 'off', 'unavailable'] as const) {
      expect(sanitizeEvent(started({ skins }))).toMatchObject({ skins });
    }
    expect(sanitizeEvent({ ...started(), skins: 'license' })).not.toHaveProperty('skins');
    expect(sanitizeEvent(started())).not.toHaveProperty('skins');
    expect(sanitizeEvent({ ...finished(1), skins: 'on' })).not.toHaveProperty('skins');
  });

  it('client_mod in launch.started follows the same rule as skins', () => {
    for (const value of ['on', 'off', 'unavailable'] as const) {
      expect(sanitizeEvent(started({ client_mod: value }))).toMatchObject({ client_mod: value });
    }
    expect(sanitizeEvent({ ...started(), client_mod: 'server' })).not.toHaveProperty('client_mod');
    expect(sanitizeEvent(started())).not.toHaveProperty('client_mod');
  });

  it('mods in launch.started keep valid entries once each and drop an empty list', () => {
    const mods = [
      { slug: 'sodium', state: 'on', version: '0.6.13' },
      { slug: 'sodium', state: 'failed' },
      { slug: 'iris', state: 'failed', version: '1.8.8' },
      { slug: 'emotecraft', state: 'off_by_player' },
      { slug: 'xaeros-minimap', state: 'forbidden' },
      { slug: 'voice', state: 'no_file' },
      { slug: 'appleskin', state: 'on' },
      { slug: '../evil', state: 'on', version: '1' },
      { slug: 'zoomify', state: 'disabled' },
      { slug: 'chat-heads', state: 'on', version: 'C:\\Users\\x' },
      'sodium',
    ];
    expect(sanitizeEvent(started({ mods }))).toMatchObject({
      mods: [
        { slug: 'sodium', state: 'on', version: '0.6.13' },
        { slug: 'iris', state: 'failed' },
        { slug: 'emotecraft', state: 'off_by_player' },
        { slug: 'xaeros-minimap', state: 'forbidden' },
        { slug: 'voice', state: 'no_file' },
      ],
    });
    expect(sanitizeEvent(started({ mods: [] }))).not.toHaveProperty('mods');
    expect(sanitizeEvent(started({ mods: [{ slug: '!', state: 'on' }] }))).not.toHaveProperty(
      'mods',
    );
    expect(sanitizeEvent(started({ mods: 'sodium' }))).not.toHaveProperty('mods');
  });

  it('the schema is closed: fields are exactly TELEMETRY_FIELDS, paths, tokens and logs do not pass through', () => {
    const extra = { token: 'secret', path: 'C:\\Users\\x', log: ['line'] };
    const installed = {
      type: 'install.finished',
      at: '2026-10-03T12:00:00Z',
      minecraft: '1.21.11',
      loader: 'fabric',
      outcome: 'error',
      error_code: 'network',
      duration_s: 40,
      bytes: 1024,
    } as const;
    const full = started({
      nick: 'Frostbyte',
      skins: 'on',
      client_mod: 'on',
      mods: [{ slug: 'sodium', state: 'on', version: '0.6.13' }],
    });
    for (const event of [full, finished(1), installed]) {
      const clean = sanitizeEvent({ ...event, ...extra });
      const fields = clean === null ? [] : Object.keys(clean).filter((key) => key !== 'type');
      const expected = TELEMETRY_FIELDS[event.type].filter(
        (field) => !BEHAVIOR_ONLY_FIELDS.includes(field),
      );
      expect(fields.sort()).toEqual([...expected].sort());
    }
    expect(sanitizeEvent({ ...installed, type: 'launch.crashed' })).toBeNull();
  });
});

describe('behavior events: cleaning', () => {
  const clean = (event: Record<string, unknown>): TelemetryEvent | null =>
    sanitizeEvent({ at: AT, ...event }, true);

  it('every new kind keeps exactly its schema fields', () => {
    const samples: Record<(typeof BEHAVIOR_TELEMETRY_TYPES)[number], Record<string, unknown>> = {
      'app.started': { reason: 'deeplink' },
      'app.closed': { duration_s: 61.4 },
      'app.alive': { state: 'playing' },
      'screen.viewed': { screen: 'server', server_id: 7 },
      action: { name: 'copy_address', server_id: 7 },
      'vote.finished': { server_id: 7, outcome: 'paused' },
    };
    const extra = { path: 'C:\\Users\\x', nick: 'Frostbyte', message: 'boom', host: 'pc' };
    for (const type of BEHAVIOR_TELEMETRY_TYPES) {
      const event = clean({ type, ...samples[type], ...extra });
      const allowed: readonly string[] = ['type', ...TELEMETRY_FIELDS[type]];
      expect(event, type).not.toBeNull();
      expect(Object.keys(event ?? {}).every((key) => allowed.includes(key))).toBe(true);
      expect(JSON.stringify(event)).not.toMatch(/Users|Frostbyte|boom|"host"/);
    }
    expect(clean({ type: 'app.closed', duration_s: 61.4 })).toMatchObject({ duration_s: 61 });
  });

  it('values outside the closed lists drop the whole event', () => {
    expect(clean({ type: 'app.started', reason: 'cron' })).toBeNull();
    expect(clean({ type: 'app.alive', state: 'idle' })).toBeNull();
    expect(clean({ type: 'app.closed', duration_s: Number.NaN })).toBeNull();
    expect(clean({ type: 'app.closed', duration_s: -5 })).toBeNull();
    expect(clean({ type: 'screen.viewed', screen: 'C:\\secret', server_id: null })).toBeNull();
    expect(clean({ type: 'action', name: 'rm_rf', server_id: null })).toBeNull();
    expect(clean({ type: 'vote.finished', server_id: 7, outcome: 'maybe' })).toBeNull();
    expect(clean({ type: 'vote.finished', server_id: null, outcome: 'ok' })).toBeNull();
    expect(
      clean({
        type: 'update.finished',
        from: '0.1.0',
        to: '0.2.0',
        outcome: 'ok',
        error_code: null,
      }),
    ).toBeNull();
    expect(clean({ type: 'error', area: 'ui', code: 'x' })).toBeNull();
    expect(clean({ type: 'something.else' })).toBeNull();
  });

  it('server_id is a positive integer or null, and only the server screen carries it', () => {
    for (const bad of [0, -3, 1.5, Number.POSITIVE_INFINITY, '7']) {
      expect(clean({ type: 'action', name: 'copy_address', server_id: bad })).toMatchObject({
        server_id: null,
      });
      expect(clean({ type: 'screen.viewed', screen: 'server', server_id: bad })).toMatchObject({
        server_id: null,
      });
    }
    expect(clean({ type: 'screen.viewed', screen: 'home', server_id: 7 })).toMatchObject({
      server_id: null,
    });
    expect(clean({ type: 'screen.viewed', screen: 'server', server_id: 7 })).toMatchObject({
      server_id: 7,
    });
  });

  it('an action keeps only the extras of its own name', () => {
    const launchId = '6f1c3b9e-1111-4222-8333-444455556666';
    const everything = {
      type: 'action',
      server_id: 7,
      source: 'catalog',
      kind: 'discord',
      tab: 'new',
      length: 4,
      results: 12,
      launch_id: launchId,
      query: 'skyblock',
    };
    expect(clean({ ...everything, name: 'play' })).toEqual({
      type: 'action',
      at: AT,
      name: 'play',
      server_id: 7,
      source: 'catalog',
      launch_id: launchId,
    });
    expect(clean({ ...everything, name: 'link_open' })).toEqual({
      type: 'action',
      at: AT,
      name: 'link_open',
      server_id: 7,
      kind: 'discord',
    });
    expect(clean({ ...everything, name: 'search' })).toEqual({
      type: 'action',
      at: AT,
      name: 'search',
      server_id: 7,
      length: 4,
      results: 12,
    });
    expect(clean({ ...everything, name: 'tab' })).toMatchObject({ name: 'tab', tab: 'new' });
    expect(clean({ ...everything, name: 'favorite_add' })).toEqual({
      type: 'action',
      at: AT,
      name: 'favorite_add',
      server_id: 7,
    });
    expect(clean({ ...everything, name: 'play', source: 'banner' })).toBeNull();
    expect(clean({ ...everything, name: 'play', launch_id: 'not-a-uuid' })).toBeNull();
    expect(clean({ ...everything, name: 'play', launch_id: undefined })).toBeNull();
    expect(clean({ ...everything, name: 'link_open', kind: 'tiktok' })).toMatchObject({
      kind: 'tiktok',
    });
    expect(clean({ ...everything, name: 'link_open', kind: 'ftp' })).toBeNull();
    expect(clean({ ...everything, name: 'search', length: 'skyblock' })).toBeNull();
    expect(clean({ ...everything, name: 'tab', tab: 'hidden' })).toBeNull();
  });

  it('launch_id on launch.started passes only with the flag on', () => {
    const launchId = '6f1c3b9e-1111-4222-8333-444455556666';
    expect(sanitizeEvent(started({ launch_id: launchId }), true)).toMatchObject({
      launch_id: launchId,
    });
    expect(sanitizeEvent(started({ launch_id: 'x' }), true)).not.toHaveProperty('launch_id');
    expect(sanitizeEvent(started({ launch_id: launchId }))).not.toHaveProperty('launch_id');
  });
});

describe('behavior events: the id', () => {
  const ID = '6f1c3b9e-1111-4222-8333-444455556666';

  it('a valid id is kept by cleaning, a malformed one is dropped, launches never get one', () => {
    expect(sanitizeEvent({ ...viewed(1), id: ID }, true)).toMatchObject({ id: ID });
    expect(sanitizeEvent({ ...viewed(1), id: 'x' }, true)).not.toHaveProperty('id');
    expect(sanitizeEvent({ ...finished(1), id: ID }, true)).not.toHaveProperty('id');
    expect(sanitizeEvent({ ...started(), id: ID }, true)).not.toHaveProperty('id');
  });

  it('the renderer cannot choose the id', () => {
    expect(rendererEvent({ type: 'screen.viewed', screen: 'home', id: ID }, AT)).not.toHaveProperty(
      'id',
    );
  });

  it('main gives the id once: it stays the same on a retry and after a restart', async () => {
    const first = setup([], undefined, true, (lane) =>
      lane === 'behavior' ? { ok: false, error: { code: 'server-error', status: 503 } } : undefined,
    );
    first.queue.push(viewed(1));
    first.queue.push(finished(1));
    await settle(first.queue);
    await first.queue.flush();
    const second = setup([], first.disk(), true);
    await second.queue.flush();
    const sentIds = [...first.sent, ...second.sent]
      .flatMap((packet) => packet.events)
      .flatMap((event) => (event.type === 'screen.viewed' ? [event.id] : []));
    expect(sentIds).toEqual([eventId(1), eventId(1)]);
    const launches = first.sent
      .flatMap((packet) => packet.events)
      .filter((event) => event.type === 'launch.finished');
    expect(launches[0]).not.toHaveProperty('id');
  });

  it('a behavior event read from disk without a valid id gets a new one', async () => {
    const { queue, sent } = setup(
      [],
      {
        format: 2,
        events: [
          { user: null, event: viewed(1) },
          { user: null, event: { ...viewed(2), id: 'x' } },
        ],
      },
      true,
    );
    await queue.flush();
    expect(sent[0]?.events.map((event) => ('id' in event ? event.id : null))).toEqual([
      eventId(1),
      eventId(2),
    ]);
  });
});

describe('behavior events: the renderer gate', () => {
  it('only screen.viewed and action pass, and main sets the time', () => {
    expect(
      rendererEvent({ type: 'screen.viewed', screen: 'home', server_id: null, at: 'x' }, AT),
    ).toEqual({ type: 'screen.viewed', at: AT, screen: 'home', server_id: null });
    expect(rendererEvent({ type: 'action', name: 'tab', server_id: null, tab: 'new' }, AT)).toEqual(
      { type: 'action', at: AT, name: 'tab', server_id: null, tab: 'new' },
    );
    for (const type of ['app.started', 'app.closed', 'app.alive', 'vote.finished']) {
      expect(
        rendererEvent(
          { type, reason: 'user', duration_s: 1, state: 'playing', server_id: 7, outcome: 'ok' },
          AT,
        ),
      ).toBeNull();
    }
    expect(rendererEvent(finished(1), AT)).toBeNull();
    expect(rendererEvent(started(), AT)).toBeNull();
    expect(rendererEvent('screen.viewed', AT)).toBeNull();
  });
});

describe('behavior events: the queue', () => {
  it('flag off: new kinds are neither queued, nor sent, nor restored from disk', async () => {
    const { queue, sent, timers, disk } = setup([], {
      format: 2,
      events: [
        { user: null, event: viewed(1) },
        { user: null, event: finished(1) },
      ],
    });
    queue.start();
    queue.push(viewed(2));
    queue.push({ type: 'app.started', at: AT, reason: 'user' });
    queue.push(started({ launch_id: '6f1c3b9e-1111-4222-8333-444455556666' }));
    await settle(queue);
    expect(queue.size).toBe(2);
    expect(timers.some((timer) => timer.ms === BEHAVIOR_FLUSH_MS || timer.ms === ALIVE_MS)).toBe(
      false,
    );
    await queue.close(closed(5));
    expect(sent).toHaveLength(0);
    await queue.flush();
    expect(typesOf(sent)).toEqual(['launch.finished', 'launch.started']);
    expect(JSON.stringify(sent)).not.toContain('launch_id');
    expect(JSON.stringify(disk())).not.toContain('screen.viewed');
    const preview = await queue.preview();
    expect(preview.queued).toBe(0);
  });

  it('flag on: an old queue file is still read, unknown kinds are dropped', async () => {
    const { queue, sent } = setup(
      [],
      {
        format: 2,
        events: [
          { user: null, event: finished(1) },
          { user: null, event: viewed(1) },
          { user: null, event: { type: 'mouse.moved', at: AT } },
        ],
      },
      true,
    );
    await queue.flush();
    expect(typesOf(sent)).toEqual(['launch.finished', 'screen.viewed']);
  });

  it('new kinds wait for one batch every 60 seconds', async () => {
    const { queue, sent, timers } = setup([], undefined, true);
    queue.push(viewed(1));
    queue.push(viewed(2));
    queue.push({ type: 'action', at: AT, name: 'copy_address', server_id: 2 });
    await settle(queue);
    expect(sent).toHaveLength(0);
    const waiting = timers.filter((timer) => timer.ms === BEHAVIOR_FLUSH_MS);
    expect(waiting).toHaveLength(1);
    expect(timers.some((timer) => timer.ms === 2000)).toBe(false);
    fire(timers, BEHAVIOR_FLUSH_MS);
    await queue.flush();
    expect(sent.map((packet) => packet.events.length)).toEqual([3]);
    queue.push(viewed(3));
    await settle(queue);
    expect(timers.filter((timer) => timer.ms === BEHAVIOR_FLUSH_MS)).toHaveLength(1);
  });

  it('closing sends app.closed with whatever is queued', async () => {
    const { queue, sent, disk } = setup([], undefined, true);
    queue.push(viewed(1));
    await queue.close(closed(90));
    expect(typesOf(sent)).toEqual(['screen.viewed', 'app.closed']);
    expect(disk()).toEqual({ format: 2, events: [] });
  });

  it('closing offline keeps app.closed on disk for the next start', async () => {
    const { queue, sent, disk, offline } = setup([], undefined, true);
    offline();
    await queue.close(closed(90));
    expect(sent).toHaveLength(0);
    expect(JSON.stringify(disk())).toContain('app.closed');
  });

  it('overflow evicts screens and actions first, then other new kinds, launches last', async () => {
    const { queue, sent } = setup([], undefined, true);
    queue.push(finished(0));
    for (let index = 0; index < 10; index += 1) {
      queue.push(closed(index));
    }
    for (let index = 1; index <= MAX_QUEUED_EVENTS; index += 1) {
      queue.push(viewed(index));
    }
    await settle(queue);
    expect(queue.size).toBe(MAX_QUEUED_EVENTS);
    await queue.flush();
    const kept = sent.flatMap((packet) => packet.events);
    expect(kept.filter((event) => event.type === 'launch.finished')).toHaveLength(1);
    expect(kept.filter((event) => event.type === 'app.closed')).toHaveLength(10);
    const screens = kept.filter((event) => event.type === 'screen.viewed');
    expect(screens).toHaveLength(MAX_QUEUED_EVENTS - 11);
    expect(screens[0]).toMatchObject({ server_id: 12 });
  });

  it('launches are evicted only when no behavior event is left', async () => {
    const { queue, sent } = setup([], undefined, true);
    queue.push(viewed(1));
    queue.push(closed(1));
    for (let index = 0; index < MAX_QUEUED_EVENTS; index += 1) {
      queue.push(finished(index));
    }
    await settle(queue);
    expect(queue.size).toBe(MAX_QUEUED_EVENTS);
    queue.push(finished(5000));
    await settle(queue);
    await queue.flush();
    const kept = sent.flatMap((packet) => packet.events);
    expect(kept.every((event) => event.type === 'launch.finished')).toBe(true);
    expect(kept[0]).toMatchObject({ duration_s: 1 });
    expect(kept.at(-1)).toMatchObject({ duration_s: 5000 });
  });
});

describe('app.alive', () => {
  function aliveTimers(timers: Timer[]): Timer[] {
    return timers.filter((timer) => timer.ms === ALIVE_MS);
  }

  it('goes out alone after five silent minutes and never touches the disk', async () => {
    const { queue, sent, timers, disk } = setup([], undefined, true);
    queue.start();
    await settle(queue);
    expect(aliveTimers(timers)).toHaveLength(1);
    fire(timers, ALIVE_MS);
    await settle(queue);
    expect(sent).toEqual([
      { ...HEADER, events: [{ type: 'app.alive', id: eventId(1), at: AT, state: 'foreground' }] },
    ]);
    expect(queue.size).toBe(0);
    expect(disk()).toBeUndefined();
    expect(aliveTimers(timers)).toHaveLength(1);
  });

  it('an accepted batch pushes the signal five minutes further', async () => {
    const { queue, sent, timers } = setup([], undefined, true);
    queue.start();
    await settle(queue);
    const [first] = aliveTimers(timers);
    queue.push(finished(1));
    await settle(queue);
    await queue.flush();
    expect(typesOf(sent)).toEqual(['launch.finished']);
    expect(aliveTimers(timers)).toHaveLength(1);
    expect(aliveTimers(timers)[0]).not.toBe(first);
  });

  it('a failed signal is skipped: no retry, nothing queued', async () => {
    const { queue, sent, timers, disk } = setup(
      [{ ok: false, error: { code: 'server-error', status: 503 } }],
      undefined,
      true,
    );
    queue.start();
    await settle(queue);
    fire(timers, ALIVE_MS);
    await settle(queue);
    expect(sent).toHaveLength(1);
    expect(queue.size).toBe(0);
    expect(disk()).toBeUndefined();
    expect(timers.some((timer) => RETRY_DELAYS_MS.includes(timer.ms as never))).toBe(false);
  });

  it('is not sent offline and cannot be queued by hand', async () => {
    const { queue, sent, timers, offline } = setup([], undefined, true);
    queue.start();
    queue.push({ type: 'app.alive', at: AT, state: 'playing' });
    await settle(queue);
    offline();
    fire(timers, ALIVE_MS);
    await settle(queue);
    expect(sent).toHaveLength(0);
    expect(queue.size).toBe(0);
  });
});

describe('telemetry queue: lanes and disk', () => {
  const REFUSED: Posted = { ok: false, error: { code: 'rate-limited', retryAfterS: 3600 } };

  it('launches leave first in their own packets, behavior events after them', async () => {
    const { queue, sent, lanes } = setup([], undefined, true);
    queue.push(viewed(1));
    queue.push(finished(1));
    queue.push(viewed(2));
    queue.push(started());
    await settle(queue);
    await queue.flush();
    expect(lanes).toEqual(['launch', 'behavior']);
    expect(sent.map((packet) => packet.events.map((event) => event.type))).toEqual([
      ['launch.finished', 'launch.started'],
      ['screen.viewed', 'screen.viewed'],
    ]);
  });

  it('a 429 on behavior neither delays launches nor is hammered again', async () => {
    const { queue, sent, lanes, timers } = setup([], undefined, true, (lane) =>
      lane === 'behavior' ? REFUSED : undefined,
    );
    queue.push(viewed(1));
    queue.push(finished(1));
    await settle(queue);
    await queue.flush();
    expect(lanes).toEqual(['launch', 'behavior']);
    expect(queue.size).toBe(1);
    expect(timers.some((timer) => timer.ms === 3_600_000)).toBe(true);
    queue.push(finished(2));
    await settle(queue);
    fire(timers, 2000);
    await queue.flush();
    expect(lanes).toEqual(['launch', 'behavior', 'launch']);
    expect(typesOf(sent).filter((type) => type === 'launch.finished')).toHaveLength(2);
    expect(queue.size).toBe(1);
    fire(timers, 3_600_000);
    await queue.flush();
    expect(lanes.at(-1)).toBe('behavior');
  });

  it('a failing launch packet does not stop behavior packets', async () => {
    const { queue, lanes, timers } = setup([], undefined, true, (lane) =>
      lane === 'launch' ? { ok: false, error: { code: 'server-error', status: 503 } } : undefined,
    );
    queue.push(finished(1));
    queue.push(viewed(1));
    await settle(queue);
    await queue.flush();
    expect(lanes).toEqual(['launch', 'behavior']);
    expect(queue.size).toBe(1);
    expect(timers.some((timer) => timer.ms === RETRY_DELAYS_MS[0])).toBe(true);
    queue.push(viewed(2));
    await settle(queue);
    fire(timers, BEHAVIOR_FLUSH_MS);
    await settle(queue);
    expect(lanes).toEqual(['launch', 'behavior', 'behavior']);
  });

  it('a batch dropped by the site as invalid does not count as a sign of life', async () => {
    const { queue, timers } = setup(
      [{ ok: false, error: { code: 'invalid-request', status: 422 } }],
      undefined,
      true,
    );
    queue.start();
    await settle(queue);
    const armed = timers.find((timer) => timer.ms === ALIVE_MS);
    queue.push(finished(1));
    await settle(queue);
    await queue.flush();
    expect(queue.size).toBe(0);
    expect(timers.find((timer) => timer.ms === ALIVE_MS)).toBe(armed);
    queue.push(finished(2));
    await settle(queue);
    await queue.flush();
    expect(timers.find((timer) => timer.ms === ALIVE_MS)).not.toBe(armed);
  });

  it('a burst of events rewrites the file a couple of times, not once per event', async () => {
    const { queue, writes, disk } = setup([], undefined, true);
    for (let index = 1; index <= 500; index += 1) {
      queue.push(viewed(index));
    }
    await settle(queue);
    expect(queue.size).toBe(500);
    expect(writes()).toBeLessThanOrEqual(3);
    expect((disk() as { events: unknown[] }).events).toHaveLength(500);
  });

  it('reopen right after close, before the event is even queued, still takes it back', async () => {
    const { queue, sent } = setup([], undefined, true);
    const closing = queue.close(closed(30));
    queue.reopen();
    await closing;
    await settle(queue);
    expect(queue.size).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('reopen takes the farewell event back while it has not left', async () => {
    const { queue, sent, disk, offline } = setup([], undefined, true);
    offline();
    queue.push(viewed(1));
    await queue.close(closed(30));
    expect(JSON.stringify(disk())).toContain('app.closed');
    queue.reopen();
    await queue.settled();
    expect(JSON.stringify(disk())).not.toContain('app.closed');
    expect(queue.size).toBe(1);
    expect(sent).toHaveLength(0);
  });
});
