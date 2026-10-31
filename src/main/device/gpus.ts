import { app } from 'electron';
import type { DeviceGpu } from '@shared/telemetry';
import { withDeadline } from '../deadline';
import { gpuList } from './profile';

const GPU_INFO_DEADLINE_MS = 3000;

export function systemGpus(): Promise<DeviceGpu[]> {
  return withDeadline(
    app.getGPUInfo('basic').then(gpuList, () => []),
    GPU_INFO_DEADLINE_MS,
    [],
  );
}
