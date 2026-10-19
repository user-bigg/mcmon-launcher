import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type { AccountError, AccountResult } from '@shared/account';
import { TOP_SLOT_TIERS, type ServerCard, type TopSlotTier } from '@shared/catalog';
import type { OwnedServer, OwnedServerDetails, OwnedServerRef } from '@shared/owner';
import { needsAttention } from '../lib/owner';
import { whenVisible } from '../lib/when-visible';
import { ownedCard, ownedIcon, ownedServers } from '../mock/owner';
import { catalog as demoCatalog } from '../mock/servers';
import type { LauncherContext } from './context';
import { useStores } from './context';
import type { AccountsStore } from './useAccounts';
import type { CatalogStore } from './useCatalog';

export type OwnerStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface OwnerStore {
  refs: ComputedRef<OwnedServerRef[]>;
  isOwner: ComputedRef<boolean>;
  settled: Ref<boolean>;
  servers: ShallowRef<OwnedServer[]>;
  status: Ref<OwnerStatus>;
  error: Ref<AccountError | null>;
  attention: ComputedRef<boolean>;
  load: () => Promise<void>;
  details: (id: number) => Promise<AccountResult<OwnedServerDetails>>;
  card: (id: number) => Promise<ServerCard | null>;
  freeTopSlots: () => Promise<TopSlotTier[]>;
  icon: (id: number) => string | null;
  dispose: () => void;
}

const REFRESH_INTERVAL_MS = 5 * 60_000;

export function createOwner(
  context: LauncherContext,
  catalog: CatalogStore,
  accounts: AccountsStore,
): OwnerStore {
  const refs = computed(() => accounts.mc.value?.ownedServers ?? []);
  const isOwner = computed(() => refs.value.length > 0);
  const settled = ref(context.demo);
  const servers = shallowRef<OwnedServer[]>([]);
  const status = ref<OwnerStatus>('idle');
  const error = ref<AccountError | null>(null);
  let run = 0;

  function reset(): void {
    run += 1;
    servers.value = [];
    error.value = null;
    status.value = 'idle';
  }

  async function load(): Promise<void> {
    if (!isOwner.value) {
      return;
    }
    if (context.demo) {
      servers.value = ownedServers(context.now().getTime());
      status.value = 'ready';
      return;
    }
    run += 1;
    const current = run;
    if (status.value !== 'ready') {
      status.value = 'loading';
    }
    const result = await context.api.site.ownedServers();
    if (current !== run) {
      return;
    }
    if (result.ok) {
      servers.value = result.value;
      error.value = null;
      status.value = 'ready';
      void catalog.need(result.value.map((item) => item.id));
      return;
    }
    if (result.error.code === 'unavailable') {
      servers.value = [];
      error.value = null;
      status.value = 'ready';
      return;
    }
    error.value = result.error;
    if (servers.value.length === 0) {
      status.value = 'error';
    }
  }

  async function details(id: number): Promise<AccountResult<OwnedServerDetails>> {
    if (!context.demo) {
      return context.api.site.ownedServer(id);
    }
    const value = ownedServers(context.now().getTime()).find((item) => item.id === id);
    return value === undefined ? { ok: false, error: { code: 'forbidden' } } : { ok: true, value };
  }

  async function card(id: number): Promise<ServerCard | null> {
    return context.demo ? (ownedCard(id, context.now().getTime()) ?? null) : catalog.card(id);
  }

  async function freeTopSlots(): Promise<TopSlotTier[]> {
    const free = context.demo
      ? demoCatalog.topSlotsFree
      : await context.api.site
          .servers({ page: 1, per_page: 1 })
          .then((result) => (result.ok ? result.value.topSlotsFree : null));
    return free === null ? [] : TOP_SLOT_TIERS.filter((tier) => free[tier] > 0);
  }

  const stopSettled = watch(accounts.mcState, () => {
    settled.value = true;
  });

  const stopAccount = watch(
    () => `${String(accounts.mc.value?.id ?? '')}:${refs.value.map((item) => item.id).join(',')}`,
    () => {
      reset();
      void load();
    },
    { immediate: true },
  );

  const poll = whenVisible(() => {
    void load();
  });
  const timer = context.demo ? undefined : setInterval(poll.tick, REFRESH_INTERVAL_MS);

  return {
    refs,
    isOwner,
    settled,
    servers,
    status,
    error,
    attention: computed(() => needsAttention(refs.value, servers.value)),
    load,
    details,
    card,
    freeTopSlots,
    icon: (id) => (context.demo ? ownedIcon(id) : (catalog.server(id)?.icon_url ?? null)),
    dispose: (): void => {
      stopSettled();
      stopAccount();
      poll.dispose();
      clearInterval(timer);
    },
  };
}

export function useOwner(): OwnerStore {
  return useStores().owner;
}
