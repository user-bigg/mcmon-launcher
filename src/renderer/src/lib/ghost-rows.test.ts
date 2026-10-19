import { describe, expect, it } from 'vitest';
import { ghostRows, rowsFitting } from './ghost-rows';

describe('ghostRows', () => {
  it('takes the number remembered from the last load', () => {
    expect(ghostRows(7, null)).toBe(7);
    expect(ghostRows(0, null)).toBe(0);
  });

  it('is three rows when nothing is remembered', () => {
    expect(ghostRows(null, null)).toBe(3);
    expect(ghostRows(null, 10)).toBe(3);
  });

  it('never shows more rows than fit into the panel', () => {
    expect(ghostRows(40, 5)).toBe(5);
    expect(ghostRows(null, 2)).toBe(2);
    expect(ghostRows(8, 0)).toBe(0);
  });

  it('is capped for a long list in a panel that was not measured', () => {
    expect(ghostRows(300, null)).toBe(12);
  });
});

describe('rowsFitting', () => {
  it('counts whole rows with the gaps between them', () => {
    expect(rowsFitting(36, 36, 1)).toBe(1);
    expect(rowsFitting(72, 36, 1)).toBe(1);
    expect(rowsFitting(73, 36, 1)).toBe(2);
    expect(rowsFitting(200, 36, 1)).toBe(5);
  });

  it('is unknown without a layout', () => {
    expect(rowsFitting(0, 36, 1)).toBeNull();
    expect(rowsFitting(200, 0, 1)).toBeNull();
  });
});
