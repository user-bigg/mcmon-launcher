import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = import.meta.dirname;
const sourceExtensions = /\.(vue|ts|css|html)$/;
const skipped = [
  /^src\/mock\//,
  /^src\/assets\//,
  /^src\/styles\/tokens\.css$/,
  /\.test\.ts$/,
  /^renderer-rules\.test\.ts$/,
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(root)
  .map((path) => relative(root, path).split(sep).join('/'))
  .filter((path) => sourceExtensions.test(path))
  .filter((path) => !skipped.some((pattern) => pattern.test(path)));

function source(file: string): string {
  return readFileSync(join(root, file), 'utf8');
}

function styleOf(file: string): string {
  const text = source(file);
  if (file.endsWith('.css')) {
    return text;
  }
  const start = text.indexOf('<style');
  return start === -1 ? '' : text.slice(start);
}

interface Declaration {
  where: string;
  property: string;
  value: string;
  scopes: string[];
}

function declarations(file: string): Declaration[] {
  const css = styleOf(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const result: Declaration[] = [];
  const scopes: string[] = [];
  let buffer = '';
  for (const char of css) {
    if (char === '{') {
      scopes.push(buffer.trim());
      buffer = '';
    } else if (char === '}') {
      scopes.pop();
      buffer = '';
    } else if (char === ';') {
      const colon = buffer.indexOf(':');
      if (colon > 0) {
        result.push({
          where: `${file}: ${buffer.trim().replace(/\s+/g, ' ')}`,
          property: buffer.slice(0, colon).trim(),
          value: buffer.slice(colon + 1).trim(),
          scopes: [...scopes],
        });
      }
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return result;
}

const allDeclarations = files.flatMap(declarations);

function offending(pattern: RegExp, text: (file: string) => string = source): string[] {
  return files.flatMap((file) =>
    text(file)
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${file}:${String(index + 1)}: ${line.trim()}`] : [],
      ),
  );
}

function badDeclarations(property: RegExp, isAllowed: (value: string) => boolean): string[] {
  return allDeclarations
    .filter((item) => property.test(item.property) && !isAllowed(item.value))
    .map((item) => item.where);
}

const NAMED_COLORS =
  /(^|[\s,(])(black|white|red|green|blue|yellow|orange|purple|gray|grey|silver|navy|teal|maroon|lime|aqua|fuchsia|olive|pink|brown|gold)([\s,)]|$)/;

describe('renderer sources', () => {
  it('the check sees files and styles', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(allDeclarations.length).toBeGreaterThan(500);
  });

  it('Russian strings only in src/shared/i18n (mock data and tests do not count)', () => {
    expect(offending(/[Ѐ-ӿ]/)).toEqual([]);
  });

  it('colors only from tokens.css: no hex, no rgb/hsl/oklch, no named colors', () => {
    expect(offending(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/)).toEqual([]);
    expect(allDeclarations.filter((item) => NAMED_COLORS.test(item.value))).toEqual([]);
  });

  it('markup is not inserted as a string', () => {
    expect(offending(/v-html|innerHTML|outerHTML|insertAdjacentHTML/)).toEqual([]);
  });

  it('components and screens get data through composables, not from the mock', () => {
    const direct = files
      .filter((file) => /^src\/(components|screens)\//.test(file))
      .filter((file) => source(file).includes("from '../mock/"));
    expect(direct).toEqual([]);
  });

  it('animations: only transform and opacity, and only without reduced-motion', () => {
    const guarded = (item: Declaration): boolean =>
      item.scopes.some((scope) => /prefers-reduced-motion:\s*no-preference/.test(scope));
    const frames = allDeclarations.filter((item) =>
      item.scopes.some((scope) => scope.startsWith('@keyframes')),
    );
    const animations = allDeclarations.filter(
      (item) => item.property.startsWith('animation') && !frames.includes(item),
    );
    expect(
      frames
        .filter((item) => !/^(transform|opacity|animation-timing-function)$/.test(item.property))
        .map((i) => i.where),
    ).toEqual([]);
    expect(animations.filter((item) => !guarded(item)).map((item) => item.where)).toEqual([]);
    const transitions = allDeclarations.filter((item) => item.property.startsWith('transition'));
    const wrongProperty = transitions.filter((item) => {
      if (item.property === 'transition-property') {
        return item.value.split(',').some((part) => !/^(transform|opacity)$/.test(part.trim()));
      }
      if (item.property !== 'transition') {
        return false;
      }
      return item.value.split(',').some((part) => !/^(transform|opacity)\b/.test(part.trim()));
    });
    const unguarded = transitions.filter((item) => !guarded(item));
    expect(wrongProperty.map((item) => item.where)).toEqual([]);
    expect(unguarded.map((item) => item.where)).toEqual([]);
  });

  it('radii only via --mc-radius* tokens, a circle at 50% and a pill at 999px', () => {
    expect(
      badDeclarations(
        /^border(-[a-z]+)?-radius$/,
        (value) =>
          value.includes('var(--mc-radius') ||
          value.split(/\s+/).every((part) => /^(0|50%|999px|inherit)$/.test(part)),
      ),
    ).toEqual([]);
  });

  it('shadows only via --mc-shadow or color tokens (through variables)', () => {
    expect(
      badDeclarations(
        /^box-shadow$|^filter$/,
        (value) => value === 'none' || value.includes('var(--'),
      ),
    ).toEqual([]);
  });

  it('font size is an integer and no less than 11px, weights 400/600/700, fonts via tokens', () => {
    expect(
      badDeclarations(/^font-size$/, (value) => {
        const px = /^(\d+)px$/.exec(value);
        return px !== null && Number(px[1]) >= 11;
      }),
    ).toEqual([]);
    expect(badDeclarations(/^font-weight$/, (value) => /^(400|600|700)$/.test(value))).toEqual([]);
    expect(
      badDeclarations(/^font-family$/, (value) => /^var\(--mc-font-[a-z]+\)$/.test(value)),
    ).toEqual([]);
  });
});
