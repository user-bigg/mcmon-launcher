import type { ServerAccess, ServerRow } from '@shared/catalog';
import { ru } from '@shared/i18n/ru';
import type { IconName } from '../components/icons';

type TagKey = keyof typeof ru.tags;

function isTagKey(slug: string): slug is TagKey {
  return Object.hasOwn(ru.tags, slug);
}

export function tagLabel(slug: string): string {
  return isTagKey(slug) ? ru.tags[slug] : ru.tags.other;
}

function tagInline(slug: string): string {
  return isTagKey(slug) ? ru.tagsInline[slug] : ru.tagsInline.other;
}

export function shownTags(slugs: readonly string[]): string[] {
  return slugs.filter((slug) => isTagKey(slug) && slug !== 'other');
}

const VANILLA = 'vanilla';

function hasServerMods(launch: ServerRow['launch']): boolean {
  return (
    launch.kind === 'direct' &&
    launch.mods !== undefined &&
    launch.mods.required.length + launch.mods.optional.length > 0
  );
}

export function serverTags(server: Pick<ServerRow, 'tags' | 'launch'>): string[] {
  const slugs = shownTags(server.tags);
  return hasServerMods(server.launch) ? slugs.filter((slug) => slug !== VANILLA) : slugs;
}

export interface TagView {
  slug: string;
  label: string;
  icon?: IconName;
}

const tagIcons: Partial<Record<string, IconName>> = {
  modded: 'puzzle',
};

export function tagView(slug: string): TagView {
  const icon = tagIcons[slug];
  const label = tagLabel(slug);
  return icon === undefined ? { slug, label } : { slug, label, icon };
}

export function licenseOnly(access: ServerAccess): boolean {
  return !access.nick;
}

export function accessChips(access: ServerAccess): TagView[] {
  return licenseOnly(access)
    ? [{ slug: 'license-only', label: ru.server.licenseOnly, icon: 'shield-check' }]
    : [];
}

export function unstableChip(unstable: boolean): TagView | null {
  return unstable ? { slug: 'unstable', label: ru.server.unstableTag } : null;
}

const RUSSIAN = 'ru';

function isLanguageKey(code: string): code is keyof typeof ru.languages {
  return Object.hasOwn(ru.languages, code);
}

export function languageChip(code: string | null): TagView | null {
  if (code === null || code === RUSSIAN) {
    return null;
  }
  const label = isLanguageKey(code) ? ru.languages[code] : code.toUpperCase();
  return { slug: `language-${code}`, label };
}

export function tagList(slugs: readonly string[]): string {
  return shownTags(slugs).map(tagInline).join(', ');
}
