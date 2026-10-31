export interface SystemMemory {
  totalMb: number;
  defaultGameMb: number;
}

export interface JavaRange {
  major: number;
  from: string | null;
  to: string | null;
}

export const JAVA_RANGES: readonly JavaRange[] = [
  { major: 25, from: '26.1', to: null },
  { major: 21, from: '1.20.5', to: '1.21.11' },
  { major: 17, from: '1.17', to: '1.20.4' },
  { major: 8, from: null, to: '1.16.5' },
];

export interface SystemJava {
  installed: number[];
}

export type SystemResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: 'invalid-request'; field: string } | { code: 'failed' } };

// 'blocked': the launcher keeps its entry, but the Task Manager has switched it off.
export type AutostartView = 'on' | 'off' | 'blocked';

export interface SystemAutostart {
  view: AutostartView;
}

// `ceiling` is the newest Minecraft this computer's video card can run, null when any will do.
export interface SystemGraphics {
  ceiling: string | null;
  gpu: string | null;
}

export interface SystemService {
  memory: () => Promise<SystemResult<SystemMemory>>;
  java: () => Promise<SystemResult<SystemJava>>;
  autostart: () => Promise<SystemResult<SystemAutostart>>;
  enableAutostart: () => Promise<SystemResult<SystemAutostart>>;
}
