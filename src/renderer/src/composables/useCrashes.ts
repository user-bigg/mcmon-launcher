import { shallowRef, type ShallowRef } from 'vue';
import type {
  CrashAnalysis,
  CrashFixOutcome,
  CrashReportPreview,
  CrashResult,
} from '@shared/crash';
import { crashes as demoCrashes, crashLogs, type CrashLogLine } from '../mock/player';
import type { LauncherContext } from './context';
import { useStores } from './context';

export interface CrashStore {
  last: ShallowRef<CrashAnalysis | null>;
  find: (instanceId: string) => CrashAnalysis | null;
  isDemo: (analysis: CrashAnalysis) => boolean;
  demoLog: (analysis: CrashAnalysis) => CrashLogLine[] | null;
  apply: (analysis: CrashAnalysis, fix: number) => Promise<CrashResult<CrashFixOutcome>>;
  report: (analysis: CrashAnalysis) => Promise<CrashResult<CrashReportPreview>>;
  dispose: () => void;
}

export function createCrashes(context: LauncherContext): CrashStore {
  const { api } = context;
  const last = shallowRef<CrashAnalysis | null>(null);
  const demo = context.demo ? demoCrashes : [];

  const unsubscribe = api.crash.onEvent((event) => {
    last.value = event.analysis;
  });
  void api.crash.last().then((result) => {
    if (result.ok && result.value !== null && last.value === null) {
      last.value = result.value;
    }
  });

  function isDemo(analysis: CrashAnalysis): boolean {
    return demo.some((item) => item.id === analysis.id);
  }

  return {
    last,
    find: (instanceId) =>
      last.value?.instance === instanceId
        ? last.value
        : (demo.find((item) => item.instance === instanceId) ?? null),
    isDemo,
    demoLog: (analysis) => (isDemo(analysis) ? (crashLogs[analysis.id] ?? null) : null),
    apply: (analysis, fix) => api.crash.apply({ analysisId: analysis.id, fix }),
    report: (analysis) => api.crash.report(analysis.id),
    dispose: unsubscribe,
  };
}

export function useCrashes(): CrashStore {
  return useStores().crashes;
}
