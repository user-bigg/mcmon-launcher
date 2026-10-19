import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import { ALERT_POLL_MS, type AlertFeed, type AlertItem } from '@shared/alerts';
import { whenVisible } from '../lib/when-visible';
import { demoAlerts } from '../mock/player';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { AccountsStore } from './useAccounts';

export type AlertsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AlertsStore {
  items: ShallowRef<AlertItem[]>;
  unread: ComputedRef<number>;
  status: Ref<AlertsStatus>;
  hasMore: ComputedRef<boolean>;
  busy: Ref<boolean>;
  actionFailed: Ref<boolean>;
  signedIn: ComputedRef<boolean>;
  open: () => Promise<void>;
  more: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: number) => void;
  clear: () => Promise<void>;
  dispose: () => void;
}

function newestFirst(items: readonly AlertItem[]): AlertItem[] {
  return items.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id);
}

function merged(kept: readonly AlertItem[], added: readonly AlertItem[]): AlertItem[] {
  const known = new Set(kept.map((item) => item.id));
  return newestFirst([...kept, ...added.filter((item) => !known.has(item.id))]);
}

const EMPTY_FEED: AlertFeed = { items: [], unread: 0, next: null };
const UNREAD_PULL_GAP_MS = 60_000;

export function createAlerts(context: LauncherContext, accounts: AccountsStore): AlertsStore {
  const items = shallowRef<AlertItem[]>([]);
  const feedUnread = ref<number | null>(null);
  const next = ref<string | null>(null);
  const status = ref<AlertsStatus>('idle');
  const busy = ref(false);
  const actionFailed = ref(false);
  const signedIn = computed(() => accounts.mc.value !== null);
  const unread = computed(() =>
    signedIn.value ? (feedUnread.value ?? accounts.mc.value?.unreadAlerts ?? 0) : 0,
  );
  let session = 0;
  let actions = 0;
  let extended = false;
  let pulledAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading: Promise<void> | null = null;

  function adopt(feed: AlertFeed): void {
    if (extended) {
      items.value = merged(feed.items, items.value);
    } else {
      items.value = newestFirst(feed.items);
      next.value = feed.next;
    }
    feedUnread.value = feed.unread;
    status.value = 'ready';
  }

  const poll = whenVisible(() => {
    void load();
  });

  function schedule(delayMs: number = ALERT_POLL_MS): void {
    clearTimeout(timer);
    timer = setTimeout(poll.tick, delayMs);
  }

  async function pull(again = true): Promise<void> {
    const started = session;
    const acted = actions;
    if (status.value !== 'ready') {
      status.value = 'loading';
    }
    pulledAt = context.now().getTime();
    schedule();
    const result = await context.api.site.alerts();
    if (started !== session) {
      return;
    }
    if (acted !== actions) {
      if (again) {
        await pull(false);
      }
      return;
    }
    if (result.ok) {
      adopt(result.value);
    } else if (result.error.code !== 'unavailable') {
      status.value = 'error';
    } else if (status.value !== 'ready') {
      adopt(EMPTY_FEED);
    }
  }

  function load(): Promise<void> {
    if (context.demo || !signedIn.value) {
      return Promise.resolve();
    }
    if (loading === null) {
      const started = session;
      loading = pull().finally(() => {
        if (started === session) {
          loading = null;
        }
      });
    }
    return loading;
  }

  async function more(): Promise<void> {
    const cursor = next.value;
    if (context.demo || cursor === null || busy.value) {
      return;
    }
    const started = session;
    busy.value = true;
    const result = await context.api.site.alerts(cursor);
    if (started !== session) {
      return;
    }
    busy.value = false;
    actionFailed.value = !result.ok;
    if (result.ok) {
      extended = true;
      items.value = merged(items.value, result.value.items);
      feedUnread.value = result.value.unread;
      next.value = result.value.next;
    }
  }

  async function act(request: () => Promise<{ ok: boolean }>, apply: () => void): Promise<void> {
    if (busy.value || !signedIn.value) {
      return;
    }
    const started = session;
    actionFailed.value = false;
    if (!context.demo) {
      busy.value = true;
      const result = await request();
      if (started !== session) {
        return;
      }
      busy.value = false;
      if (!result.ok) {
        actionFailed.value = true;
        return;
      }
    }
    actions += 1;
    apply();
  }

  function markAllRead(): Promise<void> {
    return act(
      () => context.api.site.readAlerts(),
      () => {
        items.value = items.value.map((item) => ({ ...item, read: true }));
        feedUnread.value = 0;
      },
    );
  }

  function markRead(id: number): void {
    const item = items.value.find((entry) => entry.id === id);
    if (item === undefined || item.read || !signedIn.value) {
      return;
    }
    actions += 1;
    items.value = items.value.map((entry) => (entry.id === id ? { ...entry, read: true } : entry));
    feedUnread.value = Math.max(0, (feedUnread.value ?? 1) - 1);
    if (!context.demo) {
      void context.api.site.readAlerts([id]);
    }
  }

  function clear(): Promise<void> {
    return act(
      () => context.api.site.clearAlerts(),
      () => {
        items.value = [];
        feedUnread.value = 0;
        next.value = null;
        extended = false;
      },
    );
  }

  function reset(): void {
    session += 1;
    clearTimeout(timer);
    loading = null;
    extended = false;
    items.value = [];
    feedUnread.value = null;
    next.value = null;
    status.value = 'idle';
    busy.value = false;
    actionFailed.value = false;
  }

  function fillDemo(): void {
    const list = demoAlerts(context.now());
    adopt({ items: list, unread: list.filter((item) => !item.read).length, next: null });
  }

  const stop = watch(
    () => accounts.mc.value?.id ?? null,
    (id) => {
      reset();
      if (id === null) {
        return;
      }
      if (context.demo) {
        fillDemo();
      } else {
        void load();
      }
    },
    { immediate: true },
  );

  const stopUnread = watch(
    () => [accounts.mc.value?.id ?? null, accounts.mc.value?.unreadAlerts ?? null] as const,
    ([id, fresh], [previousId, previous]) => {
      const stale = fresh !== null && fresh !== previous && fresh !== feedUnread.value;
      if (context.demo || id !== previousId || feedUnread.value === null || !stale) {
        return;
      }
      schedule(Math.max(0, pulledAt + UNREAD_PULL_GAP_MS - context.now().getTime()));
    },
  );

  return {
    items,
    unread,
    status,
    hasMore: computed(() => next.value !== null),
    busy,
    actionFailed,
    signedIn,
    open: (): Promise<void> => {
      actionFailed.value = false;
      return load();
    },
    more,
    markAllRead,
    markRead,
    clear,
    dispose: (): void => {
      stop();
      stopUnread();
      poll.dispose();
      clearTimeout(timer);
    },
  };
}

export function useAlerts(): AlertsStore {
  return useStores().alerts;
}
