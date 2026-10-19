// @vitest-environment happy-dom
import { computed } from 'vue';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createAppRouter } from '../router';
import { LOGIN_ROUTE, openLoginOnFirstRun } from './first-run';

function signedOut(ready: Promise<void>): Parameters<typeof openLoginOnFirstRun>[1] {
  return { ready, active: computed(() => null), mc: computed(() => null) };
}

describe('first run', () => {
  it('opens the sign-in screen instead of home when nobody is signed in', async () => {
    const router = createAppRouter(createMemoryHistory());
    openLoginOnFirstRun(router, signedOut(Promise.resolve()));
    await router.push('/');
    expect(router.currentRoute.value.path).toBe(LOGIN_ROUTE);
  });

  it('answers that never come do not hold the window: home opens after the timeout', async () => {
    const router = createAppRouter(createMemoryHistory());
    openLoginOnFirstRun(router, signedOut(new Promise(() => undefined)), 10);
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/');
  });
});
