import { isHttpsUrl } from '@shared/links';

export interface Inline {
  code: boolean;
  text: string;
  url?: string;
}

export type HeadingLevel = 1 | 2 | 3 | 4;

export type Block =
  | { kind: 'paragraph'; parts: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'heading'; level: HeadingLevel; parts: Inline[] };

const HEADING_MARKS = /^(#{1,4}) /;

// Brackets are excluded inside labels and urls: otherwise every '[' or '](' restarts a scan
// to the end of the text, and a 20 KB description freezes the window for seconds.
const IMAGE = /!\[([^[\]]*)\]\([^()]*\)/g;
const LINK = /\[([^[\]]+)\]\(([^()\s]+)\)/g;

function prose(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.replace(IMAGE, '$1').matchAll(LINK)) {
    const [whole, label = '', url = ''] = match;
    parts.push({ code: false, text: match.input.slice(last, match.index) });
    parts.push(isHttpsUrl(url) ? { code: false, text: label, url } : { code: false, text: label });
    last = match.index + whole.length;
  }
  parts.push({ code: false, text: text.replace(IMAGE, '$1').slice(last) });
  return parts;
}

export function inline(text: string): Inline[] {
  return text
    .split('`')
    .flatMap((part, index) => (index % 2 === 1 ? [{ code: true, text: part }] : prose(part)))
    .filter((part) => part.text !== '');
}

function isListLine(line: string): boolean {
  return line.startsWith('- ');
}

function withoutClosingHashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') {
    end -= 1;
  }
  return end < text.length && text[end - 1] === ' ' ? text.slice(0, end).trim() : text;
}

function heading(line: string): Block | null {
  const marks = HEADING_MARKS.exec(line)?.[1];
  const text = marks === undefined ? '' : withoutClosingHashes(line.slice(marks.length).trim());
  if (marks === undefined || text === '') {
    return null;
  }
  return { kind: 'heading', level: marks.length as HeadingLevel, parts: inline(text) };
}

function textBlock(lines: string[]): Block {
  if (lines.every(isListLine)) {
    return { kind: 'list', items: lines.map((line) => inline(line.slice(2))) };
  }
  return { kind: 'paragraph', parts: inline(lines.join(' ')) };
}

function chunkBlocks(chunk: string): Block[] {
  const result: Block[] = [];
  let lines: string[] = [];
  const flush = (): void => {
    if (lines.length > 0) {
      result.push(textBlock(lines));
      lines = [];
    }
  };
  const trimmed = chunk.split('\n').map((item) => item.trim());
  for (const line of trimmed.filter((item) => item !== '')) {
    const title = heading(line);
    if (title === null) {
      lines.push(line);
      continue;
    }
    flush();
    result.push(title);
  }
  flush();
  return result;
}

export function blocks(markdown: string): Block[] {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
    .flatMap(chunkBlocks);
}

const HEADING_TAGS = { 1: 'h4', 2: 'h5', 3: 'h6', 4: 'h6' } as const satisfies Record<
  HeadingLevel,
  string
>;

export function headingTag(level: HeadingLevel): 'h4' | 'h5' | 'h6' {
  return HEADING_TAGS[level];
}

function plain(parts: Inline[]): string {
  return parts
    .map((part) => part.text)
    .join('')
    .trim()
    .toLocaleLowerCase('ru');
}

export function withoutTitle(list: Block[], title: string): Block[] {
  const [first, ...rest] = list;
  const same =
    first?.kind === 'heading' && plain(first.parts) === title.trim().toLocaleLowerCase('ru');
  return same ? rest : list;
}
