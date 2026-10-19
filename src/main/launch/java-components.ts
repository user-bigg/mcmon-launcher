import { JAVA_MAJORS, type JavaMajor } from '@shared/instance';
import type { JavaRequirement } from './java';
import { javaOverrideRequirement } from './launch-profile';

const ALIASES: Readonly<Record<string, number>> = {
  'java-runtime-beta': 17,
  'java-runtime-gamma-snapshot': 17,
};

const LONG_TERM_MAJORS: readonly JavaMajor[] = JAVA_MAJORS.filter((major) => major !== 16);

export function javaMajorFor(required: number): JavaMajor | null {
  return LONG_TERM_MAJORS.find((major) => major >= required) ?? null;
}

export function javaForMajor(required: number): JavaRequirement | null {
  return javaOverrideRequirement(javaMajorFor(required));
}

export function javaMajorOfComponent(component: string): number | null {
  const known = JAVA_MAJORS.find(
    (major) => javaOverrideRequirement(major)?.component === component,
  );
  return known ?? ALIASES[component] ?? null;
}

export function javaComponentsOfMajor(major: number): string[] {
  const own = JAVA_MAJORS.filter((known) => known === major).map(
    (known) => javaOverrideRequirement(known)?.component ?? '',
  );
  const aliases = Object.keys(ALIASES).filter((component) => ALIASES[component] === major);
  return [...own, ...aliases].filter((component) => component !== '');
}

export function javaMajorOfPath(javaPath: string): number | null {
  for (const segment of javaPath.split(/[\\/]/)) {
    const major = javaMajorOfComponent(segment);
    if (major !== null) {
      return major;
    }
  }
  return null;
}
