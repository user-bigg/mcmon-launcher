const REGISTRY_ARCH = /^[A-Za-z0-9_]{1,16}$/;

export interface ArchMemoryOptions {
  read: () => Promise<string | null>;
  load: () => Promise<unknown>;
  save: (data: { schemaVersion: 1; registryArch: string }) => Promise<void>;
  log: (message: string) => void;
}

export function storedRegistryArch(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const { schemaVersion, registryArch } = data as {
    schemaVersion?: unknown;
    registryArch?: unknown;
  };
  return schemaVersion === 1 && typeof registryArch === 'string' && REGISTRY_ARCH.test(registryArch)
    ? registryArch
    : null;
}

// The processor architecture of a Windows installation does not change, while reg.exe can take
// seconds right after an install. The value read once is kept on disk: a launch gets it at once,
// and a reading that came too late for one launch still serves the next one.
export function rememberRegistryArch(options: ArchMemoryOptions): () => Promise<string | null> {
  let remembered: Promise<string | null> | null = null;
  let saved: string | null = null;

  const load = (): Promise<string | null> => {
    remembered ??= options.load().then(storedRegistryArch, () => null);
    return remembered;
  };

  const refresh = async (): Promise<string | null> => {
    const fresh = await options.read().catch(() => null);
    if (fresh !== null && REGISTRY_ARCH.test(fresh) && fresh !== saved) {
      remembered = Promise.resolve(fresh);
      try {
        await options.save({ schemaVersion: 1, registryArch: fresh });
        saved = fresh;
      } catch {
        options.log('device: native_arch not saved');
      }
    }
    return fresh;
  };

  return async () => {
    const known = await load();
    if (known === null) {
      return refresh();
    }
    saved ??= known;
    void refresh();
    return known;
  };
}
