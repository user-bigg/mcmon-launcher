import { readFileSync, writeFileSync } from 'node:fs';
import { getRawHeader } from '@electron/asar';

type Mode = 'content' | 'header' | 'append';

interface FileEntry {
  offset: string;
  size: number;
}

interface DirectoryEntry {
  files: Record<string, DirectoryEntry | FileEntry>;
}

function isMode(value: string): value is Mode {
  return value === 'content' || value === 'header' || value === 'append';
}

function entryAt(root: DirectoryEntry, path: string[]): FileEntry {
  let current: DirectoryEntry | FileEntry = root;
  for (const name of path) {
    if (!('files' in current) || current.files[name] === undefined) {
      throw new Error(`tamper-asar: ${path.join('/')} not found`);
    }
    current = current.files[name];
  }
  if ('files' in current) {
    throw new Error(`tamper-asar: ${path.join('/')} is a directory`);
  }
  return current;
}

function flipped(bytes: Buffer, offset: number): Buffer {
  const copy = Buffer.from(bytes);
  copy[offset] = (copy[offset] ?? 0) ^ 0x01;
  return copy;
}

export function tamper(file: string, mode: Mode): void {
  const bytes = readFileSync(file);
  if (mode === 'append') {
    writeFileSync(file, Buffer.concat([bytes, Buffer.from('x')]));
    return;
  }
  const raw = getRawHeader(file);
  if (mode === 'header') {
    const at = bytes.indexOf(raw.headerString) + raw.headerString.indexOf('"index.js"') + 1;
    writeFileSync(file, flipped(bytes, at));
    return;
  }
  const entry = entryAt(raw.header, ['out', 'main', 'index.js']);
  const at = 8 + raw.headerSize + Number(entry.offset) + Math.floor(entry.size / 2);
  writeFileSync(file, flipped(bytes, at));
}

const [file, mode = 'content'] = process.argv.slice(2);
if (file === undefined || !isMode(mode)) {
  console.error('tamper-asar: usage: tamper-asar.ts <app.asar> [content|header|append]');
  process.exit(2);
}
tamper(file, mode);
console.log(`tamper-asar: ${mode} changed in ${file}`);
