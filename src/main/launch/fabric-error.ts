import type { FabricError } from '@shared/telemetry';
import { toLaunchError } from './errors';

const META_HOSTS = new Set(['meta.fabricmc.net']);
const MAVEN_HOSTS = new Set(['maven.fabricmc.net']);

function hostError(url: string | null): FabricError {
  if (url === null) {
    return 'other';
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'other';
  }
  if (META_HOSTS.has(parsed.hostname) || parsed.pathname.startsWith('/mirror/fabric-meta/')) {
    return 'meta';
  }
  if (MAVEN_HOSTS.has(parsed.hostname) || parsed.pathname.startsWith('/mirror/fabric-maven/')) {
    return 'maven';
  }
  return 'other';
}

const LOADER_LIBRARY = /fabricmc|ow2[\\/]asm|llamalad7/;

export function fabricErrorOf(error: unknown): FabricError {
  if (error === null) {
    return 'files';
  }
  const launchError = toLaunchError(error);
  switch (launchError.code) {
    case 'loader-not-found':
      return 'meta';
    case 'loader-install-failed':
      return launchError.stage === 'manifest' ? 'meta' : 'maven';
    case 'checksum-mismatch':
      return LOADER_LIBRARY.test(launchError.file) ? 'maven' : 'other';
    case 'network':
      return hostError(launchError.url);
    default:
      return 'other';
  }
}
