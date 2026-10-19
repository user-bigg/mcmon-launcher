import { describe, expect, it, vi } from 'vitest';
import type { SiteChange } from '@shared/site';
import {
  MAX_ENTRIES,
  MIN_FRESH_MS,
  Recall,
  REFUSAL_PAUSE_MS,
  type Ask,
  type Outcome,
} from './recall';

type Answer = Outcome;

const CHANGE: SiteChange = { topic: 'favorites' };
const ok = (value: unknown): Answer => ({ ok: true, value });
const limited = (retryAfterS: number): Answer => ({
  ok: false,
  error: { code: 'rate_limited', retryAfterS },
});

function setup(): {
  recall: Recall;
  changes: SiteChange[];
  tick: (ms: number) => void;
} {
  let now = 1_000_000;
  const changes: SiteChange[] = [];
  const recall = new Recall({
    now: (): number => now,
    onChange: (change): void => {
      changes.push(change);
    },
  });
  return {
    recall,
    changes,
    tick: (ms): void => {
      now += ms;
    },
  };
}

function ask(fetch: () => Promise<Answer>, extra: Partial<Ask<Answer>> = {}): Ask<Answer> {
  return { key: 'k', change: CHANGE, ttlMs: 60_000, fetch, ...extra };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function held(): { fetch: () => Promise<Answer>; release: (value: Answer) => void } {
  let release: (value: Answer) => void = () => undefined;
  const fetch = vi.fn(
    () =>
      new Promise<Answer>((resolve) => {
        release = resolve;
      }),
  );
  return {
    fetch,
    release: (value): void => {
      release(value);
    },
  };
}

describe('Recall', () => {
  it('answers a repeated read from memory within the term', async () => {
    const { recall, tick } = setup();
    const fetch = vi.fn(() => Promise.resolve(ok([1])));
    await recall.read(ask(fetch));
    tick(59_000);
    expect(await recall.read(ask(fetch))).toEqual(ok([1]));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('merges simultaneous reads into one request', async () => {
    const { recall } = setup();
    const { fetch, release } = held();
    const reads = [recall.read(ask(fetch)), recall.read(ask(fetch)), recall.read(ask(fetch))];
    await flush();
    release(ok([1]));
    expect(await Promise.all(reads)).toEqual([ok([1]), ok([1]), ok([1])]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('past the term answers with the old value at once and announces the new one', async () => {
    const { recall, changes, tick } = setup();
    const fetch = vi
      .fn<() => Promise<Answer>>()
      .mockResolvedValueOnce(ok([1]))
      .mockResolvedValueOnce(ok([1, 2]));
    await recall.read(ask(fetch));
    tick(61_000);
    expect(await recall.read(ask(fetch))).toEqual(ok([1]));
    await flush();
    expect(changes).toEqual([CHANGE]);
    expect(await recall.read(ask(fetch))).toEqual(ok([1, 2]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stays silent when the refreshed value is the same', async () => {
    const { recall, changes, tick } = setup();
    const fetch = vi.fn(() => Promise.resolve(ok([1])));
    await recall.read(ask(fetch));
    tick(61_000);
    await recall.read(ask(fetch));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(changes).toEqual([]);
  });

  it('after a 429 gives the last known value and does not ask again before Retry-After', async () => {
    const { recall, tick } = setup();
    const fetch = vi
      .fn<() => Promise<Answer>>()
      .mockResolvedValueOnce(ok([1]))
      .mockResolvedValueOnce(limited(30))
      .mockResolvedValue(ok([2]));
    await recall.read(ask(fetch));
    tick(61_000);
    expect(await recall.read(ask(fetch))).toEqual(ok([1]));
    await flush();
    tick(29_000);
    expect(await recall.read(ask(fetch))).toEqual(ok([1]));
    expect(await recall.read(ask(fetch, { mode: 'wait' }))).toEqual(ok([1]));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    tick(2_000);
    await recall.read(ask(fetch));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a 429 with nothing known is the answer until Retry-After passes', async () => {
    const { recall, tick } = setup();
    const fetch = vi
      .fn<() => Promise<Answer>>()
      .mockResolvedValueOnce(limited(10))
      .mockResolvedValue(ok([1]));
    expect(await recall.read(ask(fetch))).toEqual(limited(10));
    expect(await recall.read(ask(fetch))).toEqual(limited(10));
    expect(fetch).toHaveBeenCalledTimes(1);
    tick(11_000);
    expect(await recall.read(ask(fetch))).toEqual(ok([1]));
  });

  it('starts from the value kept on disk and refreshes behind it', async () => {
    const { recall, changes } = setup();
    const fetch = vi.fn(() => Promise.resolve(ok(['new'])));
    const seed = vi.fn(() => Promise.resolve({ value: ok(['old']), at: 0 }));
    expect(await recall.read(ask(fetch, { seed }))).toEqual(ok(['old']));
    await flush();
    expect(changes).toEqual([CHANGE]);
    expect(await recall.read(ask(fetch, { seed }))).toEqual(ok(['new']));
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('a written value replaces the kept one without a request', async () => {
    const { recall } = setup();
    const fetch = vi.fn(() => Promise.resolve(ok([1])));
    await recall.read(ask(fetch));
    recall.put({ key: 'k' }, ok([1, 2]));
    expect(await recall.read(ask(fetch))).toEqual(ok([1, 2]));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('forgets personal values and drops their answers still on the way', async () => {
    const { recall } = setup();
    const slow = held();
    await recall.read(ask(() => Promise.resolve(ok('public')), { key: 'open' }));
    await recall.read(ask(() => Promise.resolve(ok('mine')), { key: 'kept', personal: true }));
    const pending = recall.read(ask(slow.fetch, { key: 'late', personal: true }));
    await flush();
    recall.clearPersonal();
    slow.release(ok('of the previous account'));
    await pending;
    expect(recall.peek('open')).toEqual(ok('public'));
    expect(recall.peek('kept')).toBeNull();
    expect(recall.peek('late')).toBeNull();
  });

  it('a forced read waits for the site even within the term', async () => {
    const { recall } = setup();
    const fetch = vi
      .fn<() => Promise<Answer>>()
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok(2));
    await recall.read(ask(fetch));
    expect(await recall.read(ask(fetch, { force: true }))).toEqual(ok(2));
  });

  it('a read that left before a write does not bring the old value back', async () => {
    const { recall, changes, tick } = setup();
    const slow = held();
    await recall.read(ask(() => Promise.resolve(ok([3, 17]))));
    tick(61_000);
    expect(await recall.read(ask(slow.fetch))).toEqual(ok([3, 17]));
    recall.put({ key: 'k' }, ok([17]));
    slow.release(ok([3, 17]));
    await flush();
    expect(await recall.read(ask(slow.fetch))).toEqual(ok([17]));
    expect(changes).toEqual([]);
  });

  it('keeps no more than its limit of keys and lets the oldest go', async () => {
    const { recall } = setup();
    for (let index = 0; index <= MAX_ENTRIES; index += 1) {
      await recall.read(ask(() => Promise.resolve(ok(index)), { key: `k${String(index)}` }));
    }
    expect(recall.peek('k0')).toBeNull();
    expect(recall.peek('k1')).toEqual(ok(1));
    expect(recall.peek(`k${String(MAX_ENTRIES)}`)).toEqual(ok(MAX_ENTRIES));
  });

  it('a value read again stays ahead of the ones nobody asks for', async () => {
    const { recall } = setup();
    const read = (index: number): Promise<Answer> =>
      recall.read(ask(() => Promise.resolve(ok(index)), { key: `k${String(index)}` }));
    await read(0);
    for (let index = 1; index < MAX_ENTRIES; index += 1) {
      await read(index);
    }
    await read(0);
    await read(MAX_ENTRIES);
    expect(recall.peek('k0')).toEqual(ok(0));
    expect(recall.peek('k1')).toBeNull();
  });

  it('a listener that reads again on every change does not ask without end', async () => {
    let calls = 0;
    let now = 1_000_000;
    const fetch = (): Promise<Answer> => Promise.resolve(ok((calls += 1)));
    const zero = (): Ask<Answer> => ask(fetch, { ttlMs: 0 });
    const recall: Recall = new Recall({
      now: () => now,
      onChange: (): void => {
        void recall.read(zero());
      },
    });
    await recall.read(zero());
    now += MIN_FRESH_MS + 1;
    await recall.read(zero());
    for (let turn = 0; turn < 20; turn += 1) {
      await flush();
    }
    expect(calls).toBe(2);
  });

  it('a clock moved back does not freeze a value as fresh', async () => {
    const { recall, tick } = setup();
    const fetch = vi.fn(() => Promise.resolve(ok([1])));
    await recall.read(ask(fetch));
    tick(-3_600_000);
    await recall.read(ask(fetch));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a clock moved back does not stretch the pause after a 429', async () => {
    const { recall, tick } = setup();
    const fetch = vi
      .fn<() => Promise<Answer>>()
      .mockResolvedValueOnce(limited(30))
      .mockResolvedValue(ok([1]));
    await recall.read(ask(fetch));
    tick(-3_600_000);
    expect(await recall.read(ask(fetch))).toEqual(ok([1]));
  });

  it('a settled refusal is remembered for a minute, a dead network is not', async () => {
    const { recall, tick } = setup();
    const missing = vi.fn(() =>
      Promise.resolve<Answer>({ ok: false, error: { code: 'not-found' } }),
    );
    const offline = vi.fn(() => Promise.resolve<Answer>({ ok: false, error: { code: 'offline' } }));
    await recall.read(ask(missing, { key: 'm' }));
    await recall.read(ask(missing, { key: 'm' }));
    await recall.read(ask(offline, { key: 'o' }));
    await recall.read(ask(offline, { key: 'o' }));
    expect(missing).toHaveBeenCalledTimes(1);
    expect(offline).toHaveBeenCalledTimes(2);
    tick(REFUSAL_PAUSE_MS + 1);
    await recall.read(ask(missing, { key: 'm' }));
    expect(missing).toHaveBeenCalledTimes(2);
  });
});
