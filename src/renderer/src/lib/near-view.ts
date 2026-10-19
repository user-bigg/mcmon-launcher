export type Nearness = 'far' | 'near' | 'visible';

export const NEAR_MARGIN_PX = 240;

type Listener = (nearness: Nearness) => void;

interface Place {
  listener: Listener;
  near: boolean;
  visible: boolean;
}

interface Watch {
  around: IntersectionObserver;
  inside: IntersectionObserver;
  places: Map<Element, Place>;
}

const watches = new Map<Element | null, Watch>();

function scrollParent(element: Element): Element | null {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return parent;
    }
  }
  return null;
}

function nearnessOf(place: Place): Nearness {
  if (place.visible) {
    return 'visible';
  }
  return place.near ? 'near' : 'far';
}

// Two observers, because one with a margin reports only at the edge of the margin: a tile that
// came from the margin onto the screen would stay 'near', and one that left would stay 'visible'.
function watchOf(root: Element | null): Watch {
  const known = watches.get(root);
  if (known !== undefined) {
    return known;
  }
  const places = new Map<Element, Place>();
  const report =
    (field: 'near' | 'visible'): IntersectionObserverCallback =>
    (entries) => {
      for (const entry of entries) {
        const place = places.get(entry.target);
        if (place !== undefined) {
          place[field] = entry.isIntersecting;
          place.listener(nearnessOf(place));
        }
      }
    };
  const watch: Watch = {
    around: new IntersectionObserver(report('near'), {
      root,
      rootMargin: `${String(NEAR_MARGIN_PX)}px 0px`,
    }),
    inside: new IntersectionObserver(report('visible'), { root }),
    places,
  };
  watches.set(root, watch);
  return watch;
}

// Where there is no observer everything counts as on screen: the picture is simply loaded.
export function watchNear(element: Element, listener: Listener): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    listener('visible');
    return (): void => undefined;
  }
  const root = scrollParent(element);
  const watch = watchOf(root);
  watch.places.set(element, { listener, near: false, visible: false });
  watch.around.observe(element);
  watch.inside.observe(element);
  return (): void => {
    watch.around.unobserve(element);
    watch.inside.unobserve(element);
    watch.places.delete(element);
    if (watch.places.size === 0) {
      watch.around.disconnect();
      watch.inside.disconnect();
      watches.delete(root);
    }
  };
}
