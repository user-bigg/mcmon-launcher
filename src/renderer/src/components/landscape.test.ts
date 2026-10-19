// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerAnimation, Scene, SceneLayer } from '@shared/scenes';
import { CONTEXT_KEY } from '../composables/context';
import {
  BUILTIN_SCENE,
  builtinLayerUrl,
  builtinSinkRows,
  STAND_IN_AFTER_MS,
  STAND_IN_HOLD_MS,
} from '../lib/builtin-scene';
import PixelLandscape from './PixelLandscape.vue';

const BASE = 'https://cdn.example/landscapes';

function anim(patch: Partial<LayerAnimation> & Pick<LayerAnimation, 'type'>): LayerAnimation {
  return { dur: 3, delay: 0, amp: 2, dir: 1, still: 1, ...patch };
}

function pulseScene(day: SceneLayer[]): Scene {
  return {
    key: 'pulse21',
    name: 'Деревня',
    pack: 'pulse',
    purpose: 'pulse',
    focus: 0.5,
    skies: { day: '#0a1232', sunset: '#0a1232', night: '#0a1232' },
    layers: { day, sunset: day, night: day },
  };
}

const layers: SceneLayer[] = [
  { name: 'sky', depth: 0 },
  { name: 'snow', depth: 0.2, anim: anim({ type: 'drift', dur: 60, dir: -1 }) },
  { name: 'rain', depth: 0.6, anim: anim({ type: 'fall', dur: 0.8, delay: 0.4 }) },
  { name: 'lamp', depth: 0.45, anim: anim({ type: 'pulse', dur: 3, delay: 1.5 }) },
  { name: 'stars', depth: 0.1, anim: anim({ type: 'blip', dur: 7, still: 0 }) },
  { name: 'odd', depth: 0.3, anim: anim({ type: 'still', dur: 0, still: 0.4 }) },
  { name: 'ground', depth: 1 },
];

let wrapper: VueWrapper | undefined;

async function mountScene(props: Record<string, unknown> = {}): Promise<VueWrapper> {
  wrapper = mount(PixelLandscape, {
    props: { scene: pulseScene(layers), base: BASE, time: 'day', height: 64, ...props },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

function picture(view: VueWrapper, layer: string): HTMLElement {
  const node = view.find(`[data-layer="${layer}"]`).element.firstElementChild;
  if (!(node instanceof HTMLElement)) {
    throw new Error(`layer ${layer} missing`);
  }
  return node;
}

function reducedMotion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  reducedMotion(false);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('layer animations', () => {
  it('a layer with anim gets keyframes and dur, delay and step variables', async () => {
    const view = await mountScene();
    const lamp = picture(view, 'lamp');
    expect(lamp.classList).toContain('landscape-anim-pulse');
    expect(lamp.style.getPropertyValue('--lx-anim-dur')).toBe('3s');
    expect(lamp.style.getPropertyValue('--lx-anim-delay')).toBe('1.5s');
    expect(lamp.style.opacity).toBe('1');
    const rain = picture(view, 'rain');
    expect(rain.classList).toContain('landscape-anim-fall');
    expect(rain.style.getPropertyValue('--lx-anim-timing')).toBe('steps(88)');
    expect(rain.style.getPropertyValue('--lx-anim-delay')).toBe('0.4s');
  });

  it('drift — a strip of three copies along X, fall — of two along Y', async () => {
    const view = await mountScene();
    const snow = picture(view, 'snow');
    expect(snow.classList).toContain('landscape-strip');
    expect(snow.classList).toContain('landscape-anim-drift-back');
    expect(snow.style.getPropertyValue('--lx-anim-timing')).toBe('steps(384)');
    expect(snow.querySelectorAll('img')).toHaveLength(3);
    expect(view.find('[data-layer="snow"]').attributes('data-drifts')).toBe('');
    const rain = picture(view, 'rain');
    expect(rain.classList).toContain('landscape-strip-y');
    expect(rain.querySelectorAll('img')).toHaveLength(2);
    expect(view.find('[data-layer="rain"]').attributes('data-drifts')).toBeUndefined();
  });

  it('a layer without anim and with an unknown type is not animated', async () => {
    const view = await mountScene();
    expect(picture(view, 'ground').className).toBe('landscape-image');
    const odd = picture(view, 'odd');
    expect(odd.className).toBe('landscape-image');
    expect(odd.style.opacity).toBe('0.4');
  });

  it('thumbnail is still: a layer with still 0 is hidden, no strips', async () => {
    const view = await mountScene({ still: true });
    expect(view.findAll('.landscape-anim')).toHaveLength(0);
    expect(view.findAll('[data-drifts]')).toHaveLength(0);
    expect(view.findAll('.landscape-strip-y')).toHaveLength(0);
    expect(picture(view, 'stars').style.opacity).toBe('0');
    expect(picture(view, 'lamp').style.opacity).toBe('1');
  });

  it('with prefers-reduced-motion there are no animations, a still frame', async () => {
    reducedMotion(true);
    const view = await mountScene();
    expect(view.findAll('.landscape-anim')).toHaveLength(0);
    expect(picture(view, 'stars').style.opacity).toBe('0');
  });

  it('animations are paused in a hidden window', async () => {
    const view = await mountScene();
    const root = view.find('.landscape');
    expect(root.classes()).toContain('is-running');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(root.classes()).not.toContain('is-running');
    expect(view.findAll('.landscape-anim').length).toBeGreaterThan(0);
  });

  it('animations are paused off-screen', async () => {
    let report: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();

        constructor(callback: IntersectionObserverCallback) {
          report = callback;
        }
      },
    );
    const view = await mountScene();
    report?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    await flushPromises();
    expect(view.find('.landscape').classes()).not.toContain('is-running');
  });
});

describe('layer loading', () => {
  it('the scene reveals only once all layers have loaded', async () => {
    const view = await mountScene();
    const root = view.find<HTMLElement>('.landscape');
    const images = view.findAll('img');
    expect(root.classes()).not.toContain('is-ready');
    for (const image of images.slice(0, -1)) {
      await image.trigger('load');
    }
    expect(root.classes()).not.toContain('is-ready');
    await images.at(-1)?.trigger('load');
    expect(root.classes()).toContain('is-ready');
  });

  it('a layer that failed to load is not a drawn one: the built-in scene comes at once and stays', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mountScene();
    const images = view.findAll('img');
    for (const image of images.slice(0, -1)) {
      await image.trigger('load');
    }
    await images.at(-1)?.trigger('error');
    const root = view.find<HTMLElement>('.landscape');
    expect(root.classes()).not.toContain('is-ready');
    expect(root.classes()).toContain('is-stand-in');
    expect(view.findAll('[data-layer^="builtin-"]')).not.toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(root.classes()).toContain('is-stand-in');
  });

  it('where nothing stands in, a failed layer does not hold the rest back', async () => {
    const view = await mountScene({ standIn: false });
    for (const image of view.findAll('img')) {
      await image.trigger('error');
    }
    expect(view.find('.landscape').classes()).toContain('is-ready');
  });
});

describe('landscape clock', () => {
  it("'auto' time starts the clock after mounting and changes with the hour", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = new Date('2026-10-03T20:30:00Z');
    wrapper = mount(PixelLandscape, {
      props: { scene: pulseScene(layers), base: BASE, time: 'day', height: 64 },
      attachTo: document.body,
      global: { provide: { [CONTEXT_KEY as symbol]: { now: (): Date => now } } },
    });
    await flushPromises();
    const root = (): string | undefined => wrapper?.find('[data-scene]').attributes('data-scene');
    expect(root()).toBe('pulse21-day');
    await wrapper.setProps({ time: 'auto' });
    expect(root()).toBe('pulse21-night');
    now = new Date('2026-10-04T09:00:00Z');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(root()).toBe('pulse21-day');
  });
});

describe('the built-in scene standing in', () => {
  function builtin(view: VueWrapper): string[] {
    return view
      .findAll('[data-layer^="builtin-"]')
      .map((layer) => layer.attributes('data-layer') ?? '');
  }

  async function loadOwn(view: VueWrapper): Promise<void> {
    for (const image of view.findAll('.is-pending img')) {
      await image.trigger('load');
    }
  }

  it('is drawn when the layers of the scene are not there in time, with the same parallax', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mountScene();
    expect(builtin(view)).toEqual([]);
    await vi.advanceTimersByTimeAsync(STAND_IN_AFTER_MS);
    expect(builtin(view)).toEqual(BUILTIN_SCENE.layers.day.map((layer) => `builtin-${layer.name}`));
    const root = view.find<HTMLElement>('.landscape');
    expect(root.classes()).toContain('is-stand-in');
    expect(root.classes()).not.toContain('is-ready');
    expect(root.element.style.getPropertyValue('--lx-scene-sky')).toBe(BUILTIN_SCENE.skies.day);
    expect(view.find('[data-layer="builtin-ground"]').attributes('data-depth')).toBe('1');
    expect(view.find('[data-layer="builtin-ground"]').classes()).not.toContain('is-pending');
    expect(view.find('[data-layer="ground"]').classes()).toContain('is-pending');
    expect(picture(view, 'builtin-clouds').classList).toContain('landscape-anim-drift');
  });

  it('gives way to the scene when it comes: the scene fades in over it, then it is removed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mountScene();
    await vi.advanceTimersByTimeAsync(STAND_IN_AFTER_MS);
    await loadOwn(view);
    const root = view.find<HTMLElement>('.landscape');
    expect(root.classes()).toContain('is-ready');
    expect(view.findAll('.is-pending')).toHaveLength(0);
    expect(builtin(view)).not.toEqual([]);
    expect(root.element.style.getPropertyValue('--lx-scene-sky')).toBe('#0a1232');
    await vi.advanceTimersByTimeAsync(STAND_IN_HOLD_MS);
    expect(builtin(view)).toEqual([]);
    expect(root.classes()).not.toContain('is-stand-in');
  });

  it('is never drawn for a scene whose layers come in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mountScene();
    const seen = [builtin(view).length];
    await vi.advanceTimersByTimeAsync(STAND_IN_AFTER_MS - 1);
    seen.push(builtin(view).length);
    await loadOwn(view);
    seen.push(builtin(view).length);
    await vi.advanceTimersByTimeAsync(60_000);
    seen.push(builtin(view).length);
    expect(seen).toEqual([0, 0, 0, 0]);
  });

  it('keeps standing while a scene it replaced is still loading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await mountScene({ scene: BUILTIN_SCENE, base: builtinLayerUrl });
    expect(builtin(view)).toEqual([]);
    await view.setProps({ scene: pulseScene(layers), base: BASE });
    await flushPromises();
    expect(builtin(view)).not.toEqual([]);
    expect(view.find('.landscape').classes()).toContain('is-stand-in');
  });

  it('stands still with reduced motion and is not used where it is switched off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    reducedMotion(true);
    const view = await mountScene();
    await vi.advanceTimersByTimeAsync(STAND_IN_AFTER_MS);
    expect(builtin(view)).not.toEqual([]);
    expect(view.findAll('.landscape-anim')).toHaveLength(0);
    expect(view.find('.landscape').classes()).not.toContain('is-moving');
    view.unmount();
    const plain = await mountScene({ standIn: false });
    await vi.advanceTimersByTimeAsync(STAND_IN_AFTER_MS * 2);
    expect(builtin(plain)).toEqual([]);
  });
});

describe('the frame of the built-in scene', () => {
  it.each([
    [165, 0],
    [140, 5],
    [64, 0],
    [56, 0],
    [52, 3],
    [42, 6],
  ])('a frame of %i rows lowers the scene by %i', (rows, sink) => {
    expect(builtinSinkRows(rows)).toBe(sink);
  });

  it('lowers only its own layers, by whole pixels of the scene', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(104);
    const view = await mountScene({ scene: BUILTIN_SCENE, base: builtinLayerUrl, height: 52 });
    const root = view.find<HTMLElement>('.landscape');
    expect(root.element.style.getPropertyValue('--lx-builtin-sink')).toBe('6px');
    expect(view.findAll('.landscape-layer.is-builtin')).toHaveLength(
      BUILTIN_SCENE.layers.day.length,
    );
    await view.setProps({ scene: pulseScene(layers), base: BASE });
    expect(view.find('[data-layer="ground"]').classes()).not.toContain('is-builtin');
  });
});
