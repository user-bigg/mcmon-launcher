import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { withFsRetry } from './fs-retry';

const OPTIONS_FILE = 'options.txt';
const LANGUAGE_KEY = 'lang';

export type GameOption = readonly [key: string, value: string];

// What a fresh game folder gets so that "Play" leads to the server without extra screens.
// Each key is read by the versions that know it and skipped by the rest: the game matches
// option lines by name and ignores names it does not have.
//   onboardAccessibility (1.19.4+): the "Welcome to Minecraft!" screen, shown before quick play;
//   skipMultiplayerWarning (1.15+): the third-party servers caution before "Multiplayer";
//   tutorialStep (1.12+): the "move with WASD" hints of a first world;
//   joinedFirstServer (1.16.4+): the social interactions hint on the first server.
export const FIRST_RUN_OPTIONS: readonly GameOption[] = [
  ['onboardAccessibility', 'false'],
  ['skipMultiplayerWarning', 'true'],
  ['tutorialStep', 'none'],
  ['joinedFirstServer', 'true'],
];

export function firstRunOptions(language: string | null): readonly GameOption[] {
  return language === null ? FIRST_RUN_OPTIONS : [...FIRST_RUN_OPTIONS, [LANGUAGE_KEY, language]];
}

export function optionsFile(instance: string, fs: path.PlatformPath = path): string {
  return fs.join(instance, OPTIONS_FILE);
}

function hasKey(existing: string, key: string): boolean {
  return existing.split(/\r?\n/).some((line) => line.startsWith(`${key}:`));
}

export function optionsAppendix(
  existing: string | null,
  options: readonly GameOption[],
): string | null {
  const text = existing ?? '';
  const missing = options.filter(([key]) => !hasKey(text, key));
  if (missing.length === 0) {
    return null;
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const separator = text.length === 0 || text.endsWith('\n') ? '' : newline;
  return separator + missing.map(([key, value]) => `${key}:${value}${newline}`).join('');
}

async function readExisting(file: string): Promise<string | null> {
  try {
    return (await readFile(file)).toString('latin1');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Only an absent key is added: the file is appended to, never rewritten, so the player's
// settings and their encoding stay as is. After its first run the game writes every key it
// knows, so from then on a value is the player's.
export async function addMissingOptions(
  instance: string,
  options: readonly GameOption[],
): Promise<boolean> {
  const file = optionsFile(instance);
  const appendix = optionsAppendix(await readExisting(file), options);
  if (appendix === null) {
    return false;
  }
  await withFsRetry(() => appendFile(file, appendix, 'utf8'));
  return true;
}
