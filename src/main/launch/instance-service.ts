import type {
  InstanceLaunchOptions,
  InstanceService,
  ServerInstanceInfo,
  SharedFiles,
} from '@shared/instance';
import type { LaunchResult } from '@shared/launch';
import { failure, toLaunchError } from './errors';
import type { InstanceStore } from './instances';
import type { LaunchOptionsStore } from './launch-options';

export interface InstanceServiceOptions {
  store: InstanceStore;
  launchOptions: LaunchOptionsStore;
  activeInstance: () => string | null;
  checkingCrash: () => boolean;
}

async function settle<T>(run: () => Promise<T>): Promise<LaunchResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: toLaunchError(error) };
  }
}

export class GameInstanceService implements InstanceService {
  constructor(private readonly options: InstanceServiceOptions) {}

  list(): Promise<LaunchResult<ServerInstanceInfo[]>> {
    return settle(() => this.options.store.listServers());
  }

  sharedFiles(): Promise<LaunchResult<SharedFiles>> {
    return settle(async () => ({ bytes: await this.options.store.sharedSize() }));
  }

  // The crash check of a game that just ended still reads the folder's logs and reports.
  remove(folderId: string): Promise<LaunchResult<null>> {
    return settle(async () => {
      if (this.isBusy(folderId) || this.options.checkingCrash()) {
        throw failure({ code: 'server-in-use' });
      }
      await this.options.store.removeServer(folderId);
      await this.options.launchOptions.forget(folderId);
      return null;
    });
  }

  launchOptions(folderId: string): Promise<LaunchResult<InstanceLaunchOptions>> {
    return settle(() => this.options.launchOptions.get(folderId));
  }

  setWithoutMods(folderId: string, off: boolean): Promise<LaunchResult<InstanceLaunchOptions>> {
    return settle(() => {
      this.ensureIdle(folderId);
      return this.options.launchOptions.setWithoutMods(folderId, off);
    });
  }

  private isBusy(folderId: string): boolean {
    return this.options.activeInstance() === folderId || this.options.store.isInUse(folderId);
  }

  private ensureIdle(folderId: string): void {
    if (this.isBusy(folderId)) {
      throw failure({ code: 'busy' });
    }
  }
}
