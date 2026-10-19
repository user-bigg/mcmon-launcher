import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isSha256, type ClientModRun } from '@shared/skin-mod';
import { withFsRetry } from '../fs-retry';
import { writeJsonAtomic } from '../json-cache';
import type { GameLayout } from '../layout';

const FILE_NAME = 'client-mod-blocks.json';
const MAX_BLOCKS = 64;

export type { ClientModRun };

export function clientModBlocksFile(layout: GameLayout): string {
  return path.join(layout.instances, FILE_NAME);
}

function keyOf(run: ClientModRun): string {
  return `${run.minecraft} ${run.sha256}`;
}

function isRun(value: unknown): value is ClientModRun {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { minecraft, sha256 } = value as Record<string, unknown>;
  return (
    typeof minecraft === 'string' &&
    minecraft.length > 0 &&
    minecraft.length <= 64 &&
    typeof sha256 === 'string' &&
    isSha256(sha256)
  );
}

function storedRuns(value: unknown): ClientModRun[] {
  const list =
    typeof value === 'object' && value !== null
      ? (value as { blocked?: unknown }).blocked
      : undefined;
  return Array.isArray(list) ? list.filter(isRun) : [];
}

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
}

// A missing or broken file is an empty list. Any other failure (a file held by an antivirus) is
// not: the list is read again next time, and nothing is written over a file not read.
async function readRuns(file: string): Promise<Map<string, ClientModRun>> {
  let text: string;
  try {
    text = await withFsRetry(() => readFile(file, 'utf8'));
  } catch (error) {
    if (codeOf(error) === 'ENOENT') {
      return new Map();
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return new Map(storedRuns(value).map((run) => [keyOf(run), run]));
}

// A jar that crashed the game at start stays out of that version until the table names another
// jar: the hash is the key, so a fixed build lifts the block by itself.
export class ClientModBlocks {
  private loaded: Promise<Map<string, ClientModRun>> | null = null;

  constructor(private readonly layout: GameLayout) {}

  async has(run: ClientModRun): Promise<boolean> {
    return (await this.list()).some((item) => keyOf(item) === keyOf(run));
  }

  async list(): Promise<ClientModRun[]> {
    return [...(await this.runs().catch(() => new Map<string, ClientModRun>())).values()];
  }

  async add(run: ClientModRun): Promise<void> {
    const runs = await this.runs();
    if (runs.has(keyOf(run))) {
      return;
    }
    runs.set(keyOf(run), { minecraft: run.minecraft, sha256: run.sha256 });
    for (const key of [...runs.keys()].slice(0, Math.max(0, runs.size - MAX_BLOCKS))) {
      runs.delete(key);
    }
    await writeJsonAtomic(clientModBlocksFile(this.layout), {
      schemaVersion: 1,
      blocked: [...runs.values()],
    });
  }

  private runs(): Promise<Map<string, ClientModRun>> {
    this.loaded ??= readRuns(clientModBlocksFile(this.layout)).catch((error: unknown) => {
      this.loaded = null;
      throw error;
    });
    return this.loaded;
  }
}
