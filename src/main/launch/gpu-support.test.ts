import { describe, expect, it } from 'vitest';
import { checkGpuSupport, gpuLimit, needsCoreProfile } from './gpu-support';

const sandyBridge = { vendor: 0x8086, device: 0x0106, name: 'Intel(R) HD Graphics' };
const basicRender = { vendor: 0x1414, device: 0x008c, name: 'Microsoft Basic Render Driver' };
const geforce = { vendor: 0x10de, device: 0x0de9, name: 'NVIDIA GeForce GT 630M' };
const ivyBridge = { vendor: 0x8086, device: 0x0166, name: 'Intel(R) HD Graphics 4000' };

describe('needsCoreProfile', () => {
  it.each([
    ['1.16.5', false],
    ['1.8.9', false],
    ['1.17', true],
    ['1.21.11', true],
    ['26.3', true],
    ['21w09a', false],
    ['21w10a', true],
    ['b1.7.3', false],
    ['1.17-pre1', true],
    ['1.16.5-rc1', false],
    ['26.1-snapshot-1', true],
  ])('%s → %s', (minecraft, expected) => {
    expect(needsCoreProfile(minecraft)).toBe(expected);
  });
});

describe('gpuLimit', () => {
  it('names a Sandy Bridge chip next to the basic render driver', () => {
    expect(gpuLimit([sandyBridge, basicRender])).toEqual({
      name: 'Intel(R) HD Graphics',
      openGl: '3.1',
    });
  });

  it('lets a laptop with a discrete card through', () => {
    expect(gpuLimit([sandyBridge, geforce])).toBeNull();
  });

  it('lets newer Intel chips and unknown machines through', () => {
    expect(gpuLimit([ivyBridge])).toBeNull();
    expect(gpuLimit([])).toBeNull();
    expect(gpuLimit([basicRender])).toBeNull();
  });
});

describe('checkGpuSupport', () => {
  it('stops 26.3 on Windows with a Sandy Bridge chip', () => {
    expect(() => {
      checkGpuSupport('26.3', 'win32', [sandyBridge, basicRender]);
    }).toThrow(
      expect.objectContaining({
        error: {
          code: 'gpu-unsupported',
          minecraft: '26.3',
          gpu: 'Intel(R) HD Graphics',
          openGl: '3.1',
        },
      }),
    );
  });

  it('lets 1.16.5 and other systems through', () => {
    expect(() => {
      checkGpuSupport('1.16.5', 'win32', [sandyBridge]);
    }).not.toThrow();
    expect(() => {
      checkGpuSupport('26.3', 'linux', [sandyBridge]);
    }).not.toThrow();
  });
});
