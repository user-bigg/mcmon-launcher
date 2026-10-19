// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@shared/i18n/ru';
import { LoadQueue, TILE_LOADS_AT_ONCE } from '../lib/load-queue';

const asked: string[] = [];
const releases = new Map<string, () => void>();
const ready = new Set<string>();
const outcomes = new Map<string, null>();

vi.mock('../lib/skin-draw', () => ({
  drawFigure: vi.fn(),
  drawCape: vi.fn(),
  loadedTexture: (url: string): object | null => (ready.has(url) ? {} : null),
  loadTexture: (url: string): Promise<object | null> => {
    asked.push(url);
    return new Promise((resolve) => {
      releases.set(url, () => {
        resolve(outcomes.has(url) ? null : {});
      });
    });
  },
}));

const { default: SkinCard } = await import('./SkinCard.vue');

type Report = (entries: IntersectionObserverEntry[]) => void;
type Place = 'far' | 'near' | 'visible';

const reports: { around: Report; inside: Report } = {
  around: () => undefined,
  inside: () => undefined,
};

function entry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  return { target, isIntersecting } as unknown as IntersectionObserverEntry;
}

function tile(url: string): VueWrapper {
  return mount(SkinCard, {
    props: { kind: 'skin', title: url, url, worn: false, tried: false, shown: false, fresh: false },
    attachTo: document.body,
  });
}

function place(card: VueWrapper, where: Place): void {
  const target = card.element as Element;
  reports.around([entry(target, where !== 'far')]);
  reports.inside([entry(target, where === 'visible')]);
}

function fail(url: string): Promise<void> {
  outcomes.set(url, null);
  return finish(url);
}

async function finish(url: string): Promise<void> {
  releases.get(url)?.();
  await flushPromises();
}

beforeEach(() => {
  asked.length = 0;
  releases.clear();
  ready.clear();
  outcomes.clear();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: Report, options: IntersectionObserverInit) {
        reports[options.rootMargin === undefined ? 'inside' : 'around'] = callback;
      }
      observe(): void {
        return undefined;
      }
      unobserve(): void {
        return undefined;
      }
      disconnect(): void {
        return undefined;
      }
    },
  );
});

afterEach(async () => {
  document.body.replaceChildren();
  for (let round = 0; round < 4; round += 1) {
    for (const release of releases.values()) {
      release();
    }
    await flushPromises();
  }
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('SkinCard: the picture comes when the tile is near the screen', () => {
  it('a tile off the screen holds its skeleton and asks for nothing', async () => {
    const card = tile('far.png');
    place(card, 'far');
    await flushPromises();
    expect(asked).toEqual([]);
    expect(card.find('.lx-skel').exists()).toBe(true);
    expect(card.attributes('data-card-painted')).toBe('false');
  });

  it('asks once the tile comes near and swaps the skeleton for the picture', async () => {
    const card = tile('skin.png');
    place(card, 'far');
    place(card, 'near');
    expect(asked).toEqual(['skin.png']);
    await finish('skin.png');
    expect(card.find('.lx-skel').exists()).toBe(false);
    expect(card.attributes('data-card-painted')).toBe('true');
    expect(card.find('canvas').classes()).toContain('is-in');
  });

  it('a tile that left before its turn is not loaded', async () => {
    const busy = Array.from({ length: TILE_LOADS_AT_ONCE }, (_, index) => {
      const card = tile(`busy-${String(index)}.png`);
      place(card, 'visible');
      return card;
    });
    const late = tile('late.png');
    place(late, 'near');
    place(late, 'far');
    await finish('busy-0.png');
    expect(busy).toHaveLength(TILE_LOADS_AT_ONCE);
    expect(asked).not.toContain('late.png');
  });

  it('tiles on the screen are loaded before the ones only near it', async () => {
    const first = Array.from({ length: TILE_LOADS_AT_ONCE }, (_, index) => {
      const card = tile(`first-${String(index)}.png`);
      place(card, 'visible');
      return card;
    });
    place(tile('below-1.png'), 'near');
    place(tile('below-2.png'), 'near');
    place(tile('on-screen.png'), 'visible');
    expect(asked).toHaveLength(first.length);
    await finish('first-0.png');
    await finish('first-1.png');
    expect(asked.slice(first.length)).toEqual(['on-screen.png', 'below-1.png']);
  });

  it('a tile that came from the margin onto the screen goes ahead of the ones still below', async () => {
    Array.from({ length: TILE_LOADS_AT_ONCE }, (_, index) => {
      const card = tile(`first-${String(index)}.png`);
      place(card, 'visible');
      return card;
    });
    place(tile('below.png'), 'near');
    const scrolled = tile('scrolled-in.png');
    place(scrolled, 'near');
    place(scrolled, 'visible');
    await finish('first-0.png');
    expect(asked.at(-1)).toBe('scrolled-in.png');
  });

  it('a picture that failed frees its place, shows a quiet mark and is asked again on return', async () => {
    const card = tile('broken.png');
    place(card, 'visible');
    await fail('broken.png');
    expect(card.attributes('data-card-failed')).toBe('true');
    expect(card.find('.lx-skel').exists()).toBe(false);
    expect(card.find('.is-failed').exists()).toBe(true);
    expect(card.attributes('aria-label')).toBe(`broken.png, ${ru.skins.notLoaded}`);
    const next = tile('next.png');
    place(next, 'visible');
    expect(asked).toEqual(['broken.png', 'next.png']);
    place(card, 'far');
    outcomes.clear();
    place(card, 'visible');
    expect(asked).toEqual(['broken.png', 'next.png', 'broken.png']);
    await finish('broken.png');
    expect(card.attributes('data-card-painted')).toBe('true');
    expect(card.attributes('data-card-failed')).toBe('false');
  });

  it('a tile whose picture is still on its way is not asked for twice', async () => {
    const card = tile('slow.png');
    place(card, 'visible');
    place(card, 'far');
    place(card, 'visible');
    expect(asked).toEqual(['slow.png']);
    await finish('slow.png');
    expect(card.attributes('data-card-painted')).toBe('true');
  });

  it('the new mark waits for the picture', async () => {
    const card = mount(SkinCard, {
      props: {
        kind: 'skin',
        title: 'new',
        url: 'new.png',
        worn: false,
        tried: false,
        shown: false,
        fresh: true,
      },
      attachTo: document.body,
    });
    place(card, 'visible');
    expect(card.find('[data-card-new]').classes()).toContain('is-waiting');
    await finish('new.png');
    expect(card.find('[data-card-new]').classes()).not.toContain('is-waiting');
  });

  it('a picture already loaded in this window is drawn at once, with no skeleton', async () => {
    ready.add('known.png');
    const card = tile('known.png');
    await card.vm.$nextTick();
    expect(card.find('.lx-skel').exists()).toBe(false);
    expect(card.find('canvas').classes()).not.toContain('is-eased');
    expect(asked).toEqual([]);
  });
});

describe('LoadQueue', () => {
  it('runs no more than its limit at once', async () => {
    const queue = new LoadQueue(2);
    const started: number[] = [];
    const done: (() => void)[] = [];
    for (let index = 0; index < 5; index += 1) {
      queue.add({
        urgent: () => false,
        run: () => {
          started.push(index);
          return new Promise<void>((resolve) => done.push(resolve));
        },
      });
    }
    expect(started).toEqual([0, 1]);
    done[0]?.();
    await flushPromises();
    expect(started).toEqual([0, 1, 2]);
  });

  it('a failed load frees its place', async () => {
    const queue = new LoadQueue(1);
    const started: string[] = [];
    queue.add({ urgent: () => false, run: () => Promise.reject(new Error('broken')) });
    queue.add({
      urgent: () => false,
      run: () => {
        started.push('next');
        return Promise.resolve();
      },
    });
    await flushPromises();
    expect(started).toEqual(['next']);
  });
});
