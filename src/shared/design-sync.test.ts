import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../..');
const pairs = [
  ['design/shared/tokens.css', 'src/renderer/src/styles/tokens.css'],
  ['design/shared/logo.svg', 'src/renderer/src/assets/logo.svg'],
] as const;

describe('design copies in renderer', () => {
  it.each(pairs)('%s equals %s (run scripts/sync-design otherwise)', (source, copy) => {
    expect(readFileSync(resolve(repo, copy), 'utf8')).toBe(
      readFileSync(resolve(repo, source), 'utf8'),
    );
  });
});
