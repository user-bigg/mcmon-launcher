import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { LaunchStepStatus } from '@shared/launch';
import type { ModRole, ModsStepState, ModStep } from '@shared/mods';
import type { IconName } from '../components/icons';
import { namesText } from './mods';
import { shortModVersion } from './mod-version';
import { formatModSize } from './units';

export type ModProblem = 'required' | 'optional' | null;

export interface ModStepRow {
  key: string;
  status: LaunchStepStatus;
  icon: IconName;
  title: string;
  note: string;
  beta: boolean;
  right: string | null;
  bar: number | null;
  problem: ModProblem;
}

export type ModStepGroupKey = 'server' | 'player';

export interface ModStepGroup {
  key: ModStepGroupKey;
  label: string;
  rows: ModStepRow[];
}

type Owner = 'server' | 'player' | 'shaders';

const OWNERS: Record<ModRole, Owner> = {
  required: 'server',
  optional: 'server',
  player: 'player',
  shaders: 'shaders',
};

const OWNER_RANK: Owner[] = ['server', 'player', 'shaders'];

const STATUS_ICONS: Record<LaunchStepStatus, IconName> = {
  wait: 'three-dots',
  active: 'arrow-down',
  done: 'check-lg',
  skipped: 'dash-lg',
  failed: 'exclamation-lg',
};

const PERCENT = 100;

function rootsOf(
  step: ModStep,
  bySlug: ReadonlyMap<string, ModStep>,
  seen = new Set<string>(),
): ModStep[] {
  if (step.role !== 'dependency') {
    return [step];
  }
  seen.add(step.slug);
  return step.dependencyOf.flatMap((slug) => {
    const parent = bySlug.get(slug);
    return parent === undefined || seen.has(slug) ? [] : rootsOf(parent, bySlug, seen);
  });
}

function rootOwners(step: ModStep, bySlug: ReadonlyMap<string, ModStep>): Set<Owner> {
  return new Set(
    rootsOf(step, bySlug).map((root) => OWNERS[root.role === 'dependency' ? 'player' : root.role]),
  );
}

// The shaders step holds the pack and what the pack itself needs (Iris), as the shaders row of
// the mods section counts it; deeper libraries go with the mods of the player.
function ownerOf(step: ModStep, bySlug: ReadonlyMap<string, ModStep>): Owner {
  if (step.role !== 'dependency') {
    return OWNERS[step.role];
  }
  const owners = rootOwners(step, bySlug);
  const top = OWNER_RANK.find((owner) => owners.has(owner)) ?? 'player';
  const direct = step.dependencyOf.some((slug) => bySlug.get(slug)?.role === 'shaders');
  return top === 'shaders' && !direct ? 'player' : top;
}

function requiredRoot(step: ModStep, bySlug: ReadonlyMap<string, ModStep>): boolean {
  return rootsOf(step, bySlug).some((root) => root.role === 'required');
}

function aggregateStatus(steps: readonly ModStep[]): LaunchStepStatus {
  const statuses = new Set(steps.map((step) => step.status));
  if (statuses.size === 1) {
    return steps[0]?.status ?? 'wait';
  }
  return statuses.has('active') || statuses.has('done') ? 'active' : 'wait';
}

function sizes(steps: readonly ModStep[]): { done: number; total: number } {
  return steps
    .filter((step) => !step.fromDisk)
    .reduce((sum, step) => ({ done: sum.done + step.bytesDone, total: sum.total + step.size }), {
      done: 0,
      total: 0,
    });
}

function rightOf(steps: readonly ModStep[], status: LaunchStepStatus): string | null {
  const { done, total } = sizes(steps);
  if (status === 'done' && total === 0) {
    return ru.mods.onDisk;
  }
  if (status === 'active' && total > 0) {
    return fill(ru.mods.bytes, { done: formatModSize(done), total: formatModSize(total) });
  }
  const all = steps.reduce((sum, step) => sum + step.size, 0);
  return all > 0 ? formatModSize(all) : null;
}

function barOf(steps: readonly ModStep[], status: LaunchStepStatus): number | null {
  const { done, total } = sizes(steps);
  return status === 'active' && total > 0
    ? Math.min(PERCENT, Math.floor((done * PERCENT) / total))
    : null;
}

function noteOf(step: ModStep): string {
  return (
    step.credit ??
    fill(ru.mods.stepNote, { title: step.title, version: shortModVersion(step.version) })
  );
}

function plainRow(key: string, steps: readonly ModStep[], title: string, note: string): ModStepRow {
  const status = aggregateStatus(steps);
  return {
    key,
    status,
    icon: STATUS_ICONS[status],
    title,
    note,
    beta: steps.some((step) => step.channel === 'beta'),
    right: rightOf(steps, status),
    bar: barOf(steps, status),
    problem: null,
  };
}

function failedRow(step: ModStep, bySlug: ReadonlyMap<string, ModStep>): ModStepRow {
  const owner = ownerOf(step, bySlug);
  const required = requiredRoot(step, bySlug);
  const problem: ModProblem = owner !== 'server' ? null : required ? 'required' : 'optional';
  return {
    key: step.slug,
    status: 'failed',
    icon: STATUS_ICONS.failed,
    title: fill(ru.mods.failedTitle, { mod: step.short }),
    note: owner === 'server' ? noteOf(step) : ru.mods.failedPlayer,
    beta: step.channel === 'beta',
    right: formatModSize(step.size),
    bar: null,
    problem,
  };
}

function leftOutRow(step: ModStep): ModStepRow {
  return {
    key: step.slug,
    status: 'skipped',
    icon: 'slash-circle',
    title: fill(ru.mods.skippedTitle.failed, { mod: step.short }),
    note: ru.mods.leftOut,
    beta: false,
    right: ru.mods.skip,
    bar: null,
    problem: null,
  };
}

function parentName(slug: string, bySlug: ReadonlyMap<string, ModStep>): string {
  const parent = bySlug.get(slug);
  if (parent === undefined) {
    return slug;
  }
  return ownerOf(parent, bySlug) === 'server' ? parent.short : parent.title;
}

function dependencyRows(
  steps: readonly ModStep[],
  bySlug: ReadonlyMap<string, ModStep>,
): ModStepRow[] {
  const groups = new Map<string, ModStep[]>();
  for (const step of steps) {
    const key = step.dependencyOf.join(',');
    groups.set(key, [...(groups.get(key) ?? []), step]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const parents = (members[0]?.dependencyOf ?? []).map((slug) => parentName(slug, bySlug));
    const note =
      parents.length === 1
        ? fill(ru.mods.dependencyOne, { mods: parents[0] ?? '' })
        : fill(ru.mods.dependencyMany, { mods: parents.map((name) => `«${name}»`).join(', ') });
    return plainRow(
      `deps:${key}`,
      members,
      namesText(
        members.map((step) => step.short),
        { keepFirst: true },
      ),
      note,
    );
  });
}

function skippedRows(state: ModsStepState, owner: ModStepGroupKey): ModStepRow[] {
  return state.skipped.flatMap((item) => {
    const { state: why } = item;
    if (why === 'on' || (OWNERS[item.role] === 'server' ? 'server' : 'player') !== owner) {
      return [];
    }
    return [
      {
        key: `skip:${item.slug}`,
        status: 'skipped' as const,
        icon: why === 'forbidden' ? ('slash-circle' as const) : ('dash-lg' as const),
        title: fill(ru.mods.skippedTitle[why], { mod: item.short }),
        note: ru.mods.skippedNote[why],
        beta: false,
        right: ru.mods.skip,
        bar: null,
        problem: null,
      },
    ];
  });
}

function serverRows(state: ModsStepState, bySlug: ReadonlyMap<string, ModStep>): ModStepRow[] {
  const mine = state.steps.filter((step) => ownerOf(step, bySlug) === 'server');
  const healthy = mine.filter((step) => step.status !== 'failed' && step.status !== 'skipped');
  const own = healthy
    .filter((step) => step.role !== 'dependency')
    .map((step) => plainRow(step.slug, [step], step.short, noteOf(step)));
  const deps = dependencyRows(
    healthy.filter((step) => step.role === 'dependency'),
    bySlug,
  );
  const failed = mine
    .filter((step) => step.status === 'failed')
    .map((step) => failedRow(step, bySlug));
  const leftOut = mine.filter((step) => step.status === 'skipped').map(leftOutRow);
  return [...failed, ...own, ...deps, ...leftOut, ...skippedRows(state, 'server')];
}

function playerRows(state: ModsStepState, bySlug: ReadonlyMap<string, ModStep>): ModStepRow[] {
  const owned = (owner: Owner): ModStep[] =>
    state.steps.filter(
      (step) =>
        ownerOf(step, bySlug) === owner && step.status !== 'failed' && step.status !== 'skipped',
    );
  const player = owned('player');
  const shaders = owned('shaders');
  const pack = shaders.find((step) => step.role === 'shaders');
  const rows: ModStepRow[] = [];
  const named = player.filter(
    (step) => step.role === 'player' || !rootOwners(step, bySlug).has('player'),
  );
  if (named.length > 0) {
    const title = namesText(
      named.map((step) => step.title),
      { keepFirst: true },
    );
    rows.push(plainRow('player', player, title, ru.mods.playerNote));
  }
  if (pack !== undefined) {
    rows.push(plainRow('shaders', shaders, pack.short, noteOf(pack)));
  }
  const mine = state.steps.filter((step) => ownerOf(step, bySlug) !== 'server');
  return [
    ...rows,
    ...mine.filter((step) => step.status === 'failed').map((step) => failedRow(step, bySlug)),
    ...mine.filter((step) => step.status === 'skipped').map(leftOutRow),
    ...skippedRows(state, 'player'),
  ];
}

export function modStepGroups(state: ModsStepState | undefined): ModStepGroup[] {
  if (state === undefined) {
    return [];
  }
  const bySlug = new Map(state.steps.map((step) => [step.slug, step]));
  const groups: ModStepGroup[] = [
    { key: 'server', label: ru.mods.groupServer, rows: serverRows(state, bySlug) },
    { key: 'player', label: ru.mods.groupPlayer, rows: playerRows(state, bySlug) },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

export function blocksLaunch(groups: readonly ModStepGroup[]): boolean {
  return groups.some((group) => group.rows.some((row) => row.problem === 'required'));
}

export interface StepLine {
  kind: 'step';
  key: string;
  status: LaunchStepStatus;
  icon: IconName;
  title: string;
  note: string;
  statusText: string;
  right: string;
  bar: number | null;
  beta: boolean;
  problem: ModProblem;
  mod: boolean;
  groupLabel: string | null;
}

export interface GroupLine {
  kind: 'group';
  key: string;
  label: string;
}

export type StepItem = StepLine | GroupLine;

export function modLines(groups: readonly ModStepGroup[]): StepItem[] {
  return groups.flatMap((group): StepItem[] => [
    { kind: 'group', key: `group:${group.key}`, label: group.label },
    ...group.rows.map((row, index): StepLine => ({
      ...row,
      kind: 'step',
      key: `mod:${row.key}`,
      statusText: ru.install.stepStatus[row.status],
      right: row.right ?? '',
      mod: true,
      groupLabel: index === 0 ? group.label : null,
    })),
  ]);
}

function unfinished(line: StepLine): boolean {
  return line.status === 'wait' || line.status === 'active';
}

// Main fetches several things at once, but the list reads top to bottom: only the top step that
// is not done is shown as running, and what comes or came below it waits under it.
export function inOrder(items: readonly StepItem[]): StepItem[] {
  const lines = items.filter((item): item is StepLine => item.kind === 'step');
  const first = lines.findIndex(unfinished);
  const busy = first >= 0 && lines.slice(first).some((line) => line.status === 'active');
  let index = -1;
  return items.map((item): StepItem => {
    if (item.kind !== 'step') {
      return item;
    }
    index += 1;
    if (first < 0 || index < first) {
      return item;
    }
    if (index === first) {
      return busy && item.status === 'wait'
        ? {
            ...item,
            status: 'active',
            icon: STATUS_ICONS.active,
            statusText: ru.install.stepStatus.active,
          }
        : item;
    }
    if (item.mod && (item.status === 'done' || (item.bar ?? 0) >= PERCENT)) {
      return {
        ...item,
        status: 'wait',
        icon: STATUS_ICONS.wait,
        statusText: ru.mods.downloaded,
        right: ru.mods.downloaded,
        bar: null,
      };
    }
    if (item.status === 'active') {
      return {
        ...item,
        status: 'wait',
        icon: STATUS_ICONS.wait,
        statusText: ru.install.stepStatus.wait,
      };
    }
    return item;
  });
}
