import { catalogServerRuntime, type InstanceRuntime, type JavaMajor } from '@shared/instance';
import { instanceIdOf, type LaunchTarget } from '@shared/launch';
import type { JavaRequirement } from './java';

export interface LaunchProfile {
  folderId: string;
  runtime: InstanceRuntime;
  memoryMb: number | null;
  javaOverride: JavaMajor | null;
}

const JAVA_COMPONENTS: Record<JavaMajor, string> = {
  8: 'jre-legacy',
  16: 'java-runtime-alpha',
  17: 'java-runtime-gamma',
  21: 'java-runtime-delta',
  25: 'java-runtime-epsilon',
};

export function javaOverrideRequirement(major: JavaMajor | null): JavaRequirement | null {
  return major === null ? null : { component: JAVA_COMPONENTS[major], major };
}

export function serverLaunchProfile(target: LaunchTarget): LaunchProfile {
  return {
    folderId: instanceIdOf(target),
    runtime: catalogServerRuntime(target.minecraft),
    memoryMb: null,
    javaOverride: null,
  };
}
