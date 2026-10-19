import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import type { DeepLink } from '@shared/deep-link';
import type { LauncherContext } from './context';
import { useStores } from './context';

export const ARM_DELAY_MS = 700;
export const MAX_QUEUED_LINKS = 5;

export interface DeepLinkStore {
  pending: ShallowRef<DeepLink | null>;
  armed: Ref<boolean>;
  direct: ShallowRef<DeepLink | null>;
  takeDirect: () => DeepLink | null;
  dismiss: () => void;
  dispose: () => void;
}

function sameServer(a: DeepLink, b: DeepLink): boolean {
  return a.serverId === b.serverId;
}

export function createDeepLink(context: LauncherContext): DeepLinkStore {
  const pending = shallowRef<DeepLink | null>(null);
  const armed = ref(false);
  const direct = shallowRef<DeepLink | null>(null);
  const queue: DeepLink[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function show(link: DeepLink | null): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending.value = link;
    armed.value = false;
    if (link !== null) {
      timer = setTimeout(() => {
        timer = null;
        armed.value = true;
      }, ARM_DELAY_MS);
    }
  }

  // A request of the site starts at once and replaces the questions of the links before it.
  function startDirect(link: DeepLink): void {
    queue.length = 0;
    show(null);
    direct.value = link;
  }

  function enqueue(link: DeepLink): void {
    if (link.via === 'site') {
      startDirect(link);
      return;
    }
    const current = pending.value;
    if (current === null) {
      show(link);
      return;
    }
    if (sameServer(current, link) || queue.some((item) => sameServer(item, link))) {
      return;
    }
    queue.push(link);
    queue.splice(0, Math.max(0, queue.length - MAX_QUEUED_LINKS));
  }

  const unsubscribe = context.api.onDeepLink((delivery) => {
    context.api.ackDeepLink(delivery.id);
    enqueue(delivery.link);
  });

  return {
    pending,
    armed,
    direct,
    takeDirect: (): DeepLink | null => {
      const link = direct.value;
      direct.value = null;
      return link;
    },
    dismiss: (): void => {
      show(queue.shift() ?? null);
    },
    dispose: (): void => {
      unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
      }
    },
  };
}

export function useDeepLink(): DeepLinkStore {
  return useStores().deepLink;
}
