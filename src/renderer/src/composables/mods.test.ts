// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  ModChoices,
  ModChoicesPatch,
  ModsResult,
  ServerModsQuery,
  ServerModsView,
} from '@shared/mods';
import { modsGroups } from '../lib/mods';
import { contextOf, stubLauncher } from '../testing';
import { STORES_KEY } from './context';
import { createMods, useServerMods, type ServerModsState } from './useMods';

const EMPTY_VIEW: ServerModsView = {
  serverId: 0,
  minecraft: '1.21.1',
  known: true,
  installs: true,
  mods: [],
  unknownRequired: [],
};

function enabledOf(view: ReturnType<typeof createMods>['view']['value'], slug: string): boolean {
  return (
    view?.groups.flatMap((group) => group.mods).find((mod) => mod.slug === slug)?.enabled ?? false
  );
}

describe('mods store', () => {
  it('two quick switches both stay: the second save starts from what the first wrote', async () => {
    const stub = stubLauncher();
    const mods = createMods(contextOf(stub));
    await mods.load();
    const first = mods.setEnabled('ferritecore', true);
    const second = mods.setEnabled('dynamic-fps', true);
    expect(enabledOf(mods.view.value, 'ferritecore')).toBe(true);
    expect(enabledOf(mods.view.value, 'dynamic-fps')).toBe(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    await flushPromises();
    expect(stub.mods.choices.enabled).toEqual(['ferritecore', 'dynamic-fps']);
    expect(enabledOf(mods.view.value, 'ferritecore')).toBe(true);
  });

  it('a switch that main did not keep goes back and says so', async () => {
    const stub = stubLauncher();
    stub.api.mods.setChoices = vi.fn((): Promise<ModsResult<ModChoices>> =>
      Promise.resolve({ ok: false, error: { code: 'failed' } }),
    );
    const mods = createMods(contextOf(stub));
    await mods.load();
    const saving = mods.setEnabled('ferritecore', true);
    expect(enabledOf(mods.view.value, 'ferritecore')).toBe(true);
    expect(await saving).toBe(false);
    await flushPromises();
    expect(enabledOf(mods.view.value, 'ferritecore')).toBe(false);
    expect(mods.saveFailed.value).toBe(true);
  });

  it('shaders turned off and on again come back with the pack the player chose', async () => {
    const stub = stubLauncher();
    const mods = createMods(contextOf(stub));
    await mods.load();
    await mods.setShaders('light');
    await mods.setShaders('off');
    await flushPromises();
    const view = mods.view.value;
    const row = view === null ? null : modsGroups(view, mods.lastShaders.value)[1]?.shaders;
    expect(row).toMatchObject({ on: false, choice: 'light' });
    const patches = vi
      .mocked(stub.api.mods.setChoices)
      .mock.calls.map(([patch]: [ModChoicesPatch]) => patch.shaders);
    expect(patches).toEqual(['light', 'off']);
  });

  it('a catalog that is asked again after a failure shows the loading state', async () => {
    const stub = stubLauncher();
    stub.mods.catalog = null;
    const mods = createMods(contextOf(stub));
    await mods.load();
    expect(mods.status.value).toBe('error');
    const again = mods.load();
    expect(mods.status.value).toBe('loading');
    await again;
  });
});

describe('mods of the server in view', () => {
  it('an answer for the server left behind does not land on the new one', async () => {
    const stub = stubLauncher();
    const mods = createMods(contextOf(stub));
    const answers: (() => void)[] = [];
    mods.serverPlan = vi.fn(
      (query: ServerModsQuery) =>
        new Promise<ServerModsView | null>((resolve) => {
          answers.push(() => {
            resolve({ ...EMPTY_VIEW, serverId: query.serverId });
          });
        }),
    );
    const serverId = ref(1);
    let state: ServerModsState | undefined;
    mount(
      defineComponent({
        setup() {
          state = useServerMods(() => ({ serverId: serverId.value, minecraft: '1.21.1' }));
          return (): null => null;
        },
      }),
      { global: { provide: { [STORES_KEY as symbol]: { mods } } } },
    );
    serverId.value = 2;
    await nextTick();
    answers[1]?.();
    await flushPromises();
    answers[0]?.();
    await flushPromises();
    expect(state?.view.value?.serverId).toBe(2);
  });
});
