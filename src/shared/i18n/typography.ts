const NBSP = '\u00a0';
const LONG_TEXT = 40;

const BEFORE_DASH = / (?=—)/g;
const NUMBER_WORD = /(?<=\d) (?=[А-Яа-яЁё%])/g;
const PLACEHOLDER_UNIT = /(?<=\}) (?=(?:ГБ|МБ|КБ|мс|мин|ч)(?![А-Яа-яЁё]))/g;
const SHORT_WORD =
  /(?<=(?:^|[\s(«„])(?:в|во|с|со|к|ко|о|об|у|и|а|на|по|за|до|от|не|ни|но|из|для)) /giu;

export function typeset(text: string): string {
  const glued = text
    .replace(BEFORE_DASH, NBSP)
    .replace(NUMBER_WORD, NBSP)
    .replace(PLACEHOLDER_UNIT, NBSP);
  return glued.length >= LONG_TEXT ? glued.replace(SHORT_WORD, NBSP) : glued;
}

type Tree = string | readonly string[] | { readonly [key: string]: Tree };

function typesetValue(value: Tree): Tree {
  if (typeof value === 'string') {
    return typeset(value);
  }
  if (Array.isArray(value)) {
    return value.map((item: string) => typeset(item));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, typesetValue(child)]),
  );
}

export function typesetTree<T extends Readonly<Record<string, Tree>>>(tree: T): T {
  return typesetValue(tree) as T;
}
