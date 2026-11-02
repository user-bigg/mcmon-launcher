import { describe, expect, it } from 'vitest';
import { failure } from './errors';
import { fabricErrorOf } from './fabric-error';

describe('why Fabric did not come', () => {
  it('names the step from the launch error', () => {
    expect(fabricErrorOf(null)).toBe('files');
    expect(
      fabricErrorOf(
        failure({
          code: 'loader-install-failed',
          loader: 'fabric',
          stage: 'manifest',
          detail: null,
        }),
      ),
    ).toBe('meta');
    expect(
      fabricErrorOf(
        failure({
          code: 'loader-install-failed',
          loader: 'fabric',
          stage: 'library',
          detail: null,
        }),
      ),
    ).toBe('maven');
    expect(
      fabricErrorOf(
        failure({ code: 'network', url: 'https://maven.fabricmc.net/a.jar', reason: 'timeout' }),
      ),
    ).toBe('maven');
    expect(
      fabricErrorOf(
        failure({
          code: 'network',
          url: 'https://mc-mon.ru/mirror/fabric-meta/v2/x',
          reason: 'timeout',
        }),
      ),
    ).toBe('meta');
    expect(fabricErrorOf(new Error('boom'))).toBe('other');
    expect(
      fabricErrorOf(
        failure({ code: 'checksum-mismatch', file: '/g/libraries/net/fabricmc/fabric-loader.jar' }),
      ),
    ).toBe('maven');
    expect(
      fabricErrorOf(failure({ code: 'checksum-mismatch', file: '/g/versions/26.3/26.3.jar' })),
    ).toBe('other');
  });
});
