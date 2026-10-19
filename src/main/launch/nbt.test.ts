import { describe, expect, it } from 'vitest';
import {
  isNbtCompound,
  isNbtList,
  isNbtText,
  nbtField,
  NbtFormatError,
  parseNbt,
  serializeNbt,
} from './nbt';

function hex(...parts: string[]): Buffer {
  return Buffer.from(parts.join('').replace(/\s+/g, ''), 'hex');
}

function text(value: string): string {
  const body = Buffer.from(value, 'utf8');
  return body.length.toString(16).padStart(4, '0') + body.toString('hex');
}

// Laid out as the game itself wrote the list (1.21.11 and 26.1, quick play): unnamed root
// compound, list "servers" of compounds, keys hidden, ip, name.
const GAME_WRITTEN_LIST = hex(
  '0a 0000',
  `09 ${text('servers')} 0a 00000001`,
  `01 ${text('hidden')} 01`,
  `08 ${text('ip')} ${text('play.example.org:25565')}`,
  `08 ${text('name')} ${text('Minecraft Server')}`,
  '00',
  '00',
);

describe('uncompressed NBT', () => {
  it('reads a list written by the game and writes it back byte for byte', () => {
    const file = parseNbt(GAME_WRITTEN_LIST);
    expect(file.name).toBe('');
    const servers = nbtField(file.root, 'servers');
    expect(isNbtList(servers) && servers.items.length).toBe(1);
    const entry = isNbtList(servers) ? servers.items[0] : undefined;
    const ip = isNbtCompound(entry) ? nbtField(entry, 'ip') : undefined;
    expect(isNbtText(ip) && ip.value).toBe('play.example.org:25565');
    expect(serializeNbt(file).equals(GAME_WRITTEN_LIST)).toBe(true);
  });

  it('keeps every tag type it does not interpret', () => {
    const all = hex(
      '0a 0000',
      `02 ${text('short')} 7fff`,
      `03 ${text('int')} 80000000`,
      `04 ${text('long')} 7fffffffffffffff`,
      `05 ${text('float')} 7fc00001`,
      `06 ${text('double')} 7ff8000000000001`,
      `07 ${text('bytes')} 00000002 01ff`,
      `0b ${text('ints')} 00000001 00000007`,
      `0c ${text('longs')} 00000001 0000000000000009`,
      `09 ${text('empty')} 00 00000000`,
      `09 ${text('nested')} 09 00000001 08 00000001 ${text('x')}`,
      '00',
    );
    expect(serializeNbt(parseNbt(all)).equals(all)).toBe(true);
  });

  it('keeps Java strings: a pair of surrogates and U+0000 in the two-byte form', () => {
    const java = hex('0a 0000', `08 ${text('name')} 0008 eda0bdedb880 c080`, '00');
    const file = parseNbt(java);
    const name = nbtField(file.root, 'name');
    expect(isNbtText(name) && name.value).toBe('\u{1f600}\u0000');
    expect(serializeNbt(file).equals(java)).toBe(true);
  });

  it.each([
    ['empty file', ''],
    ['gzip header', '1f8b0800000000000000'],
    ['cut in the middle of an entry', '0a0000090007736572766572730a00000001010006'],
    ['no end of the root', '0a0000'],
    ['bytes after the root', '0a000000ff'],
    ['unknown tag type', '0a00000d00016100'],
    ['negative list length', '0a0000090001610affffffff00'],
    ['broken string', `0a0000080001610001c000`],
  ])('refuses a damaged file: %s', (_label, data) => {
    expect(() => parseNbt(Buffer.from(data, 'hex'))).toThrow(NbtFormatError);
  });

  it('refuses a list of more tags than any real file has', () => {
    const count = 100_001;
    const many = Buffer.concat([
      hex(`0a 0000 09 ${text('servers')} 01`),
      Buffer.from(count.toString(16).padStart(8, '0'), 'hex'),
      Buffer.alloc(count),
      hex('00'),
    ]);
    expect(() => parseNbt(many)).toThrow('too many tags');
  });

  it('refuses nesting deeper than the game reads instead of overflowing the stack', () => {
    const depth = 600;
    const deep = Buffer.concat([
      hex('0a 0000'),
      ...Array.from({ length: depth }, () => hex(`0a ${text('a')}`)),
      Buffer.alloc(depth + 1),
    ]);
    expect(() => parseNbt(deep)).toThrow(NbtFormatError);
  });
});
