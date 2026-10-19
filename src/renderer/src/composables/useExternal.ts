import { isHttpsUrl } from '@shared/links';
import { useLauncher } from './context';

export interface External {
  open: (url: string) => Promise<boolean>;
}

export function useExternal(): External {
  const { api } = useLauncher();
  return {
    open: async (url): Promise<boolean> => {
      if (!isHttpsUrl(url)) {
        return false;
      }
      return api.openExternal(url);
    },
  };
}
