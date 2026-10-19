import type { Router } from 'vue-router';
import type { AccountsStore } from '../composables/useAccounts';

export const LOGIN_ROUTE = '/welcome';
const READY_TIMEOUT_MS = 3000;

type FirstRunAccounts = Pick<AccountsStore, 'ready' | 'active' | 'mc'>;

function settled(ready: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    void ready.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export function openLoginOnFirstRun(
  router: Router,
  accounts: FirstRunAccounts,
  timeoutMs: number = READY_TIMEOUT_MS,
): void {
  const remove = router.beforeEach(async (to) => {
    remove();
    const loaded = await settled(accounts.ready, timeoutMs);
    const signedOut = accounts.active.value === null && accounts.mc.value === null;
    return loaded && signedOut && to.path === '/' ? LOGIN_ROUTE : true;
  });
}
