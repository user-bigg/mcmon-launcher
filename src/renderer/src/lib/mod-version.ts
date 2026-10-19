const LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'mc']);
const SEPARATORS = /[-_\s]+/;
const GAME_TAG = /^mc\d/i;
const NUMBERED = /^v?(\d+(?:\.\d+)*)/i;
const GAME_VERSION = /^(?:1\.\d{1,2}(?:\.\d{1,2})?|[2-9]\d\.\d{1,2}(?:\.\d{1,2})?)$/;
const YEAR_VERSION = /^[2-9]\d\.\d{1,2}(?:\.\d{1,2})?$/;

function withoutBuild(raw: string): string {
  const plus = raw.indexOf('+');
  return plus < 0 ? raw : raw.slice(0, plus);
}

function versionTokens(raw: string): string[] {
  return withoutBuild(raw)
    .split(SEPARATORS)
    .filter((token) => token !== '' && !LOADERS.has(token.toLowerCase()) && !GAME_TAG.test(token))
    .filter((token) => NUMBERED.test(token));
}

function without(tokens: readonly string[], pattern: RegExp): string[] {
  const rest = tokens.filter((token) => !pattern.test(token));
  return rest.length > 0 ? rest : [...tokens];
}

// Both parts may look like a game version ("1.21.11-1.5.2"); the game version comes first then.
function withoutGameVersions(tokens: readonly string[]): string[] {
  const rest = without(without(tokens, GAME_VERSION), YEAR_VERSION);
  return rest.length > 1 && rest.every((token) => GAME_VERSION.test(token)) ? rest.slice(1) : rest;
}

export function shortModVersion(raw: string): string {
  const [first] = withoutGameVersions(versionTokens(raw.trim()));
  const core = first === undefined ? undefined : NUMBERED.exec(first)?.[1];
  return core ?? raw;
}
