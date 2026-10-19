import { describe, expect, it } from 'vitest';
import type { Scene } from '@shared/scenes';
import {
  holidayScene,
  hourTime,
  inDates,
  inHolidayWindow,
  moodScene,
  pickScene,
  animationSteps,
  FAST_FALL_SECONDS,
  focusShift,
  layerMotion,
  layerUrl,
  parallaxOffset,
  parallaxReach,
  pixelScale,
  pulseScene,
  sceneTime,
  SCENE_WIDTH,
} from './landscape';
import { moscowMonthDay } from './time';

const BASE = 'https://cdn.example/landscapes';

function scene(key: string, extra: Partial<Scene> = {}): Scene {
  const layers = [{ name: 'sky', depth: 0 }];
  return {
    key,
    name: key,
    pack: 'test',
    purpose: 'library',
    focus: 0.5,
    skies: { day: '#4f86cc', sunset: '#22265e', night: '#01030c' },
    layers: { day: layers, sunset: layers, night: layers },
    ...extra,
  };
}

const moscow = (iso: string): Date => new Date(`${iso}+03:00`);

const taiga = scene('taiga');
const village = scene('village');
const calm = scene('a-calm', { purpose: 'mood', moods: ['calm'] });
const fog = scene('a-fog', { purpose: 'mood', moods: ['waiting'] });
const dawn = scene('a-dawn', { purpose: 'mood', moods: ['welcome'] });
const aurora = scene('a-aurora', { purpose: 'mood', moods: ['welcome', 'night'] });
const newYear = scene('h-new-year', {
  purpose: 'holiday',
  dates: { from: '12-31', to: '01-02' },
});
const winter = scene('h-winter', { purpose: 'holiday', dates: { from: '12-01', to: '02-28' } });
const victory = scene('h-may', { purpose: 'holiday', dates: { from: '05-08', to: '05-09' } });
const pulses = [0, 7, 12, 19, 22].map((hour) =>
  scene(`p-${String(hour)}`, { purpose: 'pulse', hour }),
);
const all = [taiga, village, calm, fog, dawn, aurora, newYear, winter, victory, ...pulses];

describe('holiday window by dates', () => {
  it('an ordinary window within a year', () => {
    const may = { from: '05-08', to: '05-09' };
    expect(inDates(may, '05-08')).toBe(true);
    expect(inDates(may, '05-09')).toBe(true);
    expect(inDates(may, '05-10')).toBe(false);
    expect(inDates(may, '05-07')).toBe(false);
  });

  it('a window across the year boundary', () => {
    const holidays = { from: '12-25', to: '01-08' };
    expect(inDates(holidays, '12-25')).toBe(true);
    expect(inDates(holidays, '12-31')).toBe(true);
    expect(inDates(holidays, '01-01')).toBe(true);
    expect(inDates(holidays, '01-08')).toBe(true);
    expect(inDates(holidays, '01-09')).toBe(false);
    expect(inDates(holidays, '12-24')).toBe(false);
    expect(inDates(holidays, '06-15')).toBe(false);
  });

  it('the day is counted by Moscow time, not UTC', () => {
    expect(moscowMonthDay(new Date('2026-12-31T22:30:00Z'))).toBe('01-01');
    expect(moscowMonthDay(new Date('2026-12-31T20:30:00Z'))).toBe('12-31');
  });

  it('of two matching holidays the narrower window is taken', () => {
    expect(holidayScene(all, '01-01')).toBe(newYear);
    expect(holidayScene(all, '12-31')).toBe(newYear);
    expect(holidayScene(all, '02-10')).toBe(winter);
    expect(holidayScene(all, '05-09')).toBe(victory);
    expect(holidayScene(all, '10-03')).toBeUndefined();
  });

  it('a holiday with an hour window: Dec 31 18:00 — Jan 1 06:00 Moscow time', () => {
    const fireworks = scene('h-fireworks', {
      purpose: 'holiday',
      dates: { from: '12-31', to: '01-01' },
      time: { from: '18:00', to: '06:00' },
      priority: 5,
    });
    const scenes = [...all, fireworks];
    expect(holidayScene(scenes, '12-31', '17:59')).toBe(newYear);
    expect(holidayScene(scenes, '12-31', '18:00')).toBe(fireworks);
    expect(holidayScene(scenes, '12-31', '23:59')).toBe(fireworks);
    expect(holidayScene(scenes, '01-01', '00:00')).toBe(fireworks);
    expect(holidayScene(scenes, '01-01', '05:59')).toBe(fireworks);
    expect(holidayScene(scenes, '01-01', '06:00')).toBe(newYear);
    expect(pickScene(scenes, 'welcome', moscow('2026-12-31T21:00:00'))?.scene).toBe(fireworks);
    expect(pickScene(scenes, 'welcome', moscow('2027-01-01T07:00:00'))?.scene).toBe(newYear);
  });

  it('an hour window within one day and across midnight of one day', () => {
    const evening = { from: '05-09', to: '05-09' };
    expect(inHolidayWindow(evening, { from: '20:00', to: '23:00' }, '05-09', '21:30')).toBe(true);
    expect(inHolidayWindow(evening, { from: '20:00', to: '23:00' }, '05-09', '23:00')).toBe(false);
    expect(inHolidayWindow(evening, { from: '22:00', to: '02:00' }, '05-10', '01:00')).toBe(true);
    expect(inHolidayWindow(evening, { from: '22:00', to: '02:00' }, '05-10', '02:00')).toBe(false);
  });

  it('when windows overlap, the higher priority wins', () => {
    const wide = scene('h-wide', {
      purpose: 'holiday',
      dates: { from: '12-01', to: '02-28' },
      priority: 3,
    });
    expect(holidayScene([...all, wide], '01-01')).toBe(wide);
  });
});

describe("'Pulse' by the hour", () => {
  it('exact hour', () => {
    expect(pulseScene(all, 12)?.key).toBe('p-12');
    expect(pulseScene(all, 0)?.key).toBe('p-0');
  });

  it('no scene for this hour — the nearest one, on a tie — the past one', () => {
    expect(pulseScene(all, 13)?.key).toBe('p-12');
    expect(pulseScene(all, 17)?.key).toBe('p-19');
    expect(pulseScene(all, 21)?.key).toBe('p-22');
    expect(pulseScene(all, 23)?.key).toBe('p-22');
    expect(pulseScene(all, 3)?.key).toBe('p-0');
    expect(pulseScene([scene('p-10', { purpose: 'pulse', hour: 10 })], 3)?.key).toBe('p-10');
  });

  it('across midnight', () => {
    const night = [23, 2].map((hour) => scene(`p-${String(hour)}`, { purpose: 'pulse', hour }));
    expect(pulseScene(night, 0)?.key).toBe('p-23');
    expect(pulseScene(night, 1)?.key).toBe('p-2');
  });

  it("frame time by the scene's hour", () => {
    expect(hourTime(12)).toBe('day');
    expect(hourTime(19)).toBe('sunset');
    expect(hourTime(23)).toBe('night');
    expect(pickScene(all, 'pulse', moscow('2026-10-03T20:10:00'))).toEqual({
      scene: pulses[3],
      time: 'sunset',
      holiday: false,
    });
  });

  it('without a P series — empty, library scenes are not substituted', () => {
    expect(pickScene([taiga, village], 'pulse', moscow('2026-10-03T12:00:00'))).toBeUndefined();
  });
});

describe('scene by location', () => {
  it('sign-in at night — a night scene, in the day — a day scene', () => {
    expect(pickScene(all, 'welcome', moscow('2026-10-03T23:00:00'))).toEqual({
      scene: aurora,
      time: 'night',
      holiday: false,
    });
    expect(pickScene(all, 'welcome', moscow('2026-10-03T10:00:00'))).toEqual({
      scene: dawn,
      time: 'day',
      holiday: false,
    });
  });

  it('a night mood scene is always drawn at night', () => {
    expect(pickScene([aurora], 'welcome', moscow('2026-10-03T10:00:00'))).toEqual({
      scene: aurora,
      time: 'night',
      holiday: false,
    });
  });

  it('no scene for the location — a calm one, and if that is missing too — empty', () => {
    expect(moodScene([calm, fog], 'welcome', false)).toBe(calm);
    expect(pickScene([taiga, village], 'welcome', moscow('2026-10-03T10:00:00'))).toBeUndefined();
  });

  it("a holiday replaces sign-in and 'Pulse', but not waiting", () => {
    const night = moscow('2027-01-01T00:30:00');
    expect(pickScene(all, 'welcome', night)).toEqual({
      scene: newYear,
      time: 'night',
      holiday: true,
    });
    expect(pickScene(all, 'pulse', night)?.scene).toBe(newYear);
    expect(pickScene(all, 'waiting', night)?.scene).toBe(fog);
  });
});

describe('scale, time and layer address', () => {
  it('the pixel is always an integer and no less than two', () => {
    expect(pixelScale(0)).toBe(2);
    expect(pixelScale(300)).toBe(2);
    expect(pixelScale(SCENE_WIDTH * 2)).toBe(2);
    expect(pixelScale(SCENE_WIDTH * 2 + 1)).toBe(3);
    expect(pixelScale(1100)).toBe(3);
    expect(pixelScale(1920)).toBe(5);
  });

  it('auto picks the time of day by Moscow time', () => {
    expect(sceneTime('night')).toBe('night');
    expect(sceneTime('auto', new Date('2026-10-03T09:00:00Z'))).toBe('day');
    expect(sceneTime('auto', new Date('2026-10-03T16:30:00Z'))).toBe('sunset');
    expect(sceneTime('auto', new Date('2026-10-03T20:00:00Z'))).toBe('night');
    expect(sceneTime('auto', new Date('2026-10-03T03:59:00Z'))).toBe('night');
  });

  it("the layer address is built per the site's rule", () => {
    expect(layerUrl(`${BASE}/`, { scene: 'taiga', time: 'day', layer: 'far' })).toBe(
      `${BASE}/taiga-day/far.png`,
    );
  });

  it('focus shifts the scene but does not reveal the edge', () => {
    expect(focusShift(400, 2, 0.5)).toBe(0);
    expect(focusShift(400, 2, 0.6)).toBeLessThan(0);
    expect(Math.abs(focusShift(400, 2, 1))).toBeLessThanOrEqual((768 - 400) / 2);
  });
});

describe('layer animation steps', () => {
  const base = { delay: 0, amp: 2, dir: 1, still: 1 } as const;

  it('steps like on the site: drift 384, fall and rise 176, fast ones 88', () => {
    expect(animationSteps({ ...base, type: 'drift', dur: 60 })).toBe(384);
    expect(animationSteps({ ...base, type: 'fall', dur: FAST_FALL_SECONDS })).toBe(176);
    expect(animationSteps({ ...base, type: 'rise', dur: FAST_FALL_SECONDS - 0.1 })).toBe(88);
    expect(animationSteps({ ...base, type: 'twinkle', dur: 2 })).toBe(0);
  });

  it('steps from the site take priority over the rule', () => {
    expect(animationSteps({ ...base, type: 'fall', dur: 0.5, steps: 44 })).toBe(44);
  });

  it('clouds without anim drift the old way: 240 s to the left, smoothly', () => {
    expect(layerMotion('clouds', undefined)).toMatchObject({
      keyframes: 'drift-back',
      tile: 'x',
      still: 1,
      vars: { '--lx-anim-dur': '240s', '--lx-anim-timing': 'linear' },
    });
    expect(layerMotion('far', undefined)).toBeNull();
  });
});

describe('parallax', () => {
  const width = 1000;
  const depths = [0.2, 0.5, 1];

  function offsets(pointer: number, room: number): number[] {
    const reach = parallaxReach(width, room, Math.max(...depths));
    return depths.map((depth) => parallaxOffset({ pointer, depth, width, reach }));
  }

  it('keeps the full reach when the picture has room for the nearest layer', () => {
    expect(offsets(1, 200)).toEqual([-12, -30, -60]);
  });

  it('scales every layer by the same factor when room is short', () => {
    expect(offsets(1, 30)).toEqual([-6, -15, -30]);
    expect(offsets(-1, 30)).toEqual([6, 15, 30]);
  });

  it('keeps the nearest layer moving all the way to the edge', () => {
    const nearest = [0.25, 0.5, 0.75, 1].map((pointer) => offsets(pointer, 30)[2]);
    expect(nearest).toEqual([-7, -15, -22, -30]);
  });

  it('does not move layers when the picture has no spare width', () => {
    expect(offsets(1, 0).map(Math.abs)).toEqual([0, 0, 0]);
  });
});
