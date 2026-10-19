// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, type DefineComponent, type VNode } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { ServerLaunch, ServerRow } from '@shared/catalog';
import { homeRowsRu } from '@shared/i18n/home-rows.ru';
import { ru } from '@shared/i18n/ru';
import type { Scene } from '@shared/scenes';
import { launcherPlugin } from '../composables/stores';
import { topSlots } from '../mock/servers';
import { stubLauncher, TEST_NOW } from '../testing';
import ContinueHero from './ContinueHero.vue';
import PixelLandscape from './PixelLandscape.vue';
import TopSlotRow from './TopSlotRow.vue';

const BASE = 'https://cdn.example/landscapes';

const taiga: Scene = {
  key: 'taiga',
  name: 'Taiga',
  pack: 'nature',
  purpose: 'library',
  focus: 0.5,
  skies: { day: '#4f86cc', sunset: '#22265e', night: '#01030c' },
  layers: {
    day: [
      { name: 'ground', depth: 1 },
      { name: 'sky', depth: 0 },
      { name: 'mid', depth: 0.55 },
      { name: 'clouds', depth: 0.15 },
      { name: 'far', depth: 0.3 },
    ],
    sunset: [{ name: 'sky', depth: 0 }],
    night: [{ name: 'sky', depth: 0 }],
  },
};

function server(patch: Partial<ServerRow> = {}): ServerRow {
  const [base] = topSlots.diamond;
  if (base === undefined) {
    throw new Error('mock top slot missing');
  }
  return { ...base, cover: { scene: 'taiga', time: 'day' }, ...patch };
}

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: (): VNode => h('span') } }],
  });
}

let wrapper: VueWrapper | undefined;

async function mountWith(component: unknown, props: Record<string, unknown>): Promise<VueWrapper> {
  const router = testRouter();
  await router.push('/');
  wrapper = mount(component as DefineComponent<Record<string, unknown>>, {
    props,
    global: {
      plugins: [
        router,
        launcherPlugin({
          api: stubLauncher().api,
          demo: false,
          now: () => TEST_NOW,
          random: () => 0,
        }),
      ],
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('PixelLandscape', () => {
  it('computes scale by width and places layers by depth', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
    const view = await mountWith(PixelLandscape, {
      scene: taiga,
      base: BASE,
      time: 'day',
      height: 44,
    });
    const root = view.find('.landscape').element as HTMLElement;
    expect(root.style.getPropertyValue('--lx-scene-px')).toBe('3px');
    expect(root.style.getPropertyValue('--lx-scene-sky')).toBe('#4f86cc');
    expect(root.style.height).toBe('132px');
    const layers = view.findAll('[data-depth]');
    expect(layers.map((layer) => layer.attributes('data-layer'))).toEqual([
      'sky',
      'clouds',
      'far',
      'mid',
      'ground',
    ]);
    expect(layers.map((layer) => Number(layer.attributes('data-depth')))).toEqual([
      0, 0.15, 0.3, 0.55, 1,
    ]);
    expect(view.find('[data-layer="ground"] img').attributes('src')).toBe(
      `${BASE}/taiga-day/ground.png`,
    );
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TopSlotRow', () => {
  const launches: [ServerLaunch, string, string][] = [
    [{ kind: 'direct', minecraft: '26.1.2' }, 'direct', ru.launch.play],
    [
      { kind: 'own_launcher', url: 'https://example.org/l', label: 'Скачать лаунчер сервера' },
      'own_launcher',
      ru.launch.ownLauncherShort,
    ],
    [{ kind: 'none' }, 'none', ru.launch.howToJoin],
  ];

  it.each(launches)('the action follows launch.kind', async (launch, kind, label) => {
    const view = await mountWith(TopSlotRow, {
      server: server({ launch }),
      scene: taiga,
      sceneBase: BASE,
    });
    const actions = view.findAll('[data-launch]');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.attributes('data-launch')).toBe(kind);
    expect(actions[0]?.text()).toContain(label);
    if (launch.kind === 'own_launcher') {
      expect(actions[0]?.attributes('href')).toBe(launch.url);
    }
  });

  it('a paid slot — a tier bar and an icon with a label', async () => {
    const view = await mountWith(TopSlotRow, { server: server(), scene: taiga, sceneBase: BASE });
    expect(view.find('svg[role="img"]').attributes('aria-label')).toBe(ru.topSlots.diamond);
  });

  it("the 'More' link has a clear label", async () => {
    const row = server();
    const view = await mountWith(TopSlotRow, { server: row, scene: undefined, sceneBase: BASE });
    const more = view.find('a.link');
    expect(more.text()).toBe(homeRowsRu.topSlot.more);
    expect(more.attributes('aria-label')).toContain(row.name);
    expect(view.find('.landscape').exists()).toBe(false);
  });
});

describe('ContinueHero', () => {
  const played = { playedAt: '2026-10-02T18:00:00Z', durationSeconds: 8040 };

  it("server name and 'Play'", async () => {
    const view = await mountWith(ContinueHero, {
      server: server(),
      scene: taiga,
      sceneBase: BASE,
      ping: null,
      installed: true,
      ...played,
    });
    expect(view.find('[data-launch="direct"]').text()).toContain(ru.launch.play);
  });

  it('offline is shown with a word, not only with color', async () => {
    const view = await mountWith(ContinueHero, {
      server: server({ status: 'offline', online: 0 }),
      scene: taiga,
      sceneBase: BASE,
      ping: null,
      ...played,
    });
    expect(view.find('.is-off').text()).toContain(ru.server.offline);
    expect(view.find('.status').text()).toContain(homeRowsRu.continue.offline);
  });

  it('shows the address for a server without launch support', async () => {
    const row = server({ launch: { kind: 'none' }, address: { host: 'mc.example', port: 25577 } });
    const view = await mountWith(ContinueHero, {
      server: row,
      scene: taiga,
      sceneBase: BASE,
      ping: 40,
      ...played,
    });
    expect(view.find('[data-launch="none"]').exists()).toBe(true);
    expect(view.find('.address').text()).toBe('mc.example:25577');
  });
});
