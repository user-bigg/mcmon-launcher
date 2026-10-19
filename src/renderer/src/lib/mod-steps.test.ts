import { describe, expect, it } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { ModsStepState, ModStep } from '@shared/mods';
import { blocksLaunch, inOrder, modStepGroups, type StepItem, type StepLine } from './mod-steps';

function step(slug: string, change: Partial<ModStep> = {}): ModStep {
  return {
    slug,
    short: slug,
    title: slug.toUpperCase(),
    credit: null,
    kind: 'mod',
    version: '1.0',
    channel: 'release',
    size: 1_048_576,
    bytesDone: 0,
    role: 'player',
    dependencyOf: [],
    status: 'wait',
    fromDisk: false,
    ...change,
  };
}

function state(steps: ModStep[], skipped: ModsStepState['skipped'] = []): ModsStepState {
  return { steps, skipped };
}

describe('mod steps of the launch', () => {
  it('server mods get a step each, their libraries one shared step', () => {
    const groups = modStepGroups(
      state([
        step('voice', { role: 'required', short: 'Голосовой чат', status: 'done' }),
        step('emotes', {
          role: 'optional',
          short: 'Эмоции',
          channel: 'beta',
          status: 'active',
          bytesDone: 524_288,
        }),
        step('api', { role: 'dependency', short: 'Fabric API', dependencyOf: ['emotes'] }),
        step('anim', {
          role: 'dependency',
          short: 'Библиотека анимаций',
          dependencyOf: ['emotes'],
        }),
      ]),
    );
    expect(groups.map((group) => group.label)).toEqual([ru.mods.groupServer]);
    const rows = groups[0]?.rows ?? [];
    expect(rows.map((row) => row.title)).toEqual([
      'Голосовой чат',
      'Эмоции',
      'Fabric API и библиотека анимаций',
    ]);
    expect(rows[1]).toMatchObject({ beta: true, status: 'active', bar: 50 });
    expect(rows[2]?.note).toBe(fill(ru.mods.dependencyOne, { mods: 'Эмоции' }));
  });

  it('mods of the player are one step, the shaders another, a banned mod is skipped', () => {
    const groups = modStepGroups(
      state(
        [
          step('sodium', {
            short: 'Плавная игра',
            title: 'Sodium',
            status: 'done',
            fromDisk: true,
          }),
          step('appleskin', {
            short: 'Сытость еды',
            title: 'AppleSkin',
            status: 'done',
            fromDisk: true,
          }),
          step('pack', {
            role: 'shaders',
            kind: 'shader_pack',
            short: 'Шейдеры',
            credit: 'Pack от Author',
            status: 'done',
            fromDisk: true,
          }),
          step('iris', {
            role: 'dependency',
            dependencyOf: ['pack'],
            status: 'done',
            fromDisk: true,
          }),
        ],
        [
          {
            slug: 'minimap',
            short: 'Миникарта',
            title: 'Minimap',
            state: 'forbidden',
            role: 'player',
          },
        ],
      ),
    );
    const rows = groups.find((group) => group.key === 'player')?.rows ?? [];
    expect(rows.map((row) => [row.title, row.right])).toEqual([
      ['Sodium и\u00a0AppleSkin', ru.mods.onDisk],
      ['Шейдеры', ru.mods.onDisk],
      [fill(ru.mods.skippedTitle.forbidden, { mod: 'Миникарта' }), ru.mods.skip],
    ]);
    expect(rows[1]?.note).toBe('Pack от Author');
    expect(rows[2]?.icon).toBe('slash-circle');
  });

  it('a library shared with a mod of the player names that mod by its title', () => {
    const groups = modStepGroups(
      state([
        step('emotes', { role: 'optional', short: 'Эмоции' }),
        step('appleskin', { short: 'Сытость еды', title: 'AppleSkin' }),
        step('api', { role: 'dependency', dependencyOf: ['emotes', 'appleskin'] }),
      ]),
    );
    const server = groups.find((group) => group.key === 'server')?.rows ?? [];
    expect(server.at(-1)?.note).toBe(
      fill(ru.mods.dependencyMany, { mods: '«Эмоции», «AppleSkin»' }),
    );
  });

  it('the step note shows the mod version without loader and game version', () => {
    const groups = modStepGroups(
      state([
        step('voice', {
          role: 'required',
          title: 'Simple Voice Chat',
          version: 'fabric-1.21.11-2.6.22',
        }),
      ]),
    );
    expect(groups[0]?.rows[0]?.note).toBe(
      fill(ru.mods.stepNote, { title: 'Simple Voice Chat', version: '2.6.22' }),
    );
  });

  it('a required mod that failed blocks the launch, an optional one only warns', () => {
    const required = modStepGroups(
      state([step('voice', { role: 'required', short: 'Голосовой чат', status: 'failed' })]),
    );
    expect(required[0]?.rows[0]).toMatchObject({
      status: 'failed',
      problem: 'required',
      title: fill(ru.mods.failedTitle, { mod: 'Голосовой чат' }),
    });
    expect(blocksLaunch(required)).toBe(true);
    const optional = modStepGroups(
      state([step('voice', { role: 'optional', short: 'Голосовой чат', status: 'failed' })]),
    );
    expect(optional[0]?.rows[0]?.problem).toBe('optional');
    expect(blocksLaunch(optional)).toBe(false);
  });

  it('a library of a required mod that failed blocks the launch too', () => {
    const groups = modStepGroups(
      state([
        step('voice', { role: 'required', status: 'skipped' }),
        step('api', { role: 'dependency', dependencyOf: ['voice'], status: 'failed' }),
      ]),
    );
    expect(blocksLaunch(groups)).toBe(true);
    expect(groups[0]?.rows.map((row) => row.status)).toEqual(['failed', 'skipped']);
  });

  it('a failed mod of the player says the game goes without it', () => {
    const groups = modStepGroups(state([step('minimap', { status: 'failed' })]));
    expect(groups[0]?.rows[0]).toMatchObject({ problem: null, note: ru.mods.failedPlayer });
  });

  it('no mods, no groups', () => {
    expect(modStepGroups(undefined)).toEqual([]);
  });

  it('what the pack needs goes with the shaders, deeper libraries with the player mods', () => {
    const groups = modStepGroups(
      state([
        step('pack', { role: 'shaders', short: 'Шейдеры' }),
        step('iris', { role: 'dependency', dependencyOf: ['pack'] }),
        step('sodium', {
          role: 'dependency',
          short: 'Плавная игра',
          title: 'Sodium',
          dependencyOf: ['iris'],
        }),
      ]),
    );
    const rows = groups[0]?.rows ?? [];
    expect(rows.map((row) => [row.title, row.right])).toEqual([
      ['Sodium', '1\u00a0МБ'],
      ['Шейдеры', '2\u00a0МБ'],
    ]);
  });
});

function line(status: StepLine['status'], mod: boolean, key: string): StepLine {
  return {
    kind: 'step',
    key,
    status,
    icon: 'check-lg',
    title: key,
    note: '',
    statusText: '',
    right: '1 МБ',
    bar: status === 'active' ? 40 : null,
    beta: false,
    problem: null,
    mod,
    groupLabel: null,
  };
}

function statuses(items: StepItem[]): string[] {
  return items.map((item) => (item.kind === 'step' ? `${item.key}:${item.status}` : item.label));
}

describe('steps read top to bottom', () => {
  it('only the top unfinished step runs; what downloads or came below waits under it', () => {
    const shown = inOrder([
      line('done', false, 'files'),
      { kind: 'group', key: 'g', label: 'group' },
      line('done', true, 'voice'),
      line('wait', true, 'emotes'),
      line('active', true, 'api'),
      line('done', true, 'anim'),
      line('wait', false, 'loader'),
    ]);
    expect(statuses(shown)).toEqual([
      'files:done',
      'group',
      'voice:done',
      'emotes:active',
      'api:wait',
      'anim:wait',
      'loader:wait',
    ]);
    const api = shown[4];
    expect(api?.kind === 'step' ? [api.bar, api.right] : null).toEqual([40, '1 МБ']);
    const anim = shown[5];
    expect(anim?.kind === 'step' ? anim.right : null).toBe(ru.mods.downloaded);
  });

  it('a step below the running one that came in full says so, without a bar', () => {
    const full: StepLine = { ...line('active', true, 'api'), right: '2,3 МБ из 2,3 МБ', bar: 100 };
    const shown = inOrder([line('active', true, 'voice'), full]);
    expect(statuses(shown)).toEqual(['voice:active', 'api:wait']);
    const api = shown[1];
    expect(api?.kind === 'step' ? [api.bar, api.right, api.statusText] : null).toEqual([
      null,
      ru.mods.downloaded,
      ru.mods.downloaded,
    ]);
  });

  it('more bytes than the size still fill the bar to the end only', () => {
    const groups = modStepGroups(
      state([step('voice', { role: 'required', status: 'active', bytesDone: 2_000_000 })]),
    );
    expect(groups[0]?.rows[0]?.bar).toBe(100);
  });

  it('a failed step does not hold the done steps below it', () => {
    const shown = inOrder([line('failed', true, 'voice'), line('done', true, 'emotes')]);
    expect(statuses(shown)).toEqual(['voice:failed', 'emotes:done']);
  });

  it('nothing runs when nothing downloads', () => {
    const shown = inOrder([line('done', false, 'files'), line('wait', false, 'loader')]);
    expect(statuses(shown)).toEqual(['files:done', 'loader:wait']);
  });
});
