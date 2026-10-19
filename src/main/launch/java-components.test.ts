import { describe, expect, it } from 'vitest';
import { javaForMajor, javaMajorOfPath } from './java-components';

describe('Mojang Java components', () => {
  it('by version and by path', () => {
    expect(javaForMajor(8)).toEqual({ component: 'jre-legacy', major: 8 });
    expect(javaForMajor(17)).toEqual({ component: 'java-runtime-gamma', major: 17 });
    expect(javaForMajor(22)).toEqual({ component: 'java-runtime-epsilon', major: 25 });
    expect(javaForMajor(30)).toBeNull();
    expect(javaMajorOfPath('C:\\game\\runtime\\java-runtime-delta\\bin\\javaw.exe')).toBe(21);
    expect(javaMajorOfPath('/usr/bin/java')).toBeNull();
  });
});
