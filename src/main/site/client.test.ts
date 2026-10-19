import { describe, expect, it } from 'vitest';
import { serverQueryParams } from './client';

describe('serverQueryParams', () => {
  it('the /servers query string', () => {
    expect(
      serverQueryParams({
        q: 'sky',
        mode: ['survival', 'anarchy'],
        access: 'all',
        page: 1,
      }).toString(),
    ).toBe('q=sky&mode%5B%5D=survival&mode%5B%5D=anarchy');
  });
});
