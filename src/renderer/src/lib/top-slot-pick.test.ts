import { describe, expect, it } from 'vitest';
import type { ServerRow } from '@shared/catalog';
import { pickTopSlot } from './top-slot-pick';

const row = (id: number, online: number): ServerRow => ({ id, online }) as ServerRow;
const topSlots = [row(1, 1000), row(2, 10), row(3, 100)];

describe('pickTopSlot', () => {
  it('lower online count comes up more often: 3/6, 2/6, 1/6', () => {
    expect(pickTopSlot(topSlots, 0)?.id).toBe(2);
    expect(pickTopSlot(topSlots, 0.49)?.id).toBe(2);
    expect(pickTopSlot(topSlots, 0.5)?.id).toBe(3);
    expect(pickTopSlot(topSlots, 0.83)?.id).toBe(3);
    expect(pickTopSlot(topSlots, 0.84)?.id).toBe(1);
    expect(pickTopSlot(topSlots, 1)?.id).toBe(1);
  });

  it('empty and a single candidate', () => {
    expect(pickTopSlot([], 0.3)).toBeUndefined();
    expect(pickTopSlot([row(7, 5)], 0.9)?.id).toBe(7);
  });
});
