import { onScopeDispose } from 'vue';
import type { SiteChange } from '@shared/site';
import { useLauncher } from './context';

export function useSiteChange(handler: (change: SiteChange) => void): void {
  const launcher = useLauncher();
  if (!launcher.demo) {
    onScopeDispose(launcher.api.site.onChanged(handler));
  }
}
