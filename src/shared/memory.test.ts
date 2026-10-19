import { describe, expect, it } from 'vitest';
import {
  defaultMemoryMb,
  isAllowedMemoryMb,
  lowerMemoryStepMb,
  maxGameMemoryMb,
  maxMemoryMb,
  memoryCeilingMb,
  nextMemoryStepMb,
} from './memory';

const GIB = 1024 ** 3;

describe('defaultMemoryMb', () => {
  it('scale: from 8 GB — 4 GB, from 6 GB — 3 GB, otherwise 2 GB', () => {
    expect(defaultMemoryMb(32 * GIB)).toBe(4096);
    expect(defaultMemoryMb(16 * GIB)).toBe(4096);
    expect(defaultMemoryMb(8 * GIB)).toBe(4096);
    expect(defaultMemoryMb(6 * GIB)).toBe(3072);
    expect(defaultMemoryMb(4 * GIB)).toBe(2048);
  });

  it('on small machines no more than 75% of RAM and no more than RAM minus 1 GB', () => {
    expect(defaultMemoryMb(3 * GIB)).toBe(2048);
    expect(defaultMemoryMb(2 * GIB)).toBe(1024);
    expect(defaultMemoryMb(1.5 * GIB)).toBe(1024);
  });

  it('8 GB, of which the system reserved part, still counts as 8', () => {
    expect(defaultMemoryMb(7.8 * GIB)).toBe(4096);
    expect(defaultMemoryMb(5.8 * GIB)).toBe(3072);
    expect(defaultMemoryMb(7.2 * GIB)).toBe(3072);
  });
});

describe('isAllowedMemoryMb', () => {
  it('a whole number of megabytes from 1 GB and no more than RAM minus 1 GB for the system', () => {
    expect(isAllowedMemoryMb(4096, 8 * GIB)).toBe(true);
    expect(isAllowedMemoryMb(7168, 8 * GIB)).toBe(true);
    expect(isAllowedMemoryMb(7169, 8 * GIB)).toBe(false);
    expect(isAllowedMemoryMb(8192, 8 * GIB)).toBe(false);
    expect(isAllowedMemoryMb(512, 8 * GIB)).toBe(false);
    expect(isAllowedMemoryMb(2048.5, 8 * GIB)).toBe(false);
  });

  it('NaN and infinity do not pass', () => {
    expect(isAllowedMemoryMb(Number.NaN, 8 * GIB)).toBe(false);
    expect(isAllowedMemoryMb(Number.POSITIVE_INFINITY, 8 * GIB)).toBe(false);
    expect(maxMemoryMb(Number.NaN)).toBe(1024);
  });
});

describe('maxGameMemoryMb', () => {
  it('RAM minus a quarter for the system, in 512 MB steps, from 2 to 16 GB', () => {
    expect(maxGameMemoryMb(16 * GIB)).toBe(12288);
    expect(maxGameMemoryMb(7.8 * GIB)).toBe(5632);
    expect(maxGameMemoryMb(2 * GIB)).toBe(2048);
    expect(maxGameMemoryMb(64 * GIB)).toBe(16384);
  });
});

describe('memory scale for a crash fix', () => {
  it('up — a step one and a half times larger, no lower than 2 GB', () => {
    expect(nextMemoryStepMb(2048, 16 * GIB)).toBe(3072);
    expect(nextMemoryStepMb(3072, 16 * GIB)).toBe(6144);
    expect(nextMemoryStepMb(64, 16 * GIB)).toBe(2048);
    expect(nextMemoryStepMb(null, 16 * GIB)).toBe(4096);
  });

  it("up — no higher than the machine's ceiling, nothing to offer at the ceiling", () => {
    expect(memoryCeilingMb(8 * GIB)).toBe(6144);
    expect(memoryCeilingMb(64 * GIB)).toBe(16384);
    expect(nextMemoryStepMb(4096, 8 * GIB)).toBe(6144);
    expect(nextMemoryStepMb(6144, 8 * GIB)).toBeNull();
    expect(nextMemoryStepMb(6144, 12 * GIB)).toBe(8192);
    expect(nextMemoryStepMb(8192, 12 * GIB)).toBeNull();
    expect(nextMemoryStepMb(null, 1.5 * GIB)).toBeNull();
  });

  it('down — a step one and a half times smaller, no lower than 2 GB', () => {
    expect(lowerMemoryStepMb(8192)).toBe(4096);
    expect(lowerMemoryStepMb(3072)).toBe(2048);
    expect(lowerMemoryStepMb(2048)).toBeNull();
    expect(lowerMemoryStepMb(null)).toBeNull();
  });
});
