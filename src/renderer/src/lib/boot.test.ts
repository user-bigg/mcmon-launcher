// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, ref, type Component, type VNode } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { ru } from '@shared/i18n/ru';
import ScreenBoundary from '../components/ScreenBoundary.vue';
import { launcherPlugin } from '../composables/stores';
import { contextOf, stubLauncher } from '../testing';
import { breaksRendering, mountApp } from './boot';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function rootElement(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

describe('mountApp', () => {
  it('reports a mounted application', () => {
    const report = vi.fn();
    mountApp(createApp({ render: () => h('main', 'ok') }), rootElement(), report);
    expect(report).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('reports a root component that throws while starting', () => {
    const report = vi.fn();
    const app = createApp({
      setup: () => {
        throw new Error('setup');
      },
      render: () => h('main'),
    });
    mountApp(app, rootElement(), report);
    expect(report).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('reports a root that stayed empty', () => {
    const report = vi.fn();
    const app = createApp({ render: () => h('main') });
    app.mount = (): never => {
      throw new Error('mount');
    };
    mountApp(app, rootElement(), report);
    expect(report).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('an error after the start is logged and does not take the window down', async () => {
    const report = vi.fn();
    const broken = ref(false);
    const app = createApp({
      render: () =>
        h('button', {
          onClick: () => {
            broken.value = true;
            throw new Error('click');
          },
        }),
    });
    const root = rootElement();
    mountApp(app, root, report);
    root.querySelector('button')?.click();
    await flushPromises();
    expect(report).toHaveBeenCalledExactlyOnceWith(true);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('breaksRendering', () => {
  it.each(['setup function', 'render function', 'mounted hook', 'beforeUpdate hook'])(
    '%s breaks the screen',
    (info) => {
      expect(breaksRendering(info)).toBe(true);
    },
  );

  it.each(['native event handler', 'component event handler', 'watcher callback'])(
    '%s leaves the screen drawn',
    (info) => {
      expect(breaksRendering(info)).toBe(false);
    },
  );

  it('reads the code of a build the same way', () => {
    expect(breaksRendering('https://vuejs.org/error-reference/#runtime-1')).toBe(true);
    expect(breaksRendering('https://vuejs.org/error-reference/#runtime-0')).toBe(true);
    expect(breaksRendering('https://vuejs.org/error-reference/#runtime-m')).toBe(true);
    expect(breaksRendering('https://vuejs.org/error-reference/#runtime-5')).toBe(false);
    expect(breaksRendering('https://vuejs.org/error-reference/#runtime-3')).toBe(false);
    expect(breaksRendering('https://vuejs.org/error-reference/#runtime-15')).toBe(true);
  });
});

describe('ScreenBoundary', () => {
  const explode = ref(true);
  const Broken = defineComponent({
    setup() {
      return (): VNode => {
        if (explode.value) {
          throw new Error('render');
        }
        return h('p', { class: 'screen' }, 'fixed');
      };
    },
  });
  const Clicky = defineComponent({
    setup() {
      const boom = (): void => {
        throw new Error('click');
      };
      return (): VNode => h('button', { class: 'screen', onClick: boom }, 'press');
    },
  });
  const Fine = defineComponent({ render: () => h('p', { class: 'screen' }, 'fine') });

  function routerOf(routes: Record<string, Component>): Router {
    return createRouter({
      history: createMemoryHistory(),
      routes: Object.entries(routes).map(([path, component]) => ({ path, component })),
    });
  }

  async function open(router: Router, path: string): Promise<ReturnType<typeof mount>> {
    const Shell = defineComponent({
      render: () => [
        h('header', { class: 'shell' }, 'shell'),
        h('main', { tabindex: '-1' }, [h(ScreenBoundary, null, { default: () => h(RouterView) })]),
      ],
    });
    await router.push(path);
    const wrapper = mount(Shell, {
      global: { plugins: [launcherPlugin(contextOf(stubLauncher())), router] },
      attachTo: rootElement(),
    });
    await flushPromises();
    return wrapper;
  }

  beforeEach(() => {
    explode.value = true;
  });

  it('a screen that throws while drawing leaves the shell and a calm state in its place', async () => {
    const wrapper = await open(routerOf({ '/': Fine, '/broken': Broken }), '/broken');
    expect(wrapper.find('.shell').exists()).toBe(true);
    const state = wrapper.find('[data-screen-error]');
    expect(state.text()).toContain(ru.screenError.title);
    expect(state.text()).toContain(ru.screenError.text);
    expect(document.activeElement?.tagName).toBe('MAIN');
    expect(state.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('.screen').exists()).toBe(false);
    wrapper.unmount();
  });

  it('names the section that did not open', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/settings', component: Broken, meta: { section: 'settings' } }],
    });
    const wrapper = await open(router, '/settings');
    const state = wrapper.find('[data-screen-error]');
    expect(state.find('h2').text()).toBe(ru.screenError.sections.settings);
    expect(state.text()).not.toContain(ru.screenError.title);
    wrapper.unmount();
  });

  it('opens the screen again on request', async () => {
    const wrapper = await open(routerOf({ '/': Fine, '/broken': Broken }), '/broken');
    explode.value = false;
    const again = wrapper.find<HTMLButtonElement>('[data-screen-error] button');
    again.element.focus();
    await again.trigger('click');
    await flushPromises();
    expect(document.activeElement?.tagName).toBe('MAIN');
    expect(wrapper.find('[data-screen-error]').exists()).toBe(false);
    expect(wrapper.find('.screen').text()).toBe('fixed');
    wrapper.unmount();
  });

  it('another screen opens normally after a broken one', async () => {
    const router = routerOf({ '/': Fine, '/broken': Broken });
    const wrapper = await open(router, '/broken');
    expect(wrapper.find('[data-screen-error] a').attributes('href')).toBe('/');
    await router.push('/');
    await flushPromises();
    expect(wrapper.find('[data-screen-error]').exists()).toBe(false);
    expect(wrapper.find('.screen').text()).toBe('fine');
    wrapper.unmount();
  });

  it('a handler that throws does not replace a screen that is drawn', async () => {
    const wrapper = await open(routerOf({ '/': Clicky }), '/');
    await wrapper.find('button.screen').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-screen-error]').exists()).toBe(false);
    expect(wrapper.find('button.screen').exists()).toBe(true);
    wrapper.unmount();
  });
});
