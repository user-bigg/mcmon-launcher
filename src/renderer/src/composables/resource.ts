import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface Resource<T> {
  status: Ref<LoadStatus>;
  value: ShallowRef<T | null>;
  load: () => Promise<void>;
}

export function resource<T>(fetch: () => Promise<T>): Resource<T> {
  const status = ref<LoadStatus>('loading');
  const value = shallowRef<T | null>(null);

  async function load(): Promise<void> {
    status.value = 'loading';
    try {
      value.value = await fetch();
      status.value = 'ready';
    } catch {
      status.value = 'error';
    }
  }

  return { status, value, load };
}
