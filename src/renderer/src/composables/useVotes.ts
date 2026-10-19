import { reactive, ref, watch } from 'vue';
import { ALERT_POLL_MS } from '@shared/alerts';
import { whenVisible } from '../lib/when-visible';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { AccountsStore } from './useAccounts';

export interface VotesStore {
  session: () => number;
  remember: (serverId: number, canVoteAt: string | null, session?: number) => void;
  available: (serverId: number, listed?: boolean) => boolean;
  load: () => Promise<void>;
  dispose: () => void;
}

const TICK_MS = 30_000;

export function createVotes(context: LauncherContext, accounts: AccountsStore): VotesStore {
  const known = reactive(new Map<number, number | null>());
  const nowMs = ref(context.now().getTime());
  const listed = ref(false);
  let session = 0;
  let loadedAt = 0;

  async function load(): Promise<void> {
    if (context.demo || accounts.mc.value === null) {
      return;
    }
    const asked = session;
    loadedAt = context.now().getTime();
    const result = await context.api.site.votePauses();
    if (asked !== session || !result.ok) {
      return;
    }
    known.clear();
    for (const pause of result.value) {
      remember(pause.serverId, pause.canVoteAt, asked);
    }
    listed.value = true;
  }

  const poll = whenVisible(() => {
    nowMs.value = context.now().getTime();
    if (nowMs.value - loadedAt >= ALERT_POLL_MS) {
      void load();
    }
  });
  const timer = setInterval(poll.tick, TICK_MS);
  const stop = watch(
    () => accounts.mc.value?.id ?? null,
    () => {
      session += 1;
      known.clear();
      listed.value = false;
      void load();
    },
    { flush: 'sync', immediate: true },
  );

  function remember(serverId: number, canVoteAt: string | null, asked: number = session): void {
    if (asked !== session) {
      return;
    }
    const at = canVoteAt === null ? null : Date.parse(canVoteAt);
    if (at !== null && Number.isNaN(at)) {
      known.delete(serverId);
      return;
    }
    known.set(serverId, at);
  }

  function available(serverId: number, inList = false): boolean {
    if (accounts.mc.value === null) {
      return false;
    }
    const at = known.get(serverId);
    return at === undefined ? inList && listed.value : at === null || at <= nowMs.value;
  }

  return {
    session: () => session,
    remember,
    available,
    load,
    dispose: (): void => {
      stop();
      poll.dispose();
      clearInterval(timer);
    },
  };
}

export function useVotes(): VotesStore {
  return useStores().votes;
}
