import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gameListAddress, parseServerAddress, type ServerAddress } from '@shared/server-address';
import { writeFileAtomic } from './json-cache';
import {
  isNbtCompound,
  isNbtList,
  isNbtText,
  NBT_BYTE,
  NBT_COMPOUND,
  NBT_LIST,
  nbtByte,
  nbtCompound,
  nbtField,
  nbtText,
  parseNbt,
  serializeNbt,
  withNbtField,
  type NbtCompound,
  type NbtFile,
  type NbtList,
} from './nbt';

export const SERVER_LIST_FILE = 'servers.dat';

const SERVERS_KEY = 'servers';
const NAME_KEY = 'name';
const IP_KEY = 'ip';
const HIDDEN_KEY = 'hidden';
const ACCEPT_PACK_KEY = 'acceptTextures';
// The answer to the server's code of conduct (1.21.9+) and the icon from the last ping: without
// them the game would show the code of conduct on every join.
const CARRIED_IN_CATALOG = ['acceptedCodeOfConduct', 'icon'] as const;
const MAX_LIST_BYTES = 8 * 1024 * 1024;
const MAX_NAME_LENGTH = 80;
const FORMATTING_CODE = /§./gsu;
// U+200D stays: it joins emoji sequences.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const ZERO_WIDTH_JOINER = '‍';

export interface ListedServer {
  name: string;
  address: ServerAddress;
}

export type ServerListOutcome = 'written' | 'unchanged' | 'game-running';

export interface ServerListRequest {
  instance: string;
  server: ListedServer;
  gameRunning: boolean;
}

// A catalog name comes from the site: the game would apply § formatting codes in its list,
// and draws control and direction marks as boxes.
export function serverListName(name: string | null, fallback: string): string {
  const clean = Array.from(
    (name ?? '')
      .replace(FORMATTING_CODE, '')
      .replace(INVISIBLE, (mark) => (mark === ZERO_WIDTH_JOINER || /\s/u.test(mark) ? mark : ''))
      .replace(/\s+/gu, ' ')
      .trim(),
  )
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .trim();
  return clean === '' ? fallback : clean;
}

function addressKey(ip: string): string {
  const parsed = parseServerAddress(ip);
  return parsed === null ? ip.trim().toLowerCase() : gameListAddress(parsed);
}

function entryIp(entry: NbtCompound): string | null {
  const ip = nbtField(entry, IP_KEY);
  return isNbtText(ip) ? ip.value : null;
}

function isAt(entry: NbtCompound, key: string): boolean {
  const ip = entryIp(entry);
  return ip !== null && addressKey(ip) === key;
}

function isHidden(entry: NbtCompound): boolean {
  const hidden = nbtField(entry, HIDDEN_KEY);
  return hidden?.type === NBT_BYTE && 'bytes' in hidden && hidden.bytes.some((byte) => byte !== 0);
}

// acceptTextures 1 is the game's "server resource packs: enabled": without the key the game
// asks before every pack.
function ownEntry(server: ListedServer): NbtCompound {
  return nbtCompound([
    [NAME_KEY, nbtText(server.name)],
    [IP_KEY, nbtText(gameListAddress(server.address))],
    [ACCEPT_PACK_KEY, nbtByte(1)],
  ]);
}

function listFile(entries: NbtCompound[], base: NbtFile | null): NbtFile {
  const list: NbtList = { type: NBT_LIST, elementType: NBT_COMPOUND, items: entries };
  const root = base?.root ?? nbtCompound([]);
  return { name: base?.name ?? '', root: withNbtField(root, SERVERS_KEY, list) };
}

function existingEntries(file: NbtFile): NbtCompound[] | null {
  const list = nbtField(file.root, SERVERS_KEY);
  if (list === undefined) {
    return [];
  }
  if (!isNbtList(list) || !list.items.every(isNbtCompound)) {
    return null;
  }
  return list.items;
}

function readableEntries(data: Buffer | null): NbtCompound[] | null {
  if (data === null) {
    return [];
  }
  try {
    return existingEntries(parseNbt(data));
  } catch {
    return null;
  }
}

export function catalogServerList(server: ListedServer, existing: Buffer | null = null): Buffer {
  const key = gameListAddress(server.address);
  const before = readableEntries(existing)?.find((item) => isAt(item, key) && !isHidden(item));
  let entry = ownEntry(server);
  for (const field of CARRIED_IN_CATALOG) {
    const tag = before === undefined ? undefined : nbtField(before, field);
    if (tag !== undefined) {
      entry = withNbtField(entry, field, tag);
    }
  }
  return serializeNbt(listFile([entry], null));
}

async function readList(file: string): Promise<Buffer | null | 'unreadable'> {
  try {
    const data = await readFile(file);
    return data.length > MAX_LIST_BYTES ? 'unreadable' : data;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'unreadable';
  }
}

export async function listServerInGame(request: ServerListRequest): Promise<ServerListOutcome> {
  // A running game holds the list in memory and writes it back whole.
  if (request.gameRunning) {
    return 'game-running';
  }
  const file = path.join(request.instance, SERVER_LIST_FILE);
  const existing = await readList(file);
  const next = catalogServerList(request.server, Buffer.isBuffer(existing) ? existing : null);
  const changed = !Buffer.isBuffer(existing) || !existing.equals(next);
  if (changed) {
    await writeFileAtomic(file, next);
  }
  return changed ? 'written' : 'unchanged';
}
