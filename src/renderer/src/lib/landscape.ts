import type { CoverTime } from '@shared/catalog';
import type {
  LayerAnimation,
  LayerAnimationType,
  Scene,
  SceneClock,
  SceneDates,
  SceneMood,
  ScenePurpose,
  SceneTime,
} from '@shared/scenes';
import { moscowHour, moscowMonthDay, moscowTime } from './time';

export const SCENE_WIDTH = 384;
export const SCENE_HEIGHT = 176;
export const COVER_ROWS = 52;
export const DRIFTING_LAYER = 'clouds';
export const FAST_FALL_SECONDS = 1.2;

const MIN_PIXEL = 2;
const FOCUS_MARGIN = 0.03;
const POINTER_REACH = 0.06;

export interface LayerRef {
  scene: string;
  time: SceneTime;
  layer: string;
}

export type LayerSource = string | ((ref: LayerRef) => string);

export type LayerTile = 'x' | 'y';
export type MotionKeyframes = LayerAnimationType | 'drift-back';

export interface LayerMotion {
  keyframes: MotionKeyframes | null;
  tile: LayerTile | null;
  still: number;
  vars: Record<string, string>;
}

export interface PlacedLayer {
  name: string;
  depth: number;
  url: string;
  motion: LayerMotion | null;
}

const CLOUDS_DRIFT_SECONDS = 240;
const TILES: Partial<Record<LayerAnimationType, LayerTile>> = { drift: 'x', fall: 'y', rise: 'y' };

export function pixelScale(width: number): number {
  return Math.max(MIN_PIXEL, Math.ceil(width / SCENE_WIDTH));
}

export function coverScale(width: number, height: number): number {
  return Math.max(pixelScale(width), Math.ceil(height / SCENE_HEIGHT));
}

export function animationSteps(anim: LayerAnimation): number {
  if (anim.steps !== undefined && anim.steps > 0) {
    return anim.steps;
  }
  if (anim.type === 'drift') {
    return SCENE_WIDTH;
  }
  if (anim.type === 'fall' || anim.type === 'rise') {
    return anim.dur < FAST_FALL_SECONDS ? SCENE_HEIGHT / 2 : SCENE_HEIGHT;
  }
  return 0;
}

function keyframesOf(anim: LayerAnimation): MotionKeyframes | null {
  if (anim.type === 'still') {
    return null;
  }
  return anim.type === 'drift' && anim.dir === -1 ? 'drift-back' : anim.type;
}

function seconds(value: number): string {
  return `${String(value)}s`;
}

function motionOf(anim: LayerAnimation, timing?: string): LayerMotion {
  const keyframes = keyframesOf(anim);
  const steps = animationSteps(anim);
  const tile = anim.type === 'still' ? null : (TILES[anim.type] ?? null);
  return {
    keyframes,
    tile,
    still: anim.still,
    vars:
      keyframes === null
        ? {}
        : {
            '--lx-anim-dur': seconds(anim.dur),
            '--lx-anim-delay': seconds(anim.delay),
            '--lx-anim-amp': String(anim.amp),
            '--lx-anim-timing': timing ?? (steps > 0 ? `steps(${String(steps)})` : 'linear'),
          },
  };
}

const CLOUDS_MOTION = motionOf(
  { type: 'drift', dur: CLOUDS_DRIFT_SECONDS, delay: 0, amp: 0, dir: -1, still: 1 },
  'linear',
);

export function layerMotion(name: string, anim: LayerAnimation | undefined): LayerMotion | null {
  if (anim !== undefined) {
    return motionOf(anim);
  }
  return name === DRIFTING_LAYER ? CLOUDS_MOTION : null;
}

export function hourTime(hour: number): SceneTime {
  if (hour >= 7 && hour < 18) {
    return 'day';
  }
  return hour >= 18 && hour < 22 ? 'sunset' : 'night';
}

export function sceneTime(time: CoverTime, now: Date = new Date()): SceneTime {
  return time === 'auto' ? hourTime(moscowHour(now)) : time;
}

export type ScenePlace = 'welcome' | 'waiting' | 'pulse';

export interface ScenePick {
  scene: Scene;
  time: SceneTime;
  holiday: boolean;
}

const HOURS_IN_DAY = 24;
const HOLIDAY_PLACES: readonly ScenePlace[] = ['welcome', 'pulse'];
const PLACE_MOOD: Record<Exclude<ScenePlace, 'pulse'>, SceneMood> = {
  welcome: 'welcome',
  waiting: 'waiting',
};
const FALLBACK_MOOD: SceneMood = 'calm';

function ofPurpose(scenes: readonly Scene[], purpose: ScenePurpose): Scene[] {
  return scenes.filter((scene) => scene.purpose === purpose);
}

export function inDates(dates: SceneDates, day: string): boolean {
  if (dates.from <= dates.to) {
    return day >= dates.from && day <= dates.to;
  }
  return day >= dates.from || day <= dates.to;
}

function dayNumber(monthDay: string): number {
  const [month = 0, day = 0] = monthDay.split('-').map(Number);
  return month * 31 + day;
}

function windowLength(dates: SceneDates): number {
  const length = dayNumber(dates.to) - dayNumber(dates.from);
  return length >= 0 ? length : length + 12 * 31;
}

const NOON = '12:00';

function nextDay(monthDay: string): string {
  const [month = 1, day = 1] = monthDay.split('-').map(Number);
  return new Date(Date.UTC(2000, month - 1, day + 1)).toISOString().slice(5, 10);
}

export function inHolidayWindow(
  dates: SceneDates,
  time: SceneClock | undefined,
  day: string,
  clock: string,
): boolean {
  if (time === undefined) {
    return inDates(dates, day);
  }
  const endDay = dates.from === dates.to && time.to < time.from ? nextDay(dates.to) : dates.to;
  const start = `${dates.from} ${time.from}`;
  const end = `${endDay} ${time.to}`;
  const now = `${day} ${clock}`;
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

export function holidayScene(
  scenes: readonly Scene[],
  day: string,
  clock: string = NOON,
): Scene | undefined {
  return ofPurpose(scenes, 'holiday')
    .flatMap((scene) => {
      const { dates } = scene;
      return dates !== undefined && inHolidayWindow(dates, scene.time, day, clock)
        ? [{ scene, length: windowLength(dates), priority: scene.priority ?? 0 }]
        : [];
    })
    .toSorted((a, b) => b.priority - a.priority || a.length - b.length)[0]?.scene;
}

function hoursBefore(hour: number, target: number): number {
  return (((target - hour) % HOURS_IN_DAY) + HOURS_IN_DAY) % HOURS_IN_DAY;
}

function hourDistance(hour: number, target: number): number {
  const before = hoursBefore(hour, target);
  return Math.min(before, HOURS_IN_DAY - before) * 2 + (before <= HOURS_IN_DAY / 2 ? 0 : 1);
}

export function pulseScene(scenes: readonly Scene[], hour: number): Scene | undefined {
  return ofPurpose(scenes, 'pulse')
    .flatMap((scene) =>
      scene.hour === undefined ? [] : [{ scene, distance: hourDistance(scene.hour, hour) }],
    )
    .toSorted((a, b) => a.distance - b.distance)[0]?.scene;
}

function isNightScene(scene: Scene): boolean {
  return scene.moods?.includes('night') ?? false;
}

export function moodScene(
  scenes: readonly Scene[],
  mood: SceneMood,
  night: boolean,
): Scene | undefined {
  const moods = ofPurpose(scenes, 'mood');
  const matching = moods.filter((scene) => scene.moods?.includes(mood));
  const candidates =
    matching.length > 0 ? matching : moods.filter((scene) => scene.moods?.includes(FALLBACK_MOOD));
  return candidates.find((scene) => isNightScene(scene) === night) ?? candidates[0];
}

export function pickScene(
  scenes: readonly Scene[],
  place: ScenePlace,
  now: Date,
): ScenePick | undefined {
  const hour = moscowHour(now);
  const time = hourTime(hour);
  const holiday = HOLIDAY_PLACES.includes(place)
    ? holidayScene(scenes, moscowMonthDay(now), moscowTime(now))
    : undefined;
  if (holiday !== undefined) {
    return { scene: holiday, time, holiday: true };
  }
  if (place === 'pulse') {
    const pulse = pulseScene(scenes, hour);
    return pulse === undefined
      ? undefined
      : { scene: pulse, time: hourTime(pulse.hour ?? hour), holiday: false };
  }
  const mood = moodScene(scenes, PLACE_MOOD[place], time === 'night');
  return mood === undefined
    ? undefined
    : { scene: mood, time: isNightScene(mood) ? 'night' : time, holiday: false };
}

export function layerUrl(source: LayerSource, ref: LayerRef): string {
  if (typeof source === 'function') {
    return source(ref);
  }
  return `${source.replace(/\/+$/, '')}/${ref.scene}-${ref.time}/${ref.layer}.png`;
}

export function placeLayers(scene: Scene, time: SceneTime, source: LayerSource): PlacedLayer[] {
  return scene.layers[time]
    .map((layer, order) => ({ layer, order }))
    .sort((a, b) => a.layer.depth - b.layer.depth || a.order - b.order)
    .map(({ layer }) => {
      const motion = layerMotion(layer.name, layer.anim);
      return {
        name: layer.name,
        depth: layer.depth,
        url: layerUrl(source, { scene: scene.key, time, layer: layer.name }),
        motion,
      };
    });
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

export function focusShift(width: number, pixel: number, focus: number): number {
  const picture = SCENE_WIDTH * pixel;
  const room = Math.max(0, (picture - width) / 2 - width * FOCUS_MARGIN);
  return Math.round(clamp((0.5 - focus) * picture, room));
}

export function parallaxRoom(width: number, pixel: number, shift: number): number {
  return Math.max(0, (SCENE_WIDTH * pixel - width) / 2 - Math.abs(shift));
}

export function parallaxReach(width: number, room: number, deepest: number): number {
  const widest = deepest * width * POINTER_REACH;
  return widest > room ? (POINTER_REACH * room) / widest : POINTER_REACH;
}

export interface ParallaxInput {
  pointer: number;
  depth: number;
  width: number;
  reach: number;
}

export function parallaxOffset(input: ParallaxInput): number {
  return Math.round(-input.pointer * input.depth * input.width * input.reach);
}
