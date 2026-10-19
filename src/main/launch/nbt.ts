export const NBT_BYTE = 1;
export const NBT_INT = 3;
export const NBT_STRING = 8;
export const NBT_LIST = 9;
export const NBT_COMPOUND = 10;

const NBT_END = 0;
const NBT_BYTE_ARRAY = 7;
const NBT_INT_ARRAY = 11;
const NBT_LONG_ARRAY = 12;
const MAX_DEPTH = 512;
// A real list, even with a hundred icons, is a few thousand tags; a crafted 8 MB file of
// empty tags would otherwise cost a gigabyte of objects.
const MAX_TAGS = 100_000;
const FIXED_SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 };
const ARRAY_ITEM_SIZES: Readonly<Record<number, number>> = {
  [NBT_BYTE_ARRAY]: 1,
  [NBT_INT_ARRAY]: 4,
  [NBT_LONG_ARRAY]: 8,
};

// Numbers and arrays stay as the bytes they were read from, so a tag the launcher does not
// understand is written back bit for bit.
export interface NbtRaw {
  type: number;
  bytes: Buffer;
}

export interface NbtText {
  type: typeof NBT_STRING;
  value: string;
}

export interface NbtList {
  type: typeof NBT_LIST;
  elementType: number;
  items: NbtTag[];
}

export interface NbtCompound {
  type: typeof NBT_COMPOUND;
  entries: [string, NbtTag][];
}

export type NbtTag = NbtRaw | NbtText | NbtList | NbtCompound;

export interface NbtFile {
  name: string;
  root: NbtCompound;
}

export class NbtFormatError extends Error {}

export function isNbtText(tag: NbtTag | undefined): tag is NbtText {
  return tag?.type === NBT_STRING;
}

export function isNbtList(tag: NbtTag | undefined): tag is NbtList {
  return tag?.type === NBT_LIST;
}

export function isNbtCompound(tag: NbtTag | undefined): tag is NbtCompound {
  return tag?.type === NBT_COMPOUND;
}

export function nbtText(value: string): NbtText {
  return { type: NBT_STRING, value };
}

export function nbtByte(value: number): NbtRaw {
  return { type: NBT_BYTE, bytes: Buffer.from([value & 0xff]) };
}

export function nbtCompound(entries: [string, NbtTag][]): NbtCompound {
  return { type: NBT_COMPOUND, entries };
}

export function nbtField(compound: NbtCompound, key: string): NbtTag | undefined {
  return compound.entries.find(([name]) => name === key)?.[1];
}

export function withNbtField(compound: NbtCompound, key: string, tag: NbtTag): NbtCompound {
  const replaced = compound.entries.some(([name]) => name === key);
  const entries: [string, NbtTag][] = replaced
    ? compound.entries.map(([name, old]) => [name, name === key ? tag : old])
    : [...compound.entries, [key, tag]];
  return nbtCompound(entries);
}

// Java's DataOutput.writeUTF: every UTF-16 code unit on its own (a surrogate pair is two
// three-byte sequences), and U+0000 as two bytes. Buffer's 'utf8' would rewrite such strings.
function decodeJavaText(bytes: Buffer): string {
  const units: number[] = [];
  let at = 0;
  const continuation = (): number => {
    const byte = bytes[at];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      throw new NbtFormatError('malformed string');
    }
    at += 1;
    return byte & 0x3f;
  };
  while (at < bytes.length) {
    const lead = bytes[at] ?? 0;
    at += 1;
    if (lead < 0x80) {
      units.push(lead);
    } else if ((lead & 0xe0) === 0xc0) {
      units.push(((lead & 0x1f) << 6) | continuation());
    } else if ((lead & 0xf0) === 0xe0) {
      const high = continuation();
      units.push(((lead & 0x0f) << 12) | (high << 6) | continuation());
    } else {
      throw new NbtFormatError('malformed string');
    }
  }
  let text = '';
  for (let start = 0; start < units.length; start += 4096) {
    text += String.fromCharCode(...units.slice(start, start + 4096));
  }
  return text;
}

function encodeJavaText(text: string): Buffer {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0x01 && unit <= 0x7f) {
      bytes.push(unit);
    } else if (unit <= 0x7ff) {
      bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
    } else {
      bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
    }
  }
  if (bytes.length > 0xffff) {
    throw new NbtFormatError('string too long');
  }
  return Buffer.from(bytes);
}

class Reader {
  private at = 0;
  private tags = 0;

  constructor(private readonly data: Buffer) {}

  countTag(): void {
    this.tags += 1;
    if (this.tags > MAX_TAGS) {
      throw new NbtFormatError('too many tags');
    }
  }

  get finished(): boolean {
    return this.at === this.data.length;
  }

  take(length: number): Buffer {
    if (length < 0 || this.at + length > this.data.length) {
      throw new NbtFormatError('unexpected end of data');
    }
    const slice = this.data.subarray(this.at, this.at + length);
    this.at += length;
    return slice;
  }

  byte(): number {
    return this.take(1).readUInt8(0);
  }

  int(): number {
    return this.take(4).readInt32BE(0);
  }

  text(): string {
    return decodeJavaText(this.take(this.take(2).readUInt16BE(0)));
  }
}

function readArray(reader: Reader, type: number, itemSize: number): NbtRaw {
  const count = reader.int();
  if (count < 0) {
    throw new NbtFormatError('negative array length');
  }
  const head = Buffer.alloc(4);
  head.writeInt32BE(count);
  return { type, bytes: Buffer.concat([head, reader.take(count * itemSize)]) };
}

function readList(reader: Reader, depth: number): NbtList {
  const elementType = reader.byte();
  const count = reader.int();
  if (count < 0 || (elementType === NBT_END && count > 0)) {
    throw new NbtFormatError('malformed list');
  }
  const items: NbtTag[] = [];
  for (let index = 0; index < count; index += 1) {
    items.push(readPayload(reader, elementType, depth + 1));
  }
  return { type: NBT_LIST, elementType, items };
}

function readCompound(reader: Reader, depth: number): NbtCompound {
  const entries: [string, NbtTag][] = [];
  for (let type = reader.byte(); type !== NBT_END; type = reader.byte()) {
    const name = reader.text();
    entries.push([name, readPayload(reader, type, depth + 1)]);
  }
  return nbtCompound(entries);
}

function readPayload(reader: Reader, type: number, depth: number): NbtTag {
  if (depth > MAX_DEPTH) {
    throw new NbtFormatError('nesting too deep');
  }
  reader.countTag();
  const fixed = FIXED_SIZES[type];
  if (fixed !== undefined) {
    return { type, bytes: Buffer.from(reader.take(fixed)) };
  }
  const itemSize = ARRAY_ITEM_SIZES[type];
  if (itemSize !== undefined) {
    return readArray(reader, type, itemSize);
  }
  if (type === NBT_STRING) {
    return nbtText(reader.text());
  }
  if (type === NBT_LIST) {
    return readList(reader, depth);
  }
  if (type === NBT_COMPOUND) {
    return readCompound(reader, depth);
  }
  throw new NbtFormatError(`unknown tag type ${String(type)}`);
}

export function parseNbt(data: Buffer): NbtFile {
  const reader = new Reader(data);
  if (reader.byte() !== NBT_COMPOUND) {
    throw new NbtFormatError('root is not a compound');
  }
  const name = reader.text();
  const root = readCompound(reader, 0);
  if (!reader.finished) {
    throw new NbtFormatError('data after the root tag');
  }
  return { name, root };
}

function textBytes(text: string): Buffer {
  const body = encodeJavaText(text);
  const head = Buffer.alloc(2);
  head.writeUInt16BE(body.length);
  return Buffer.concat([head, body]);
}

function writePayload(tag: NbtTag, out: Buffer[]): void {
  if (isNbtText(tag)) {
    out.push(textBytes(tag.value));
  } else if (isNbtList(tag)) {
    const head = Buffer.alloc(5);
    head.writeUInt8(tag.items.length === 0 ? tag.elementType : (tag.items[0]?.type ?? NBT_END));
    head.writeInt32BE(tag.items.length, 1);
    out.push(head);
    for (const item of tag.items) {
      if (item.type !== tag.items[0]?.type) {
        throw new NbtFormatError('mixed list');
      }
      writePayload(item, out);
    }
  } else if (isNbtCompound(tag)) {
    for (const [name, child] of tag.entries) {
      out.push(Buffer.from([child.type]), textBytes(name));
      writePayload(child, out);
    }
    out.push(Buffer.from([NBT_END]));
  } else {
    out.push(tag.bytes);
  }
}

export function serializeNbt(file: NbtFile): Buffer {
  const out: Buffer[] = [Buffer.from([NBT_COMPOUND]), textBytes(file.name)];
  writePayload(file.root, out);
  return Buffer.concat(out);
}
