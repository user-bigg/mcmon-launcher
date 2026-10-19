import { createHash } from 'node:crypto';
import type { SiteChange } from '@shared/site';

export type Outcome =
  | { ok: true; value: unknown; stale?: boolean; refreshing?: boolean }
  | { ok: false; error: { code: string; retryAfterS?: number } };

export interface Seed<R> {
  value: R;
  at: number;
}

export interface Ask<R extends Outcome> {
  key: string;
  change: SiteChange;
  ttlMs: number;
  fetch: () => Promise<R>;
  personal?: boolean;
  seed?: () => Promise<Seed<R> | null>;
  // 'wait' answers with the fresh value only; 'swr' answers with the last known one at once and
  // refreshes behind it.
  mode?: 'swr' | 'wait';
  force?: boolean;
}

export interface RecallOptions {
  now: () => number;
  onChange: (change: SiteChange) => void;
}

interface Entry {
  value: Outcome;
  at: number;
  print: string;
  personal: boolean;
}

interface Flight {
  answer: Promise<Outcome>;
  personal: boolean;
}

interface Pause {
  until: number;
  lengthMs: number;
  failure: Outcome;
  personal: boolean;
}

// The site has answered and the answer will not change by asking again at once: a route it does
// not have yet, a body the launcher cannot read. A dead network is not remembered, so that
// the retry button always asks.
const SETTLED_REFUSALS: readonly string[] = [
  'not-found',
  'invalid-response',
  'server_not_found',
  'invalid_response',
  'unavailable',
];
export const REFUSAL_PAUSE_MS = 60_000;
export const MAX_ENTRIES = 300;
// A value this young is never asked for again, whatever its term: a window that reads again on
// every change must not turn a site without Cache-Control into an endless chain of requests.
export const MIN_FRESH_MS = 5_000;

function pauseMs(error: { code: string; retryAfterS?: number }): number {
  if (error.retryAfterS !== undefined && error.retryAfterS > 0) {
    return error.retryAfterS * 1000;
  }
  return SETTLED_REFUSALS.includes(error.code) ? REFUSAL_PAUSE_MS : 0;
}

function printOf(value: Outcome): string {
  if (!value.ok) {
    return '';
  }
  const text = JSON.stringify([value.value, value.stale === true, value.refreshing === true]);
  return createHash('sha1').update(text).digest('base64');
}

export class Recall {
  private readonly entries = new Map<string, Entry>();
  private readonly flights = new Map<string, Flight>();
  private readonly pauses = new Map<string, Pause>();
  private readonly seeded = new Set<string>();

  constructor(private readonly options: RecallOptions) {}

  async read<R extends Outcome>(ask: Ask<R>): Promise<R> {
    await this.plant(ask);
    const entry = this.entries.get(ask.key);
    if (entry === undefined || ask.force === true) {
      return this.settled(ask, entry);
    }
    this.touch(ask.key, entry);
    if (this.fresh(entry, ask.ttlMs)) {
      return entry.value as R;
    }
    if (ask.mode === 'wait') {
      return this.settled(ask, entry);
    }
    void this.refresh(ask);
    return entry.value as R;
  }

  // A read that left before this write must not land on top of it.
  put(ask: Pick<Ask<Outcome>, 'key' | 'personal'>, value: Outcome): void {
    if (!value.ok) {
      return;
    }
    this.flights.delete(ask.key);
    this.seeded.add(ask.key);
    this.pauses.delete(ask.key);
    this.store(ask.key, {
      value,
      at: this.options.now(),
      print: printOf(value),
      personal: ask.personal === true,
    });
  }

  peek(key: string): Outcome | null {
    return this.entries.get(key)?.value ?? null;
  }

  drop(matches: (key: string) => boolean): void {
    for (const store of [this.entries, this.pauses, this.flights]) {
      for (const key of [...store.keys()].filter(matches)) {
        store.delete(key);
      }
    }
  }

  // An answer still on its way belongs to the account that asked: it is not kept.
  clearPersonal(): void {
    for (const store of [this.entries, this.pauses, this.flights]) {
      for (const [key, item] of [...store.entries()]) {
        if (item.personal) {
          store.delete(key);
        }
      }
    }
  }

  // The age is checked from both sides: a clock moved back must not keep a value fresh for the
  // length of the shift. A value the site could not confirm is never fresh.
  private fresh(entry: Entry, ttlMs: number): boolean {
    const age = this.options.now() - entry.at;
    const unconfirmed = entry.value.ok && entry.value.stale === true;
    return !unconfirmed && age >= 0 && age < Math.max(ttlMs, MIN_FRESH_MS);
  }

  private paused(key: string): Pause | null {
    const pause = this.pauses.get(key);
    if (pause === undefined) {
      return null;
    }
    const left = pause.until - this.options.now();
    if (left > 0 && left <= pause.lengthMs) {
      return pause;
    }
    this.pauses.delete(key);
    return null;
  }

  private touch(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private store(key: string, entry: Entry): void {
    this.touch(key, entry);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) {
        break;
      }
      this.entries.delete(oldest);
      this.pauses.delete(oldest);
      this.seeded.delete(oldest);
    }
    if (this.seeded.size > 2 * MAX_ENTRIES) {
      this.seeded.clear();
    }
    if (this.pauses.size > MAX_ENTRIES) {
      for (const key of [...this.pauses.keys()]) {
        this.paused(key);
      }
    }
  }

  private async plant<R extends Outcome>(ask: Ask<R>): Promise<void> {
    if (ask.seed === undefined || this.seeded.has(ask.key) || this.entries.has(ask.key)) {
      return;
    }
    this.seeded.add(ask.key);
    const seed = await ask.seed().catch(() => null);
    if (seed !== null && seed.value.ok && !this.entries.has(ask.key)) {
      this.store(ask.key, {
        value: seed.value,
        at: seed.at,
        print: printOf(seed.value),
        personal: ask.personal === true,
      });
    }
  }

  // The last known value stands in for a refusal: a 429 or a dead network never empties a
  // place that already has something to show.
  private async settled<R extends Outcome>(ask: Ask<R>, entry: Entry | undefined): Promise<R> {
    const result = await this.refresh(ask);
    return !result.ok && entry !== undefined ? (entry.value as R) : result;
  }

  private refresh<R extends Outcome>(ask: Ask<R>): Promise<R> {
    const flying = this.flights.get(ask.key);
    if (flying !== undefined) {
      return flying.answer as Promise<R>;
    }
    const pause = ask.force === true ? null : this.paused(ask.key);
    if (pause !== null) {
      return Promise.resolve(pause.failure as R);
    }
    const personal = ask.personal === true;
    const registered = (): boolean => this.flights.get(ask.key)?.answer === answer;
    const answer: Promise<R> = ask.fetch().then((result) => {
      if (registered()) {
        this.flights.delete(ask.key);
        this.keep(ask, result, personal);
      }
      return result;
    });
    this.flights.set(ask.key, { answer, personal });
    void answer.catch(() => {
      if (registered()) {
        this.flights.delete(ask.key);
      }
    });
    return answer;
  }

  private keep(ask: Ask<Outcome>, result: Outcome, personal: boolean): void {
    const now = this.options.now();
    if (!result.ok) {
      const lengthMs = pauseMs(result.error);
      if (lengthMs > 0) {
        this.pauses.set(ask.key, { until: now + lengthMs, lengthMs, failure: result, personal });
      }
      return;
    }
    const previous = this.entries.get(ask.key);
    const print = printOf(result);
    this.pauses.delete(ask.key);
    this.store(ask.key, { value: result, at: now, print, personal });
    if (previous !== undefined && previous.print !== print) {
      this.options.onChange(ask.change);
    }
  }
}
