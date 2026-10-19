import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { isHttpsUrl } from '@shared/links';
import type {
  CatalogModView,
  ModGroup,
  ModsCatalogView,
  ServerModsView,
  ShaderChoice,
  ShaderPackView,
} from '@shared/mods';

export type ShaderPick = Exclude<ShaderChoice, 'off'>;

export const DEFAULT_SHADERS: ShaderPick = 'beautiful';

export interface ShaderRow {
  on: boolean;
  choice: ShaderPick;
  size: number | null;
  credit: string;
  available: boolean;
  options: { value: ShaderPick; label: string }[];
}

export interface ModsGroupView {
  group: ModGroup;
  label: string;
  mods: CatalogModView[];
  shaders: ShaderRow | null;
  on: number;
  total: number;
}

const SHADER_LABELS: Record<ShaderPick, string> = {
  light: ru.mods.shaderLight,
  beautiful: ru.mods.shaderBeautiful,
};

const SHADERS_HOME: ModGroup = 'graphics';

function shaderNeeds(view: ModsCatalogView): Set<string> {
  return new Set(view.shaders?.needs ?? []);
}

function needsBytes(view: ModsCatalogView): number | null {
  const needs = shaderNeeds(view);
  const mods = view.groups.flatMap((group) => group.mods).filter((mod) => needs.has(mod.slug));
  return mods.length === needs.size ? mods.reduce((sum, mod) => sum + (mod.size ?? 0), 0) : null;
}

// The row counts the pack and what the pack itself needs (Iris), as the shaders step of the
// launch does; Sodium below it is a row of its own.
function packBytes(view: ModsCatalogView, pack: ShaderPackView): number | null {
  const needs = needsBytes(view);
  return needs === null || pack.size === null ? pack.totalSize : pack.size + needs;
}

export function shaderRow(
  view: ModsCatalogView,
  last: ShaderPick = DEFAULT_SHADERS,
): ShaderRow | null {
  const shaders = view.shaders;
  if (shaders === null || shaders.packs.length === 0) {
    return null;
  }
  const on = shaders.choice !== 'off';
  const wanted = shaders.choice === 'off' ? last : shaders.choice;
  const pack = shaders.packs.find((item) => item.choice === wanted) ?? shaders.packs[0];
  if (pack === undefined) {
    return null;
  }
  return {
    on,
    choice: pack.choice,
    size: packBytes(view, pack),
    credit: pack.credit ?? fill(ru.mods.shaderPack, { title: pack.title }),
    available: shaders.packs.some((item) => item.available),
    options: shaders.packs.map((item) => ({
      value: item.choice,
      label: SHADER_LABELS[item.choice],
    })),
  };
}

function shadersGroup(view: ModsCatalogView): ModGroup {
  const needs = shaderNeeds(view);
  const home = view.groups.find((group) => group.mods.some((mod) => needs.has(mod.slug)));
  return home?.group ?? SHADERS_HOME;
}

export function modsGroups(
  view: ModsCatalogView,
  last: ShaderPick = DEFAULT_SHADERS,
): ModsGroupView[] {
  const needs = shaderNeeds(view);
  const shaders = shaderRow(view, last);
  const home = shadersGroup(view);
  const groups = view.groups.map((group) => ({
    group: group.group,
    mods: group.mods.filter((mod) => !needs.has(mod.slug)),
  }));
  if (shaders !== null && !groups.some((group) => group.group === home)) {
    groups.push({ group: home, mods: [] });
  }
  return groups
    .map((group): ModsGroupView => {
      const own = group.group === home ? shaders : null;
      const on = group.mods.filter((mod) => mod.enabled).length + (own?.on === true ? 1 : 0);
      return {
        group: group.group,
        label: ru.mods.groups[group.group],
        mods: group.mods,
        shaders: own,
        on,
        total: group.mods.length + (own === null ? 0 : 1),
      };
    })
    .filter((group) => group.total > 0);
}

export function enabledModsCount(view: ModsCatalogView): number {
  return modsGroups(view).reduce((sum, group) => sum + group.on, 0);
}

export function withToggled(view: ModsCatalogView, slug: string, on: boolean): ModsCatalogView {
  return {
    ...view,
    groups: view.groups.map((group) => ({
      ...group,
      mods: group.mods.map((mod) => (mod.slug === slug ? { ...mod, enabled: on } : mod)),
    })),
  };
}

export function withShaders(view: ModsCatalogView, choice: ShaderChoice): ModsCatalogView {
  return view.shaders === null ? view : { ...view, shaders: { ...view.shaders, choice } };
}

export function enabledAfter(enabled: readonly string[], slug: string, on: boolean): string[] {
  const rest = enabled.filter((item) => item !== slug);
  return on ? [...rest, slug] : rest;
}

export function withoutShaderNeeds(view: ModsCatalogView, enabled: readonly string[]): string[] {
  const needs = shaderNeeds(view);
  return enabled.filter((slug) => !needs.has(slug));
}

export type ServerModKind = 'locked' | 'optional' | 'forbidden';

export interface ServerModRow {
  slug: string;
  title: string;
  note: string;
  kind: ServerModKind;
  on: boolean;
  available: boolean;
  size: number | null;
}

function noteOf(kind: ServerModKind, available: boolean): string {
  if (!available && kind !== 'forbidden') {
    return ru.mods.optionalNoFile;
  }
  const notes: Record<ServerModKind, string> = {
    locked: ru.mods.required,
    optional: ru.mods.optional,
    forbidden: ru.mods.forbiddenMark,
  };
  return notes[kind];
}

export function serverModRows(view: ServerModsView): ServerModRow[] {
  return view.mods.flatMap((mod): ServerModRow[] => {
    const kind: ServerModKind | null =
      mod.role === 'required'
        ? 'locked'
        : mod.role === 'optional'
          ? 'optional'
          : mod.role === 'forbidden' && mod.enabled
            ? 'forbidden'
            : null;
    if (kind === null) {
      return [];
    }
    const available = mod.available && mod.state !== 'no_file';
    return [
      {
        slug: mod.slug,
        title: mod.short,
        note: noteOf(kind, available),
        kind,
        on: kind === 'locked' || (kind === 'optional' && mod.state !== 'off_by_player'),
        available,
        size: mod.totalSize ?? mod.size,
      },
    ];
  });
}

const CAPITAL_WORD = /^(?![A-Z])\p{Lu}(?=\p{Ll})/u;

export function inlineName(short: string): string {
  return short.replace(CAPITAL_WORD, (letter) => letter.toLowerCase());
}

export const SUMMARY_NAMES = 2;

export interface NamesOptions {
  limit?: number;
  keepFirst?: boolean;
}

export function namesText(names: readonly string[], options: NamesOptions = {}): string {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const inline = names.map((name, index) =>
    index === 0 && options.keepFirst === true ? name : inlineName(name),
  );
  if (inline.length > limit + 1) {
    return fill(ru.mods.summaryMore, {
      mods: inline.slice(0, limit).join(', '),
      count: inline.length - limit,
    });
  }
  const last = inline.pop();
  if (last === undefined) {
    return '';
  }
  return inline.length === 0 ? last : fill(ru.mods.namesLast, { names: inline.join(', '), last });
}

export function playedServerMods(rows: readonly ServerModRow[]): ServerModRow[] {
  return rows.filter((row) => row.kind !== 'forbidden' && row.on && row.available);
}

export function serverModsBytes(rows: readonly ServerModRow[]): number {
  return playedServerMods(rows).reduce((sum, row) => sum + (row.size ?? 0), 0);
}

export interface ModCreditLine {
  slug: string;
  name: string;
  license: string;
  url: string;
}

const MODRINTH_PROJECT = 'https://modrinth.com/project/';
const MODRINTH_ID = /^[A-Za-z0-9]{8}$/;

// A pair of mods shown as one line (Sodium with its options) is credited once.
function withoutParts(lines: ModCreditLine[]): ModCreditLine[] {
  return lines.filter(
    (line) => !lines.some((other) => other !== line && other.name.includes(line.name)),
  );
}

export function modCredits(view: ModsCatalogView | null): ModCreditLine[] {
  return withoutParts(creditLines(view));
}

function creditLines(view: ModsCatalogView | null): ModCreditLine[] {
  return (view?.credits ?? []).flatMap((mod) => {
    const source = mod.source_url !== null && isHttpsUrl(mod.source_url) ? mod.source_url : null;
    const url =
      source ??
      (MODRINTH_ID.test(mod.modrinth_id) ? `${MODRINTH_PROJECT}${mod.modrinth_id}` : null);
    return url === null
      ? []
      : [{ slug: mod.slug, name: mod.credit ?? mod.title, license: mod.license, url }];
  });
}

export interface SideModState {
  icon: 'lock-fill' | 'slash-circle' | null;
  text: string;
}

export function sideModState(kind: ServerModKind): SideModState {
  const states: Record<ServerModKind, SideModState> = {
    locked: { icon: 'lock-fill', text: ru.mods.sideRequired },
    optional: { icon: null, text: ru.mods.sideOptional },
    forbidden: { icon: 'slash-circle', text: ru.mods.sideForbidden },
  };
  return states[kind];
}
