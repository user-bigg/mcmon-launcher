import { onBeforeUnmount, onMounted } from 'vue';
import { whenVisible } from '../lib/when-visible';

export function useVisibleInterval(run: () => void, ms: number): void {
  const gate = whenVisible(run);
  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    timer = setInterval(gate.tick, ms);
  });
  onBeforeUnmount(() => {
    clearInterval(timer);
    gate.dispose();
  });
}
