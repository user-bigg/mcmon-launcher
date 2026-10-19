import { computed, onMounted, ref, type ComputedRef } from 'vue';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { formatMemoryMb } from '../lib/units';
import { useLauncher } from './context';
import { useSettings } from './useSettings';

export interface ServerMemory {
  mb: ComputedRef<number | undefined>;
  text: ComputedRef<string>;
}

export function serverMemoryText(
  chosenMb: number | undefined,
  defaultMb: number | undefined,
): string {
  if (chosenMb !== undefined) {
    return formatMemoryMb(chosenMb);
  }
  return defaultMb === undefined
    ? ru.install.memoryAuto
    : fill(ru.serverPage.installMemoryAuto, { value: formatMemoryMb(defaultMb) });
}

// The default is the one the launch itself computes from this computer's memory, so the
// server page and the launch screen show the number that goes to -Xmx.
export function useServerMemory(): ServerMemory {
  const { api } = useLauncher();
  const settings = useSettings();
  const defaultMb = ref<number>();
  onMounted(async () => {
    const result = await api.system.memory().catch(() => undefined);
    if (result?.ok === true) {
      defaultMb.value = result.value.defaultGameMb;
    }
  });
  return {
    mb: computed(() => settings.memoryMb.value ?? defaultMb.value),
    text: computed(() => serverMemoryText(settings.memoryMb.value, defaultMb.value)),
  };
}
