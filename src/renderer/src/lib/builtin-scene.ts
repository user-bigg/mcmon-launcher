import type { Scene, SceneLayer } from '@shared/scenes';
import manifest from '../assets/landscape-builtin/scene.json';
import { SCENE_HEIGHT, type LayerRef } from './landscape';

export const BUILTIN_SCENE_KEY = 'builtin';
export const STAND_IN_AFTER_MS = 1500;
export const STAND_IN_HOLD_MS = 250;

const files = import.meta.glob<string>('../assets/landscape-builtin/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
});

const urls = new Map(
  Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.png$/g, ''), url]),
);

const layers = manifest.layers as SceneLayer[];

export const BUILTIN_SCENE: Scene = {
  key: BUILTIN_SCENE_KEY,
  name: '',
  pack: 'builtin',
  purpose: 'mood',
  focus: manifest.focus,
  skies: { day: manifest.sky, sunset: manifest.sky, night: manifest.sky },
  layers: { day: layers, sunset: layers, night: layers },
  in_library: false,
};

// A frame cuts the scene from the top. The scene is lowered a little, giving up rows of ground,
// when that keeps the sun (a tall frame) or the top of the trestle (a low strip) off the edge.
export function builtinSinkRows(frameRows: number): number {
  const { keepRows, maxSink } = manifest.framing;
  const cut = SCENE_HEIGHT - frameRows;
  const needs = keepRows.map((row) => Math.ceil(cut - row));
  const within = needs.find((need) => need <= maxSink);
  return Math.max(0, Math.min(within ?? maxSink, maxSink));
}

export function builtinLayerUrl(layer: Pick<LayerRef, 'layer'>): string {
  return urls.get(layer.layer) ?? '';
}
