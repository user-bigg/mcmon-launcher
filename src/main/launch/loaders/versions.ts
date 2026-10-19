import type { InstanceRuntime } from '@shared/instance';

export function loaderVersionId(runtime: InstanceRuntime): string {
  const { minecraft, loader, loaderVersion } = runtime;
  return loader === 'vanilla' || loaderVersion === undefined
    ? minecraft
    : `fabric-loader-${loaderVersion}-${minecraft}`;
}
