import { describe, expect, it } from 'vitest';
import { countOf, fill, formatNumber, plural } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { LaunchError } from '@shared/launch';
import { TELEMETRY_FIELDS } from '@shared/telemetry';
import { isDemoMode } from './demo';
import { errorView } from './launch-view';
import { blocks, headingTag, inline, withoutTitle } from './markdown';
import { behaviorLines, labelOf, telemetryLines } from './telemetry';
import {
  addressCopyText,
  addressLabel,
  compactVersionLabel,
  compareVersions,
  versionLabel,
} from './minecraft';
import { pingLevel } from './ping';
import { accessChips, languageChip, serverTags, shownTags, tagList } from './tags';
import { duration, durationCoarse, greeting, minutesAgo, moscowYear, relativeDay } from './time';
import { formatBytes } from './units';

describe('Minecraft versions', () => {
  it('compares without assuming a 1. prefix', () => {
    expect(compareVersions('26.2', '1.21.11')).toBe(1);
    expect(compareVersions('1.21.11', '1.21.4')).toBe(1);
    expect(compareVersions('1.20', '1.20.0')).toBe(0);
  });

  it('a version range with a dash and no spaces', () => {
    expect(versionLabel({ from: '1.21.4', to: '26.2' })).toBe('1.21.4–26.2');
    expect(versionLabel({ from: '26.1', to: '26.1' })).toBe('26.1');
  });

  it('a long range is shortened to the first and last version', () => {
    expect(compactVersionLabel({ from: '1.18.2', to: '1.21.11' })).toBe('1.18.2–1.21.11');
    expect(compactVersionLabel({ from: '1.12.2', to: '26.10.12' })).toBe('1.12–26.10');
    expect(compactVersionLabel({ from: '26.2', to: '26.2' })).toBe('26.2');
  });

  it('an address with a port when the port is non-standard', () => {
    expect(addressLabel({ host: 'play.example.ru', port: 25565 })).toBe('play.example.ru');
    expect(addressLabel({ host: 'play.example.ru', port: 25577 })).toBe('play.example.ru:25577');
    expect(addressLabel({ host: 'xn--80aa0aehiwrr.xn--p1ai', port: null })).toBe('майнкрафт.рф');
    expect(addressCopyText({ host: 'xn--80aa0aehiwrr.xn--p1ai', port: 25577 })).toBe(
      'xn--80aa0aehiwrr.xn--p1ai:25577',
    );
  });
});

describe('ping', () => {
  it('red only for high ping', () => {
    expect(pingLevel(74).tone).toBe('good');
    expect(pingLevel(100).tone).toBe('mid');
    expect(pingLevel(250).tone).toBe('mid');
    expect(pingLevel(251).tone).toBe('bad');
    expect(pingLevel(null)).toMatchObject({ tone: 'none', bars: 'dash-lg' });
  });
});

describe('formatting', () => {
  it('declines in Russian', () => {
    expect(plural(1, ru.plural.players)).toBe('игрок');
    expect(plural(3, ru.plural.players)).toBe('игрока');
    expect(plural(11, ru.plural.players)).toBe('игроков');
    expect(plural(101, ru.plural.players)).toBe('игрок');
    expect(countOf(7973, ru.plural.players)).toBe(`${formatNumber(7973)}\u00a0игрока`);
    expect(countOf(1, ru.plural.servers)).toBe('1\u00a0сервер');
  });

  it('substitutes parameters and leaves unknown ones as is', () => {
    expect(fill('{a} и {b}', { a: 1 })).toBe('1 и {b}');
  });

  it('time in game: hours, minutes, seconds', () => {
    expect(duration(2 * 3600 + 14 * 60)).toBe('2\u00a0ч 14\u00a0мин');
    expect(duration(134)).toBe('2\u00a0мин 14\u00a0с');
    expect(duration(40)).toBe('40\u00a0с');
  });

  it('relative dates, including months', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    expect(relativeDay('2026-10-02T12:00:00Z', now)).toBe(ru.time.yesterday);
    expect(relativeDay('2026-09-30T12:00:00Z', now)).toBe('3 дня назад');
    expect(relativeDay('2026-09-01T12:00:00Z', now)).toBe(ru.time.monthAgo);
    expect(relativeDay('2026-06-01T12:00:00Z', now)).toBe('4 месяца назад');
    expect(minutesAgo('2026-10-03T11:58:00Z', now)).toBe('2\u00a0мин назад');
  });

  it('build year by Moscow time, falls back to the current one on a bad date', () => {
    const now = new Date('2027-03-01T12:00:00Z');
    expect(moscowYear('2026-12-31T22:00:00Z', now)).toBe(2027);
    expect(moscowYear('2026-12-31T20:00:00Z', now)).toBe(2026);
    expect(moscowYear('потом', now)).toBe(2027);
    expect(moscowYear(null, now)).toBe(2027);
  });

  it('greeting by Moscow hour with an injectable clock', () => {
    expect(greeting('A', new Date('2026-10-03T01:00:00Z'))).toBe('Доброй ночи, A');
    expect(greeting('A', new Date('2026-10-03T06:00:00Z'))).toBe('Доброе утро, A');
    expect(greeting('A', new Date('2026-10-03T12:00:00Z'))).toBe('Добрый день, A');
    expect(greeting('A', new Date('2026-10-03T16:00:00Z'))).toBe('Добрый вечер, A');
  });

  it('greeting without an account — no comma and no empty name', () => {
    expect(greeting('', new Date('2026-10-03T01:00:00Z'))).toBe('Доброй ночи');
    expect(greeting('', new Date('2026-10-03T06:00:00Z'))).toBe('Доброе утро');
    expect(greeting('', new Date('2026-10-03T12:00:00Z'))).toBe('Добрый день');
    expect(greeting('', new Date('2026-10-03T16:00:00Z'))).toBe('Добрый вечер');
  });

  it('rough duration: hours rounded up, under an hour — minutes, at least one', () => {
    expect(durationCoarse(5 * 3600 + 1800)).toBe('6\u00a0ч');
    expect(durationCoarse(24 * 3600)).toBe('24\u00a0ч');
    expect(durationCoarse(59 * 60 + 1)).toBe('60\u00a0мин');
    expect(durationCoarse(0)).toBe('1\u00a0мин');
  });

  it('server language: Russian and empty are not shown, a known one — by name, others — by code', () => {
    expect(languageChip('ru')).toBeNull();
    expect(languageChip(null)).toBeNull();
    expect(languageChip('en')?.label).toBe(ru.languages.en);
    expect(languageChip('xx')?.label).toBe('XX');
  });

  it('sizes in MB and GB', () => {
    expect(formatBytes(612 * 1024 * 1024)).toBe('612\u00a0МБ');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,5\u00a0ГБ');
  });

  it('tags joined into a string without breaking case', () => {
    expect(tagList(['bedwars', 'pvp', 'survival'])).toBe('BedWars, PvP, выживание');
  });

  it("'License only' — by access.nick, there is no license tag from the site", () => {
    expect(accessChips({ license: true, nick: false }).map((c) => c.label)).toEqual([
      ru.server.licenseOnly,
    ]);
    expect(accessChips({ license: true, nick: true })).toEqual([]);
    expect(shownTags(['license', 'anarchy'])).toEqual(['anarchy']);
  });

  it("'Other' and unfamiliar modes are not shown as a chip", () => {
    expect(shownTags(['other', 'survival', 'unknown-mode', 'pvp'])).toEqual(['survival', 'pvp']);
    expect(tagList(['other'])).toBe('');
  });

  it("'No mods' is hidden when the server lists its mods", () => {
    const tags = ['vanilla', 'survival'];
    const mods = { required: [], optional: ['simple-voice-chat'], forbidden: [] };
    expect(serverTags({ tags, launch: { kind: 'direct', minecraft: '1.21.11', mods } })).toEqual([
      'survival',
    ]);
    expect(serverTags({ tags, launch: { kind: 'direct', minecraft: '1.21.11' } })).toEqual(tags);
    expect(
      serverTags({
        tags,
        launch: { kind: 'direct', minecraft: '1.21.11', mods: { ...mods, optional: [] } },
      }),
    ).toEqual(tags);
  });
});

describe('launch errors', () => {
  it('every error has a title, text and an action', () => {
    const view = errorView({ code: 'java-missing', component: 'java-runtime-delta', major: 21 });
    expect(view.title).toBe('Java 21 не скачалась');
    expect(view.kind).toBe('retry');
    expect(errorView({ code: 'invalid-request', field: 'nick' }).kind).toBe('accounts');
    expect(errorView({ code: 'join-unsupported', minecraft: '1.5.2' }).kind).toBe(
      'retry-without-join',
    );
    expect(errorView({ code: 'network', url: null, reason: 'dns' }).text).toBe(
      ru.networkReasons.dns,
    );
  });

  it("cancellation — 'Stopped', other errors — 'Launch failed'", () => {
    expect(errorView({ code: 'too-many-files' }).eyebrow).toBe(ru.install.eyebrowFailed);
  });

  it.each<LaunchError>([
    { code: 'java-missing', component: 'jre-legacy', major: 8 },
    { code: 'network', url: null },
    { code: 'disk-full', path: null, bytesNeeded: null },
    { code: 'checksum-mismatch', file: 'x.jar' },
    { code: 'permission-denied', path: null },
    { code: 'file-locked', path: null },
    { code: 'file-missing', path: null },
    { code: 'too-many-files' },
    { code: 'version-not-found', minecraft: '26.9' },
    { code: 'loader-not-found', loader: 'fabric', minecraft: '26.3', version: null },
    { code: 'loader-install-failed', loader: 'fabric', stage: 'library', detail: 'exit 1' },
    { code: 'invalid-request', field: 'nick' },
    { code: 'invalid-request', field: 'account' },
    { code: 'join-unsupported', minecraft: '1.5.2' },
    { code: 'busy' },
    { code: 'not-running' },
    { code: 'running' },
    { code: 'cancelled' },
    { code: 'game-start-failed', message: 'x' },
    { code: 'unknown', message: 'x' },
  ])('$code: title and text without placeholders', (error) => {
    const view = errorView(error);
    expect(view.title.length).toBeGreaterThan(0);
    expect(view.text.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toMatch(/\{\w+\}/);
  });
});

describe('telemetry in settings', () => {
  it('description strings match the events and fields schema', () => {
    const lines = [...telemetryLines(true), ...behaviorLines()];
    expect(lines.map((line) => line.type)).toEqual(Object.keys(TELEMETRY_FIELDS));
    for (const line of lines) {
      const fields = TELEMETRY_FIELDS[line.type].map((field) => labelOf(line.type, field));
      expect(line.fields).toBe(fields.join(', '));
    }
    expect(Object.keys(ru.telemetry.fields).sort()).toEqual(
      [...new Set(Object.values(TELEMETRY_FIELDS).flat())].sort(),
    );
  });
});

describe('demo mode', () => {
  it('in a build only by an explicit flag, in development — unless turned off', () => {
    expect(isDemoMode({ DEV: false })).toBe(false);
    expect(isDemoMode({ DEV: false, VITE_LAUNCHER_DEMO: '1' })).toBe(false);
    expect(isDemoMode({ DEV: false, VITE_LAUNCHER_DEMO: 'on' })).toBe(true);
    expect(isDemoMode({ DEV: true })).toBe(true);
    expect(isDemoMode({ DEV: true, VITE_LAUNCHER_DEMO: 'off' })).toBe(false);
  });
});

describe('server description', () => {
  it('the first heading with the server name does not repeat the header', () => {
    const list = blocks('## RichDay\n\nТекст\n\n## RichDay');
    expect(withoutTitle(list, 'RichDay').map((block) => block.kind)).toEqual([
      'paragraph',
      'heading',
    ]);
    expect(withoutTitle(blocks('## Правила'), 'RichDay')).toHaveLength(1);
  });

  it('paragraphs, lists and code without HTML', () => {
    expect(blocks('Текст `/kit`\n\n- один\n- два')).toEqual([
      {
        kind: 'paragraph',
        parts: [
          { code: false, text: 'Текст ' },
          { code: true, text: '/kit' },
        ],
      },
      {
        kind: 'list',
        items: [[{ code: false, text: 'один' }], [{ code: false, text: 'два' }]],
      },
    ]);
  });

  it('# … #### headings at the start of a line with a space, the rest — plain text', () => {
    expect(
      blocks('## О сервере\nВыживание `1.21`\n\n### Правила ###\n- без читов\n#### Мелко'),
    ).toEqual([
      { kind: 'heading', level: 2, parts: [{ code: false, text: 'О сервере' }] },
      {
        kind: 'paragraph',
        parts: [
          { code: false, text: 'Выживание ' },
          { code: true, text: '1.21' },
        ],
      },
      { kind: 'heading', level: 3, parts: [{ code: false, text: 'Правила' }] },
      { kind: 'list', items: [[{ code: false, text: 'без читов' }]] },
      { kind: 'heading', level: 4, parts: [{ code: false, text: 'Мелко' }] },
    ]);
    expect(blocks('# Главное\r\n\r\nТекст')).toEqual([
      { kind: 'heading', level: 1, parts: [{ code: false, text: 'Главное' }] },
      { kind: 'paragraph', parts: [{ code: false, text: 'Текст' }] },
    ]);
    expect(blocks('##### пятый\n#1 в топе\n##')).toEqual([
      { kind: 'paragraph', parts: [{ code: false, text: '##### пятый #1 в топе ##' }] },
    ]);
  });

  it("description headings are smaller than the page's: the owner's h1–h4 become h4–h6", () => {
    expect([1, 2, 3, 4].map((level) => headingTag(level as 1 | 2 | 3 | 4))).toEqual([
      'h4',
      'h5',
      'h6',
      'h6',
    ]);
  });

  it('a link as a button only for https, no autolinks and no images', () => {
    expect(inline('Сайт [тут](https://legacy.example) и `[x](https://a.b)`')).toEqual([
      { code: false, text: 'Сайт ' },
      { code: false, text: 'тут', url: 'https://legacy.example' },
      { code: false, text: ' и ' },
      { code: true, text: '[x](https://a.b)' },
    ]);
    expect(inline('[старый](http://legacy.example) [почта](mailto:a@b.ru)')).toEqual([
      { code: false, text: 'старый' },
      { code: false, text: ' ' },
      { code: false, text: 'почта' },
    ]);
    expect(inline('голый http://legacy.example и https://legacy.example')).toEqual([
      { code: false, text: 'голый http://legacy.example и https://legacy.example' },
    ]);
    expect(inline('До ![спавн](https://legacy.example/a.png) после')).toEqual([
      { code: false, text: 'До спавн после' },
    ]);
    expect(inline('![](https://evil.example/track.png)')).toEqual([]);
  });
});
