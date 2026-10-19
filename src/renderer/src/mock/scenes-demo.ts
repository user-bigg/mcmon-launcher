import type { Scene, SceneTime } from '@shared/scenes';
import { hourTime } from '../lib/landscape';
import scenesJson from './scenes-demo.json';

const manifest = scenesJson as Scene[];

const pulseSources: Record<SceneTime, string> = {
  day: 'taiga',
  sunset: 'village',
  night: 'bedwars',
};

function pulseScene(hour: number): Scene[] {
  const source = manifest.find((scene) => scene.key === pulseSources[hourTime(hour)]);
  if (source === undefined) {
    return [];
  }
  const key = `pulse-${String(hour).padStart(2, '0')}`;
  return [{ ...source, key, purpose: 'pulse', hour }];
}

export const demoScenes: Scene[] = [
  ...manifest,
  ...Array.from({ length: 24 }, (_, hour) => pulseScene(hour)).flat(),
];

export function demoScene(key: string): Scene | undefined {
  return demoScenes.find((scene) => scene.key === key);
}
