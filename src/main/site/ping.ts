import type { PingTarget } from '@shared/catalog';
import type { PingResult, ServerPing } from '@shared/site';
import { DEFAULT_SERVER_PORT, type ServerAddress } from '@shared/server-address';

export const PING_TIMEOUT_MS = 3000;
export const PING_INTERVAL_MS = 20_000;
export const PING_TARGET_MAX_AGE_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_REMEMBERED = 500;

export interface StatusReply {
  players: { online: number; max: number };
  ping: number;
}

export interface PingerDeps {
  query: (host: string, port: number, timeoutMs: number) => Promise<StatusReply>;
  resolveSrv: (address: ServerAddress) => Promise<ServerAddress>;
  now: () => number;
  timeoutMs?: number;
  intervalMs?: number;
}

interface Remembered {
  at: number;
  result: Promise<PingResult>;
}

class PingTimeout extends Error {}

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new PingTimeout());
    }, ms);
  });
  return Promise.race([task, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function pingOf(reply: StatusReply): ServerPing {
  return {
    ms: Math.max(0, Math.round(reply.ping)),
    online: count(reply.players.online),
    max: count(reply.players.max),
  };
}

export function freshTarget(target: PingTarget | null, now: number): PingTarget | null {
  if (target === null) {
    return null;
  }
  const age = now - Date.parse(target.checkedAt);
  return age >= -CLOCK_SKEW_MS && age < PING_TARGET_MAX_AGE_MS ? target : null;
}

export class ServerPinger {
  private readonly remembered = new Map<string, Remembered>();

  constructor(private readonly deps: PingerDeps) {}

  ping(address: ServerAddress, target: PingTarget | null = null): Promise<PingResult> {
    const key = `${address.host}:${String(address.port ?? DEFAULT_SERVER_PORT)}`;
    const now = this.deps.now();
    const last = this.remembered.get(key);
    if (last !== undefined && now - last.at < (this.deps.intervalMs ?? PING_INTERVAL_MS)) {
      return last.result;
    }
    const result = this.run(address, freshTarget(target, now));
    this.remember(key, { at: now, result });
    return result;
  }

  private remember(key: string, entry: Remembered): void {
    this.remembered.delete(key);
    this.remembered.set(key, entry);
    if (this.remembered.size > MAX_REMEMBERED) {
      const oldest = this.remembered.keys().next().value;
      if (oldest !== undefined) {
        this.remembered.delete(oldest);
      }
    }
  }

  private async reach(address: ServerAddress, checked: PingTarget | null): Promise<StatusReply> {
    const timeoutMs = this.deps.timeoutMs ?? PING_TIMEOUT_MS;
    if (checked !== null) {
      return this.deps.query(checked.ip, checked.port, timeoutMs);
    }
    const target = await this.deps.resolveSrv(address);
    return this.deps.query(target.host, target.port ?? DEFAULT_SERVER_PORT, timeoutMs);
  }

  private async run(address: ServerAddress, checked: PingTarget | null): Promise<PingResult> {
    const timeoutMs = this.deps.timeoutMs ?? PING_TIMEOUT_MS;
    try {
      const reply = await withTimeout(this.reach(address, checked), timeoutMs);
      return { ok: true, value: pingOf(reply) };
    } catch (error) {
      return {
        ok: false,
        error: { code: error instanceof PingTimeout ? 'timeout' : 'unreachable' },
      };
    }
  }
}
