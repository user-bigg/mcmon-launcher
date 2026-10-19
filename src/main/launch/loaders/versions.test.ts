import { describe, expect, it } from 'vitest';
import { loaderVersionId } from './versions';

describe('loaderVersionId', () => {
  it('vanilla launches with its own version; Fabric launches with its inheriting version', () => {
    expect(loaderVersionId({ minecraft: '26.3', loader: 'vanilla' })).toBe('26.3');
    expect(loaderVersionId({ minecraft: '26.3', loader: 'fabric', loaderVersion: '0.19.5' })).toBe(
      'fabric-loader-0.19.5-26.3',
    );
  });
});
