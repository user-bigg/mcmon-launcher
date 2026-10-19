import { useRouter } from 'vue-router';
import type { ServerRow } from '@shared/catalog';
import { isValidNick, type LaunchTarget } from '@shared/launch';
import type { PlaySource } from '@shared/telemetry';
import { pickPlayAccount, type PlayAccess } from '../lib/play-account';
import { serverModpack, serverSkinsFlag } from '../lib/skins';
import { licenseOnly } from '../lib/tags';
import { useAccounts } from './useAccounts';
import { jobFor, launchRequest, serverTarget, useLaunch } from './useLaunch';
import { useSettings } from './useSettings';
import { newLaunchId, useTrack } from './useTrack';

export interface PlayOptions {
  instanceMemory?: boolean;
  memoryMb?: number;
  joinServer?: boolean;
  source?: PlaySource;
  launchId?: string;
  serverSkins?: boolean | undefined;
  serverModpack?: boolean | undefined;
}

export interface Play {
  playServer: (server: ServerRow, options?: PlayOptions) => Promise<boolean>;
}

export function launchRoute(target: LaunchTarget): string {
  return `/launch/${String(target.serverId)}`;
}

export function usePlay(): Play {
  const launch = useLaunch();
  const accounts = useAccounts();
  const settings = useSettings();
  const router = useRouter();
  const track = useTrack();

  // Only a click on 'Play' that the launcher accepted is an action; a retry from the launch or
  // crash screen comes without a source and stays silent.
  function clicked(target: LaunchTarget, options: PlayOptions): string | null {
    if (options.source === undefined) {
      return null;
    }
    const launchId = options.launchId ?? newLaunchId();
    track({
      type: 'action',
      name: 'play',
      server_id: target.serverId,
      source: options.source,
      launch_id: launchId,
    });
    return launchId;
  }

  function begin(
    target: LaunchTarget,
    name: string,
    access: PlayAccess,
    options: PlayOptions,
  ): Promise<boolean> | 'busy' | 'pick-nick' {
    if (launch.busy.value) {
      return 'busy';
    }
    const job = jobFor(target, name);
    const picked = pickPlayAccount(access, {
      nick: accounts.playNick.value,
      licenseId: accounts.license.value?.id ?? null,
    });
    if (!picked.ok && picked.missing === 'nick' && accounts.pinned.value !== null) {
      return 'pick-nick';
    }
    if (!picked.ok) {
      launch.reject(job, {
        code: 'invalid-request',
        field: picked.missing === 'license' ? 'license' : 'account',
      });
      return Promise.resolve(false);
    }
    const { account } = picked;
    if (account.kind === 'nick' && !isValidNick(account.nick)) {
      launch.reject(job, { code: 'invalid-request', field: 'nick' });
      return Promise.resolve(false);
    }
    const request = launchRequest(target, {
      account,
      memoryMb:
        options.memoryMb ?? (options.instanceMemory === true ? undefined : settings.memoryMb.value),
      joinServer: options.joinServer ?? settings.state.joinServer,
      serverSkins: options.serverSkins,
      serverModpack: options.serverModpack,
    });
    const launchId = clicked(target, options);
    const named = { ...request, name };
    return launch.start(job, launchId === null ? named : { ...named, launchId });
  }

  async function play(
    target: LaunchTarget,
    name: string,
    access: PlayAccess,
    options: PlayOptions,
  ): Promise<boolean> {
    const started = begin(target, name, access, options);
    if (started === 'pick-nick') {
      await router.push('/accounts');
    }
    if (typeof started === 'string') {
      return false;
    }
    await router.push(launchRoute(target));
    return started;
  }

  return {
    playServer: (server, options = {}): Promise<boolean> => {
      const target = serverTarget(server);
      const access = licenseOnly(server.access) ? 'license' : 'nick';
      return target === null
        ? Promise.resolve(false)
        : play(target, server.name, access, {
            ...options,
            serverSkins: serverSkinsFlag(server),
            serverModpack: serverModpack(server) || undefined,
          });
    },
  };
}
