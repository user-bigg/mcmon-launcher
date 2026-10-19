import { describe, expect, it } from 'vitest';
import card from './fixtures/card.json';
import { hostileCard, PAYLOAD } from './fixtures/hostile';
import scenes from './fixtures/scenes.json';
import { parseMeta, parseScenes, parseServerCard, parseServerList, parseServerRow } from './parse';

const HOSTILE_URLS = [
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  ' javascript:alert(1)',
  'data:image/svg+xml,<svg onload=alert(1)>',
  'file:///etc/passwd',
  'http://evil.example/x.png',
  '//evil.example/x.png',
  '\\\\evil\\share\\x.png',
  'app://launcher/index.html',
  `https://evil.example/${'a'.repeat(2100)}`,
  42,
  { toString: 'https://ok.example' },
];

function row(patch: Record<string, unknown>): unknown {
  return { ...card, ...patch };
}

describe('hostile content in site strings', () => {
  it('HTML and templates in name and descriptions pass through as is, links are dropped', () => {
    const parsed = parseServerCard(hostileCard());
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe(`Сервер ${PAYLOAD}`);
    expect(parsed?.description).toBe(PAYLOAD);
    expect(parsed?.tags).toEqual(['pvp']);
    expect(parsed?.links).toEqual({
      youtube: 'https://youtube.com/@ok',
      tiktok: 'https://www.tiktok.com/@ok',
    });
    expect(parsed?.site_url).toBe('');
    expect(parsed?.launch).toEqual({ kind: 'none' });
    expect(parsed?.topSlot).toEqual({ tier: 'gold' });
    expect(parsed?.cover).toEqual({ scene: 'plains', time: 'auto' });
  });

  it('image and link addresses must be https only and no longer than 2 KB', () => {
    for (const url of HOSTILE_URLS) {
      const parsed = parseServerCard(
        row({
          icon_url: url,
          site_url: url,
          links: { site: url },
          launch: { kind: 'own_launcher', url, label: 'x' },
        }),
      );
      expect(parsed?.icon_url).toBeNull();
      expect(parsed?.site_url).toBe('');
      expect(parsed?.links).toEqual({});
      expect(parsed?.launch).toEqual({ kind: 'none' });
    }
  });

  it('direction spoofing and invisible characters in the name do not pass', () => {
    for (const name of [
      '\u202Egpj.exe',
      'Сер\u200Bвер',
      'a\u0000b',
      'a\nb',
      '\u2066x\u2069',
      '\uFEFFx',
    ]) {
      expect(parseServerRow(row({ name }))).toBeNull();
    }
    expect(parseServerRow(row({ description: 'текст\u202E' }))?.description).toBe('');
    expect(parseServerRow(row({ wipe_label: 'вайп\u200F' }))?.wipe_label).toBeNull();
  });

  it('giant strings are dropped, not truncated in the middle', () => {
    const huge = 'x'.repeat(20_001);
    const parsed = parseServerCard(
      row({ description_md: huge, rules_md: huge, description: huge }),
    );
    expect(parsed?.description_md).toBe('');
    expect(parsed?.rules_md).toBeNull();
    expect(parsed?.description).toBe('');
    expect(parseServerRow(row({ name: 'x'.repeat(121) }))).toBeNull();
  });

  it('server address carries no arguments or paths', () => {
    for (const host of [
      'play.example --server evil',
      'play.example"',
      'play.example/../x',
      'play.example\\x',
      '-Dfoo=bar',
      'play.example%00',
      '\u202Eplay.example',
    ]) {
      expect(parseServerRow(row({ address: { host, port: 25565 } }))).toBeNull();
    }
  });

  it('__proto__ and constructor in the response do not pollute prototypes', () => {
    const body = JSON.parse(
      `{"data":[${JSON.stringify(row({}))}],"__proto__":{"polluted":true},"top_slots":{"__proto__":{"polluted":true}},"meta":{"constructor":{"prototype":{"polluted":true}}}}`,
    ) as unknown;
    const withProto = JSON.parse(
      `${JSON.stringify(row({})).slice(0, -1)},"links":{"__proto__":{"site":"javascript:alert(1)"}},"cover":{"scene":"plains","time":"day","__proto__":{"polluted":true}}}`,
    ) as unknown;
    const list = parseServerList(body, () => undefined);
    const parsed = parseServerCard(withProto);
    expect(list?.data).toHaveLength(1);
    expect(parsed?.links).toEqual({});
    expect(Object.getPrototypeOf(parsed?.cover)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((parsed?.links as Record<string, unknown>).site).toBeUndefined();
  });

  it('scenes: only #rrggbb color and numbers get into styles', () => {
    const [scene] = scenes as Record<string, unknown>[];
    const skies = { day: '#000000', sunset: '#000000', night: '#000000' };
    for (const sky of ['red;background:url(https://evil.example/x)', '#fff', 'expression(1)']) {
      const hostile = { ...scene, skies: { ...skies, day: sky } };
      expect(parseScenes([hostile], () => undefined)).toEqual([]);
    }
    const layers = scene?.layers as Record<string, Record<string, unknown>[]>;
    const animated = {
      ...scene,
      layers: {
        ...layers,
        day: (layers.day ?? []).map((layer) => ({
          ...layer,
          anim: { type: 'drift', dur: '1s;background:url(x)', amp: '1px' },
        })),
      },
    };
    const parsed = parseScenes([animated], () => undefined);
    expect(parsed?.[0]?.scene.layers.day.length).toBeGreaterThan(0);
    for (const layer of parsed?.[0]?.scene.layers.day ?? []) {
      expect(layer.anim?.type).toBe('still');
    }
  });

  it('report reasons: label with control characters and HTML keys', () => {
    const meta = parseMeta({
      links: { terms: 'javascript:alert(1)', privacy: 'https://ok.example/privacy' },
      report_reasons: [
        { code: 'spam', label: 'Спам\u202E' },
        { code: 'other', label: PAYLOAD.slice(0, 80) },
        { code: '<script>', label: 'x' },
      ],
    });
    expect(meta?.links).toEqual({ privacy: 'https://ok.example/privacy' });
    expect(meta?.reportReasons).toEqual([{ code: 'other', label: PAYLOAD.slice(0, 80) }]);
  });
});
