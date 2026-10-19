import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseServerAddress, type ServerAddress } from '@shared/server-address';
import {
  isNbtCompound,
  isNbtList,
  isNbtText,
  NBT_COMPOUND,
  NBT_INT,
  NBT_LIST,
  nbtByte,
  nbtCompound,
  nbtField,
  nbtText,
  parseNbt,
  serializeNbt,
  type NbtCompound,
  type NbtTag,
} from './nbt';
import {
  catalogServerList,
  listServerInGame,
  serverListName,
  SERVER_LIST_FILE,
  type ServerListOutcome,
} from './server-list';

function address(value: string): ServerAddress {
  const parsed = parseServerAddress(value);
  if (parsed === null) {
    throw new Error(`bad address ${value}`);
  }
  return parsed;
}

function entry(fields: Record<string, string | number>): NbtCompound {
  return nbtCompound(
    Object.entries(fields).map(([key, value]): [string, NbtTag] => [
      key,
      typeof value === 'string' ? nbtText(value) : nbtByte(value),
    ]),
  );
}

function listOf(...entries: NbtCompound[]): Buffer {
  return serializeNbt({
    name: '',
    root: nbtCompound([['servers', { type: NBT_LIST, elementType: NBT_COMPOUND, items: entries }]]),
  });
}

function entriesOf(data: Buffer): Record<string, string | number>[] {
  const servers = nbtField(parseNbt(data).root, 'servers');
  if (!isNbtList(servers)) {
    throw new Error('no servers');
  }
  return servers.items
    .filter(isNbtCompound)
    .map((item) =>
      Object.fromEntries(
        item.entries.map(([key, tag]) => [
          key,
          isNbtText(tag)
            ? tag.value
            : 'bytes' in tag
              ? tag.bytes.readIntBE(0, tag.bytes.length)
              : '?',
        ]),
      ),
    );
}

const RICHDAY = { name: 'RichDay', address: address('mc.example.org') };

describe('server list of a catalog server folder', () => {
  it('matches a file assembled by hand from the format', () => {
    const expected = Buffer.concat([
      Buffer.from('0a0000', 'hex'),
      Buffer.from('090007', 'hex'),
      Buffer.from('servers'),
      Buffer.from('0a00000001', 'hex'),
      Buffer.from('080004', 'hex'),
      Buffer.from('name'),
      Buffer.from('0007', 'hex'),
      Buffer.from('RichDay'),
      Buffer.from('080002', 'hex'),
      Buffer.from('ip'),
      Buffer.from('000e', 'hex'),
      Buffer.from('mc.example.org'),
      Buffer.from('01000e', 'hex'),
      Buffer.from('acceptTextures'),
      Buffer.from('01', 'hex'),
      Buffer.from('0000', 'hex'),
    ]);
    expect(catalogServerList(RICHDAY).equals(expected)).toBe(true);
  });

  it.each([
    ['mc.example.org:25565', 'mc.example.org:25565'],
    ['mc.example.org:25570', 'mc.example.org:25570'],
    ['MC.Example.org', 'mc.example.org'],
    ['192.0.2.7:25565', '192.0.2.7:25565'],
    ['[2001:db8::1]', '[2001:db8::1]'],
    ['[2001:db8::1]:25565', '[2001:db8::1]:25565'],
    ['[2001:db8::1]:25570', '[2001:db8::1]:25570'],
    ['_srv.play.example.org', '_srv.play.example.org'],
  ])('writes %s as %s', (given, written) => {
    const list = catalogServerList({ name: 'S', address: address(given) });
    expect(entriesOf(list)[0]?.ip).toBe(written);
  });

  it('keeps a name outside ASCII', () => {
    const list = catalogServerList({ name: 'Стальной клинок', address: RICHDAY.address });
    expect(entriesOf(list)[0]?.name).toBe('Стальной клинок');
  });
});

describe('serverListName', () => {
  it.each([
    ['§cRed §lServer', 'Red Server'],
    ['Zero\u0000Byte', 'ZeroByte'],
    ['Right\u202eto left\u2066', 'Rightto left'],
    ['Two\nlines\r\nhere', 'Two lines here'],
    ['  Spaced\u0085  ', 'Spaced'],
    ['Family \u{1f468}\u200d\u{1f469}', 'Family \u{1f468}\u200d\u{1f469}'],
    ['Стальной клинок', 'Стальной клинок'],
  ])('%j — %j', (given, clean) => {
    expect(serverListName(given, 'mc.example.org')).toBe(clean);
  });

  it('nothing left after cleaning or no name — the address', () => {
    expect(serverListName('§k\u202e\u0000 ', 'mc.example.org')).toBe('mc.example.org');
    expect(serverListName(null, 'mc.example.org')).toBe('mc.example.org');
  });

  it('a long name is cut to 80 characters', () => {
    expect(Array.from(serverListName('я'.repeat(200), 'x'))).toHaveLength(80);
  });
});

describe('listServerInGame', () => {
  let instance: string;

  beforeEach(async () => {
    instance = await mkdtemp(join(tmpdir(), 'mcmonitor-servers-'));
  });

  afterEach(async () => {
    await rm(instance, { recursive: true, force: true });
  });

  function run(gameRunning = false, server = RICHDAY): Promise<ServerListOutcome> {
    return listServerInGame({ instance, server, gameRunning });
  }

  function read(): Promise<Buffer> {
    return readFile(join(instance, SERVER_LIST_FILE));
  }

  it('catalog folder: creates the file, leaves no temporary files and no mark file', async () => {
    expect(await run()).toBe('written');
    expect(entriesOf(await read())).toEqual([
      { name: 'RichDay', ip: 'mc.example.org', acceptTextures: 1 },
    ]);
    expect(await readdir(instance)).toEqual([SERVER_LIST_FILE]);
  });

  it('catalog folder: the file is built anew — other entries and old choices are gone', async () => {
    await writeFile(
      join(instance, SERVER_LIST_FILE),
      listOf(
        entry({ hidden: 0, ip: 'one.example.org', name: 'One' }),
        entry({
          hidden: 1,
          ip: 'mc.example.org:25565',
          name: 'Minecraft Server',
          acceptTextures: 0,
        }),
      ),
    );
    expect(await run()).toBe('written');
    expect(entriesOf(await read())).toEqual([
      { name: 'RichDay', ip: 'mc.example.org', acceptTextures: 1 },
    ]);
  });

  it('catalog folder: the accepted code of conduct and the icon of the same server stay', async () => {
    const accepted = nbtCompound([
      ['name', nbtText('Old name')],
      ['ip', nbtText('MC.example.org')],
      ['icon', nbtText('SUNPTg==')],
      ['acceptTextures', nbtByte(0)],
      ['hidden', nbtByte(0)],
      ['acceptedCodeOfConduct', { type: NBT_INT, bytes: Buffer.from('7ffffffe', 'hex') }],
      ['unknown', nbtText('x')],
    ]);
    await writeFile(
      join(instance, SERVER_LIST_FILE),
      listOf(entry({ hidden: 0, ip: 'one.example.org', name: 'One', icon: 'eA==' }), accepted),
    );
    expect(await run()).toBe('written');
    expect(entriesOf(await read())).toEqual([
      {
        name: 'RichDay',
        ip: 'mc.example.org',
        acceptTextures: 1,
        acceptedCodeOfConduct: 0x7ffffffe,
        icon: 'SUNPTg==',
      },
    ]);
  });

  it('catalog folder: a hidden entry of the address gives nothing', async () => {
    await writeFile(
      join(instance, SERVER_LIST_FILE),
      listOf(entry({ hidden: 1, ip: 'mc.example.org', name: 'M', icon: 'eA==' })),
    );
    await run();
    expect(entriesOf(await read())).toEqual([
      { name: 'RichDay', ip: 'mc.example.org', acceptTextures: 1 },
    ]);
  });

  it('catalog folder: a damaged file is replaced', async () => {
    await writeFile(join(instance, SERVER_LIST_FILE), 'broken');
    expect(await run()).toBe('written');
    expect(entriesOf(await read())).toHaveLength(1);
  });

  it('catalog folder: an up-to-date file is not rewritten', async () => {
    await run();
    expect(await run()).toBe('unchanged');
  });

  it('catalog folder: nothing is written while a game runs from it', async () => {
    const before = listOf(entry({ hidden: 0, ip: 'one.example.org', name: 'One' }));
    await writeFile(join(instance, SERVER_LIST_FILE), before);
    expect(await run(true)).toBe('game-running');
    expect((await read()).equals(before)).toBe(true);
    expect(await readdir(instance)).toEqual([SERVER_LIST_FILE]);
  });
});
