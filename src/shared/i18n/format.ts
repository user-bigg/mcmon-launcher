export type PluralForms = readonly [one: string, few: string, many: string];

export interface StringTree {
  readonly [key: string]: string | PluralForms | StringTree;
}

const LOCALE = 'ru-RU';
const pluralRules = new Intl.PluralRules(LOCALE);
const integers = new Intl.NumberFormat(LOCALE);
const decimals = [1, 2].map(
  (digits) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }),
);

export function plural(count: number, forms: PluralForms): string {
  switch (pluralRules.select(count)) {
    case 'one':
      return forms[0];
    case 'many':
      return forms[2];
    default:
      return forms[1];
  }
}

export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function formatNumber(value: number): string {
  return integers.format(value);
}

export function formatDecimal(value: number, digits: 1 | 2 = 1): string {
  return (decimals[digits - 1] ?? integers).format(value);
}

export function countOf(count: number, forms: PluralForms): string {
  return `${formatNumber(count)}\u00a0${plural(count, forms)}`;
}

const THOUSAND = 1000;
const MILLION = 1_000_000;
const ONE_DECIMAL_BELOW = 10;

function shortened(value: number, unit: number, suffix: string): string {
  const scaled = value / unit;
  const kept =
    scaled < ONE_DECIMAL_BELOW ? Math.floor((value * 10) / unit) / 10 : Math.floor(scaled);
  return `${formatDecimal(kept, 1)}${suffix}`;
}

export function compactCount(value: number): string {
  if (value < THOUSAND) return formatNumber(value);
  return value < MILLION ? shortened(value, THOUSAND, 'K') : shortened(value, MILLION, 'M');
}

const SCORE_EXACT_BELOW = 100_000;

export function scoreCount(value: number, whole = value): string {
  return whole < SCORE_EXACT_BELOW ? formatNumber(value) : compactCount(value);
}
