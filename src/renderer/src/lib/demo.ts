export interface DemoEnv {
  DEV: boolean;
  VITE_LAUNCHER_DEMO?: string | undefined;
}

export function isDemoMode(env: DemoEnv): boolean {
  return env.DEV ? env.VITE_LAUNCHER_DEMO !== 'off' : env.VITE_LAUNCHER_DEMO === 'on';
}
