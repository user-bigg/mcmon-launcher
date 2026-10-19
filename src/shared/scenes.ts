import type { CoverTime } from './catalog';

export type SceneTime = Exclude<CoverTime, 'auto'>;

export const SCENE_PURPOSES = ['library', 'pulse', 'holiday', 'mood', 'studio'] as const;
export type ScenePurpose = (typeof SCENE_PURPOSES)[number];

export const SCENE_MOODS = ['calm', 'waiting', 'night', 'welcome'] as const;
export type SceneMood = (typeof SCENE_MOODS)[number];

export const LAYER_ANIMATIONS = [
  'alt',
  'blip',
  'bob',
  'burst',
  'drift',
  'fall',
  'flash',
  'flicker',
  'ignite',
  'launch',
  'liftoff',
  'meteor',
  'puff',
  'pulse',
  'quarter',
  'rise',
  'sway',
  'twinkle',
] as const;
export type LayerAnimationType = (typeof LAYER_ANIMATIONS)[number];

export interface LayerAnimation {
  type: LayerAnimationType | 'still';
  dur: number;
  delay: number;
  amp: number;
  dir: 1 | -1;
  still: number;
  steps?: number;
}

export interface SceneLayer {
  name: string;
  depth: number;
  anim?: LayerAnimation;
}

export interface SceneDates {
  from: string;
  to: string;
}

export interface SceneClock {
  from: string;
  to: string;
}

export interface Scene {
  key: string;
  name: string;
  pack: string;
  purpose: ScenePurpose;
  focus: number;
  skies: Record<SceneTime, string>;
  layers: Record<SceneTime, SceneLayer[]>;
  in_library?: boolean;
  hour?: number;
  dates?: SceneDates;
  time?: SceneClock;
  priority?: number;
  moods?: SceneMood[];
}

export const SCENE_TIMES: readonly SceneTime[] = ['day', 'sunset', 'night'];
export const SCENE_KEY_PATTERN = /^[a-z0-9-]{1,32}$/;
export const LAYER_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
