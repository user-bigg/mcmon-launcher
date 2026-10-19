import { describe, expect, it } from 'vitest';
import { blocks, inline, type Block, type Inline } from './markdown';

const MAX_MARKDOWN = 20_000;
const BUDGET_MS = 100;

function parts(list: Block[]): Inline[] {
  return list.flatMap((block) => (block.kind === 'list' ? block.items.flat() : block.parts));
}

function urls(markdown: string): string[] {
  return parts(blocks(markdown)).flatMap((part) => (part.url === undefined ? [] : [part.url]));
}

function elapsedMs(markdown: string): number {
  const started = performance.now();
  blocks(markdown);
  return performance.now() - started;
}

describe('parsing a server description with hostile input', () => {
  it('links only https: javascript:, data:, file:, vbscript: and relative ones — no link', () => {
    const hostile = [
      '[a](javascript:alert(1))',
      '[a](JaVaScRiPt:alert(1))',
      '[a](  javascript:alert(1))',
      '[a](java\tscript:alert(1))',
      '[a](data:text/html,<script>alert(1)</script>)',
      '[a](file:///C:/Windows/System32/calc.exe)',
      '[a](vbscript:msgbox)',
      '[a](//evil.example/x)',
      '[a](app://launcher/index.html)',
      '[a](mcmonitor://play/1)',
      '[a](http://evil.example)',
      '[a](\\\\evil\\share)',
    ];
    for (const markdown of hostile) {
      expect(urls(markdown)).toEqual([]);
    }
  });

  it('nested links and images do not produce non-https addresses', () => {
    const nested = [
      '[[x](javascript:alert(1))](https://ok.example)',
      '[![x](javascript:alert(1))](https://ok.example)',
      '![[x](https://ok.example)](javascript:alert(1))',
      '[a](https://ok.example)(javascript:alert(1))',
      '[a]([b](javascript:alert(1)))',
    ];
    for (const markdown of nested) {
      for (const url of urls(markdown)) {
        expect(new URL(url).protocol).toBe('https:');
      }
    }
  });

  it('HTML and templates remain plain text', () => {
    const markdown =
      '<script>alert(1)</script> <img src=x onerror=alert(1)> <svg onload=alert(1)> {{ 7*7 }} ${7*7} %s \u0000 \u202Eexe.txt';
    const text = parts(blocks(markdown))
      .map((part) => part.text)
      .join('');
    expect(text).toBe(markdown);
    expect(parts(blocks(markdown)).every((part) => part.url === undefined)).toBe(true);
  });

  it('images do not turn into a download: only the caption remains', () => {
    expect(inline('![<img src=x onerror=alert(1)>](https://evil.example/t.png)')).toEqual([
      { code: false, text: '<img src=x onerror=alert(1)>' },
    ]);
  });

  it('a giant description parses in linear time', () => {
    const n = MAX_MARKDOWN;
    const hostile: Record<string, string> = {
      heading: `# a${' '.repeat(n)}b`,
      headingSeparator: `# ${' '.repeat(n)}\u2028`,
      brackets: '['.repeat(n),
      openLinks: '[a]('.repeat(n / 4),
      images: '!['.repeat(n / 2),
      openImages: '![]('.repeat(n / 4),
      backticks: '`'.repeat(n),
      list: Array.from({ length: n / 3 }, () => '- a').join('\n'),
      hashes: `# a${' #'.repeat(n / 2)} b`,
    };
    const slow = Object.entries(hostile).filter(([, markdown]) => elapsedMs(markdown) > BUDGET_MS);
    expect(slow.map(([name]) => name)).toEqual([]);
  });
});
