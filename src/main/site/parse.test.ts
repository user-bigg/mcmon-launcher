import { describe, expect, it, vi } from 'vitest';
import card from './fixtures/card.json';
import scenes from './fixtures/scenes.json';
import servers from './fixtures/servers.json';
import {
  parseErrorBody,
  parseLive,
  parseMeta,
  parseScenes,
  parseServerCard,
  parseServerList,
  parseServerRow,
  withoutPersonal,
} from './parse';

const [first] = servers.data;

function row(patch: Record<string, unknown>): unknown {
  return { ...first, ...patch };
}

describe('server address with the port as entered and the last check', () => {
  const checked = { ip: '203.0.113.5', port: 25570, checked_at: '2026-10-14T09:00:00Z' };

  it('port null stays null, an entered 25565 stays 25565, the check is kept apart', () => {
    const srv = parseServerRow(
      row({ address: { host: 'srv.example.ru', port: null, ping: checked } }),
    );
    expect(srv).toMatchObject({
      address: { host: 'srv.example.ru', port: null },
      pingTarget: { ip: '203.0.113.5', port: 25570, checkedAt: '2026-10-14T09:00:00Z' },
    });
    const port = parseServerRow(
      row({ address: { host: 'port.example.ru', port: 25565, ping: null } }),
    );
    expect(port).toMatchObject({
      address: { host: 'port.example.ru', port: 25565 },
      pingTarget: null,
    });
  });

  it('a check in a wrong form is dropped, the row stays', () => {
    const bad = [
      { ...checked, ip: 'not-an-ip' },
      { ...checked, ip: '203.0.113.5:25570' },
      { ...checked, port: 70000 },
      { ...checked, checked_at: 'yesterday' },
      'x',
      ...[
        '127.0.0.1',
        '10.1.2.3',
        '172.20.0.5',
        '192.168.0.1',
        '169.254.10.10',
        '100.64.1.1',
        '0.0.0.0',
        '224.0.0.1',
        '::1',
        '::',
        'fd00::1',
        'fe80::1',
        'ff02::1',
        '::ffff:10.0.0.1',
      ].map((ip) => ({ ...checked, ip })),
    ];
    for (const ping of bad) {
      const parsed = parseServerRow(row({ address: { host: 'srv.example.ru', port: null, ping } }));
      expect(parsed).toMatchObject({ address: { host: 'srv.example.ru' }, pingTarget: null });
    }
    expect(
      parseServerRow(
        row({
          address: { host: 'v6.example.ru', port: null, ping: { ...checked, ip: '[2001:db8::5]' } },
        }),
      ),
    ).toMatchObject({ pingTarget: { ip: '2001:db8::5' } });
  });
});

describe('catalog', () => {
  it('parses the fixture response without losing needed fields', () => {
    const log = vi.fn();
    const list = parseServerList(servers, log);
    expect(log).not.toHaveBeenCalled();
    expect(list?.data).toHaveLength(3);
    expect(list?.topSlots.diamond[0]?.topSlot?.tier).toBe('diamond');
    expect(list?.topSlotsFree).toEqual({ diamond: 0, gold: 0 });
    expect(list?.meta).toMatchObject({ page: 1, per_page: 5, total: 184 });
    expect(list?.meta.online_total).toBeTypeOf('number');
    expect(list?.data[0]).toMatchObject({
      id: 3,
      address: { host: 'play.legacy.example', port: 25565 },
      versions: { from: '1.8', to: '26.2' },
      launch: { kind: 'direct', minecraft: '26.2' },
      access: { license: true, nick: false },
    });
    expect(
      parseServerRow(row({ access: { license: true, nick: true, elyby: true } }))?.access,
    ).toEqual({ license: true, nick: true });
  });

  it('votes_month — an integer no less than zero, missing or malformed — 0', () => {
    expect(parseServerRow(row({ votes_month: 318 }))?.votes_month).toBe(318);
    expect(parseServerRow(row({ votes_month: -4 }))?.votes_month).toBe(0);
    expect(parseServerRow(row({ votes_month: '318' }))?.votes_month).toBe(0);
    expect(parseServerRow(row({ votes_month: undefined }))?.votes_month).toBe(0);
  });

  it('weekly_trend — an integer or null with low online count, missing — null', () => {
    expect(parseServerRow(row({ weekly_trend: -12 }))?.weekly_trend).toBe(-12);
    expect(parseServerRow(row({ weekly_trend: null }))?.weekly_trend).toBeNull();
    expect(parseServerRow(row({ weekly_trend: '12%' }))?.weekly_trend).toBeNull();
    expect(parseServerRow(row({ weekly_trend: undefined }))?.weekly_trend).toBeNull();
  });

  it('down_since — ISO time or null, missing — null', () => {
    expect(parseServerRow(row({ down_since: '2026-10-03T09:15:00Z' }))?.down_since).toBe(
      '2026-10-03T09:15:00Z',
    );
    expect(parseServerRow(row({ down_since: 'вчера' }))?.down_since).toBeNull();
    expect(parseServerRow(row({}))?.down_since).toBeNull();
  });

  it('drops extra fields', () => {
    const parsed = parseServerRow(row({ secret: 'x', admin_email: 'a@b.c' }));
    expect(parsed).not.toHaveProperty('secret');
    expect(parsed).not.toHaveProperty('admin_email');
  });

  it('versions: null and max_players: null — valid values, not an error', () => {
    const parsed = parseServerRow(row({ versions: null, max_players: null }));
    expect(parsed?.versions).toBeNull();
    expect(parsed?.max_players).toBeNull();
  });

  it('a malformed entry is skipped with a log, the rest remain', () => {
    const log = vi.fn();
    const broken = {
      ...servers,
      data: [first, { id: 'x' }, row({ id: 5, address: { host: 'bad host', port: 1 } }), null],
    };
    const list = parseServerList(broken, log);
    expect(list?.data.map((item) => item.id)).toEqual([3]);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('launch.skins is kept as a boolean and left out when the site does not send one', () => {
    const direct = { kind: 'direct', minecraft: '26.2' };
    expect(parseServerRow(row({ launch: { ...direct, skins: false } }))?.launch).toEqual({
      ...direct,
      skins: false,
    });
    expect(parseServerRow(row({ launch: { ...direct, skins: true } }))?.launch).toEqual({
      ...direct,
      skins: true,
    });
    expect(parseServerRow(row({ launch: { ...direct, skins: 'no' } }))?.launch).toEqual(direct);
    expect(parseServerRow(row({ launch: direct }))?.launch).toEqual(direct);
    expect(parseServerRow(row({ launch: { kind: 'none', skins: false } }))?.launch).toEqual({
      kind: 'none',
    });
  });

  it('launch.modpack is kept as a boolean only for a direct launch', () => {
    const direct = { kind: 'direct', minecraft: '26.2' };
    expect(
      parseServerRow(row({ launch: { ...direct, skins: false, modpack: true } }))?.launch,
    ).toEqual({ ...direct, skins: false, modpack: true });
    expect(parseServerRow(row({ launch: { ...direct, modpack: 'yes' } }))?.launch).toEqual(direct);
    expect(parseServerRow(row({ launch: { kind: 'none', modpack: true } }))?.launch).toEqual({
      kind: 'none',
    });
  });

  it('launch.launcher_only is set only by a boolean true of a direct launch', () => {
    const direct = { kind: 'direct', minecraft: '26.2' };
    const launchOf = (value: Record<string, unknown>): unknown =>
      parseServerRow(row({ launch: value }))?.launch;
    expect(launchOf({ ...direct, launcher_only: true })).toEqual({ ...direct, launcherOnly: true });
    for (const flag of [false, 'true', 1, null]) {
      expect(launchOf({ ...direct, launcher_only: flag })).toEqual(direct);
    }
    expect(
      launchOf({
        kind: 'own_launcher',
        url: 'https://example.ru/l',
        label: 'L',
        launcher_only: true,
      }),
    ).toEqual({ kind: 'own_launcher', url: 'https://example.ru/l', label: 'L' });
    expect(launchOf({ kind: 'none', launcher_only: true })).toEqual({ kind: 'none' });
  });

  it('launch.mods keeps the lists of a direct launch, a missing list is empty', () => {
    const direct = { kind: 'direct', minecraft: '1.21.11' };
    const launchOf = (value: Record<string, unknown>): unknown =>
      parseServerRow(row({ launch: { ...direct, ...value } }))?.launch;
    expect(
      launchOf({ mods: { required: ['simple-voice-chat'], forbidden: ['xaeros-minimap'] } }),
    ).toEqual({
      ...direct,
      mods: { required: ['simple-voice-chat'], optional: [], forbidden: ['xaeros-minimap'] },
    });
    expect(launchOf({ mods: {} })).toEqual(direct);
    expect(launchOf({ modpack: true, mods: { required: ['simple-voice-chat'] } })).toEqual({
      ...direct,
      modpack: true,
    });
    expect(
      parseServerRow(row({ launch: { kind: 'none', mods: { required: ['simple-voice-chat'] } } }))
        ?.launch,
    ).toEqual({ kind: 'none' });
  });

  it('a bad slug in optional or forbidden is dropped, in required it stays as a mod nobody has', () => {
    const direct = { kind: 'direct', minecraft: '1.21.11' };
    const launchOf = (value: Record<string, unknown>): unknown =>
      parseServerRow(row({ launch: { ...direct, ...value } }))?.launch;
    expect(
      launchOf({
        mods: {
          required: ['Voice', 'voice.chat', 5, 'simple-voice-chat', 'con'],
          optional: ['emotecraft', 'emotecraft', '../x', 'Bad', 5],
          forbidden: ['nul', 'xaeros-minimap'],
        },
      }),
    ).toEqual({
      ...direct,
      mods: {
        required: ['', 'simple-voice-chat'],
        optional: ['emotecraft'],
        forbidden: ['xaeros-minimap'],
      },
    });
  });

  it('a list that cannot be read or is too long makes the mods of the server unknown', () => {
    const direct = { kind: 'direct', minecraft: '1.21.11' };
    const launchOf = (value: Record<string, unknown>): unknown =>
      parseServerRow(row({ launch: { ...direct, ...value } }))?.launch;
    const many = Array.from({ length: 257 }, (_, index) => `mod-${String(index)}`);
    for (const mods of [
      ['simple-voice-chat'],
      'simple-voice-chat',
      { required: 'simple-voice-chat' },
      { forbidden: { a: 1 } },
      { forbidden: many },
      { optional: many },
    ]) {
      expect(launchOf({ mods })).toEqual({ ...direct, modsUnreadable: true });
    }
    const ceiling = Array.from({ length: 256 }, (_, index) => `mod-${String(index)}`);
    expect(launchOf({ mods: { forbidden: ceiling } })).toMatchObject({
      mods: { forbidden: ceiling },
    });
  });

  it('links only https, a malformed launch becomes none', () => {
    const parsed = parseServerRow(
      row({
        icon_url: 'javascript:alert(1)',
        site_url: 'http://mc-mon.ru/x',
        launch: { kind: 'own_launcher', url: 'http://evil.example/', label: 'X' },
      }),
    );
    expect(parsed?.icon_url).toBeNull();
    expect(parsed?.site_url).toBe('');
    expect(parsed?.launch).toEqual({ kind: 'none' });
  });

  it("a server's own launcher is accepted over https", () => {
    const parsed = parseServerRow(
      row({ launch: { kind: 'own_launcher', url: 'https://example.ru/l', label: 'Лаунчер' } }),
    );
    expect(parsed?.launch).toEqual({
      kind: 'own_launcher',
      url: 'https://example.ru/l',
      label: 'Лаунчер',
    });
  });

  it('a top slot keeps only its tier, without advertiser name or erid', () => {
    const parsed = parseServerRow(
      row({ top_slot: { tier: 'gold', advertiser: 'ООО Ромашка', erid: '2SDnjeXYZ' } }),
    );
    expect(parsed?.topSlot).toEqual({ tier: 'gold' });
  });

  it('not a list — null', () => {
    expect(parseServerList({ data: 'x' }, vi.fn())).toBeNull();
    expect(parseServerList(null, vi.fn())).toBeNull();
  });
});

describe('card and live', () => {
  it('fixture card', () => {
    const parsed = parseServerCard(card);
    expect(parsed?.rules_md).toBeNull();
    expect(parsed?.links).toEqual({
      site: 'https://legacy.example',
      discord: 'https://discord.gg/example',
      telegram: 'https://t.me/example',
      vk: 'https://vk.com/example',
      youtube: 'https://youtube.com/@example',
    });
    expect(parsed?.chart_24h).toHaveLength(3);
    expect(parsed?.uptime_90d).toBeCloseTo(0.9937);
    expect(parsed?.votes).toEqual({ month: 118, today: 13 });
  });

  it('card without optional fields', () => {
    const parsed = parseServerCard({
      ...first,
      peak_24h: null,
      last_outage: null,
      chart_24h: [{}],
    });
    expect(parsed?.peak_24h).toBeNull();
    expect(parsed?.chart_24h).toEqual([]);
    expect(parsed?.description_md).toBe('');
  });

  it('live', () => {
    expect(parseLive({ online: 1518, max: 9999, up: true, at: '2026-10-03T05:55:00Z' }, 3)).toEqual(
      { id: 3, online: 1518, max: 9999, up: true, at: '2026-10-03T05:55:00Z' },
    );
    expect(parseLive({ online: 1, max: null, up: false, at: '2026-10-03T05:55:00Z' }, 3)?.max).toBe(
      null,
    );
    expect(parseLive({ online: -1, up: true, at: 'вчера' }, 3)).toBeNull();
  });
});

describe('meta and errors', () => {
  it('site links are only the known ones and https', () => {
    expect(
      parseMeta({
        links: { terms: 'https://mc-mon.ru/terms', privacy: 'http://x/', evil: 'https://e/' },
      }),
    ).toEqual({ links: { terms: 'https://mc-mon.ru/terms' }, connect: null, reportReasons: [] });
  });

  it('code repository and tracker — optional meta links', () => {
    expect(
      parseMeta({
        links: { source: 'https://git.example/launcher', issues: 'http://git.example/issues' },
      }),
    ).toEqual({
      links: { source: 'https://git.example/launcher' },
      connect: null,
      reportReasons: [],
    });
  });

  it('sign-in methods — site page from meta, https only', () => {
    expect(parseMeta({ links: { logins: 'https://mc-mon.ru/settings/logins' } })?.links).toEqual({
      logins: 'https://mc-mon.ru/settings/logins',
    });
    expect(parseMeta({ links: { logins: 'http://mc-mon.ru/settings/logins' } })?.links).toEqual({});
  });

  it('adding a server — site page from meta, https only', () => {
    expect(parseMeta({ links: { add_server: 'https://mc-mon.ru/add' } })?.links).toEqual({
      add_server: 'https://mc-mon.ru/add',
    });
    expect(parseMeta({ links: { add_server: 'http://mc-mon.ru/add' } })?.links).toEqual({});
  });

  it('launcher connection page — separate from links, https only', () => {
    expect(parseMeta({ links: { connect: 'https://mc-mon.ru/launcher/connect' } })).toEqual({
      links: {},
      connect: 'https://mc-mon.ru/launcher/connect',
      reportReasons: [],
    });
    expect(parseMeta({ links: { connect: 'http://mc-mon.ru/launcher/connect' } })).toEqual({
      links: {},
      connect: null,
      reportReasons: [],
    });
  });

  it('report reasons: site order, an unknown code is accepted, malformed ones are dropped', () => {
    const meta = parseMeta({
      links: {},
      report_reasons: [
        { code: 'donation_fraud', label: 'Обман с донатом' },
        { code: 'wrong_address', label: 'Адрес ведёт на другой сервер' },
        { code: 'cheats_allowed', label: 'Читы не запрещены' },
        { code: 'Bad-Code', label: 'Кривой код' },
        { code: 'forbidden', label: '' },
        { code: 'donation_fraud', label: 'Повтор' },
        { code: 'fake_stats' },
        'other',
        { code: 'other', label: 'Другое' },
      ],
    });
    expect(meta?.reportReasons).toEqual([
      { code: 'donation_fraud', label: 'Обман с донатом' },
      { code: 'wrong_address', label: 'Адрес ведёт на другой сервер' },
      { code: 'cheats_allowed', label: 'Читы не запрещены' },
      { code: 'other', label: 'Другое' },
    ]);
    expect(parseMeta({ links: {}, report_reasons: 'other' })?.reportReasons).toEqual([]);
  });

  it("card: a guest's report — null, a signed-in user gets my_report and can_report", () => {
    expect(parseServerCard(card)?.report).toBeNull();
    expect(parseServerCard({ ...card, my_report: null, can_report: true })?.report).toEqual({
      mine: null,
      allowed: true,
    });
    expect(
      parseServerCard({
        ...card,
        my_report: { at: '2026-10-01T09:30:00.000Z' },
        can_report: true,
      })?.report,
    ).toEqual({ mine: { at: '2026-10-01T09:30:00Z' }, allowed: true });
    expect(parseServerCard({ ...card, my_report: null, can_report: false })?.report).toEqual({
      mine: null,
      allowed: false,
    });
    expect(
      parseServerCard({ ...card, my_report: { at: 'вчера' }, can_report: 'yes' })?.report,
    ).toEqual({ mine: null, allowed: false });
    const personal = { ...card, my_report: { at: '2026-10-01T09:30:00Z' }, can_report: true };
    expect(withoutPersonal(personal)).not.toHaveProperty('my_report');
    expect(withoutPersonal(personal)).not.toHaveProperty('can_report');
    expect(parseServerCard(withoutPersonal(personal))?.report).toBeNull();
  });

  it('card: my_vote only when it arrived, cached without it', () => {
    const voted = { ...card, my_vote: { can_vote_at: '2026-10-04T09:00:00Z' } };
    expect(parseServerCard(voted)?.my_vote).toEqual({ can_vote_at: '2026-10-04T09:00:00Z' });
    expect(parseServerCard({ ...card, my_vote: { can_vote_at: null } })?.my_vote).toEqual({
      can_vote_at: null,
    });
    expect(parseServerCard(card)).not.toHaveProperty('my_vote');
    for (const broken of ['soon', 5, '2026-13-40T00:00:00Z']) {
      expect(parseServerCard({ ...card, my_vote: { can_vote_at: broken } })).not.toHaveProperty(
        'my_vote',
      );
    }
    expect(withoutPersonal(voted)).not.toHaveProperty('my_vote');
    expect(withoutPersonal(voted)).toMatchObject({ id: card.id });
  });

  it('error body', () => {
    expect(parseErrorBody({ error: { code: 'server_not_found', message: 'нет' } })).toEqual({
      code: 'server_not_found',
      message: 'нет',
    });
    expect(parseErrorBody({ message: 'Laravel', exception: 'x' })).toBeNull();
  });
});

describe('scenes', () => {
  it('fixture manifest: layers without a URL go to the renderer, URLs stay in main', () => {
    const parsed = parseScenes(scenes, vi.fn());
    expect(parsed?.map((item) => item.scene.key)).toEqual([
      'pulse21',
      'taiga',
      'castlefireworks',
      'lighthouse',
    ]);
    const taiga = parsed?.find((item) => item.scene.key === 'taiga');
    expect(taiga?.scene.layers.day[0]).toEqual({ name: 'sky', depth: 0 });
    expect(taiga?.scene.in_library).toBe(true);
    expect(taiga?.sources.layers.day.sky).toMatch(/^https:\/\/mc-mon\.ru\/images\/landscapes\//);
    expect(taiga?.sources.thumbs.night).toMatch(/^https:\/\//);
    const holiday = parsed?.find((item) => item.scene.key === 'castlefireworks')?.scene;
    expect(holiday).toMatchObject({ purpose: 'holiday', dates: { from: '12-31', to: '01-01' } });
    expect(holiday?.priority).toBeTypeOf('number');
    expect(parsed?.find((item) => item.scene.key === 'pulse21')?.scene.hour).toBe(21);
    expect(parsed?.find((item) => item.scene.key === 'lighthouse')?.scene.moods).toEqual([
      'welcome',
      'night',
    ]);
  });

  it('the studio scene is accepted, an unknown purpose is skipped', () => {
    const [taiga] = scenes.filter((item) => item.key === 'taiga');
    const parsed = parseScenes(
      [
        { ...taiga, key: 'auroraspire', purpose: 'studio', in_library: false },
        { ...taiga, key: 'mystery', purpose: 'unknown-kind' },
      ],
      vi.fn(),
    );
    expect(parsed?.map((item) => item.scene.key)).toEqual(['auroraspire']);
    expect(parsed?.[0]?.scene.in_library).toBe(false);
  });

  it('unknown layer keys are ignored, anim without a string type is dropped', () => {
    const [pulse] = scenes.filter((item) => item.key === 'pulse21');
    const broken = { __PHP_Incomplete_Class_Name: 'App\\Scenes\\Anim' };
    const layers = pulse?.layers.day.map((item) => ({
      ...item,
      __PHP_Incomplete_Class_Name: 'App\\Scenes\\Layer',
      anim: broken,
    }));
    const parsed = parseScenes(
      [{ ...pulse, layers: { day: layers, sunset: layers, night: layers } }],
      vi.fn(),
    );
    expect(parsed?.[0]?.scene.hour).toBe(21);
    expect(parsed?.[0]?.scene.layers.day).toHaveLength(layers?.length ?? 0);
    expect(parsed?.[0]?.scene.layers.day.every((item) => item.anim === undefined)).toBe(true);
    expect(Object.keys(parsed?.[0]?.scene.layers.day[0] ?? {})).toEqual(['name', 'depth']);
  });

  it('hour window for a holiday', () => {
    const [holiday] = scenes.filter((item) => item.key === 'castlefireworks');
    const parsed = parseScenes([{ ...holiday, time: { from: '18:00', to: '06:00' } }], vi.fn());
    expect(parsed?.[0]?.scene.time).toEqual({ from: '18:00', to: '06:00' });
    const bad = parseScenes([{ ...holiday, time: { from: '25:00', to: '06:00' } }], vi.fn());
    expect(bad?.[0]?.scene.time).toBeUndefined();
  });

  it('layer animation from the manifest reaches the renderer', () => {
    const pulse = parseScenes(scenes, vi.fn())?.find((item) => item.scene.key === 'pulse21');
    expect(pulse?.scene.layers.day.find((item) => item.name === 'lamp')).toEqual({
      name: 'lamp',
      depth: 0.45,
      anim: { type: 'pulse', dur: 3, delay: 0, amp: 2, dir: 1, still: 1 },
    });
    expect(pulse?.scene.layers.day.find((item) => item.name === 'ground')?.anim).toBeUndefined();
  });

  function withAnim(anim: unknown): unknown {
    const [taiga] = scenes.filter((item) => item.key === 'taiga');
    const day = [
      { name: 'sky', depth: 0, url: 'https://mc-mon.ru/images/landscapes/t/sky.png' },
      { name: 'rain', depth: 1, url: 'https://mc-mon.ru/images/landscapes/t/rain.png', anim },
    ];
    return { ...taiga, layers: { day, sunset: day, night: day } };
  }

  function rainAnim(anim: unknown): unknown {
    const parsed = parseScenes([withAnim(anim)], vi.fn());
    expect(parsed?.[0]?.scene.layers.day.map((item) => item.name)).toEqual(['sky', 'rain']);
    return parsed?.[0]?.scene.layers.day[1]?.anim;
  }

  it('animation has default optional fields, steps is taken from the site', () => {
    expect(rainAnim({ type: 'fall', dur: 0.8 })).toEqual({
      type: 'fall',
      dur: 0.8,
      delay: 0,
      amp: 2,
      dir: 1,
      still: 1,
    });
    expect(
      rainAnim({ type: 'drift', dur: 90, delay: -4, amp: 0, dir: -1, still: 0, steps: 384 }),
    ).toEqual({ type: 'drift', dur: 90, delay: -4, amp: 0, dir: -1, still: 0, steps: 384 });
    expect(rainAnim({ type: 'twinkle', dur: 2, steps: 0 })).not.toHaveProperty('steps');
  });

  it.each(['launch', 'liftoff', 'ignite', 'quarter', 'puff'])(
    'animation type %s is kept as it is',
    (type) => {
      expect(rainAnim({ type, dur: 12, still: 0 })).toMatchObject({ type, dur: 12, still: 0 });
    },
  );

  it('unknown animation type — a still frame', () => {
    expect(rainAnim({ type: 'wobble', dur: 2, still: 0.4 })).toEqual({
      type: 'still',
      dur: 0,
      delay: 0,
      amp: 2,
      dir: 1,
      still: 0.4,
    });
  });

  it.each([
    ['not an object', 'fall'],
    ['still outside 0…1', { type: 'pulse', dur: 3, still: 2 }],
  ])('a broken animation (%s) is dropped, the layer and scene stay', (_case, anim) => {
    expect(rainAnim(anim)).toBeUndefined();
  });

  it.each([
    ['no duration', { type: 'fall', still: 0 }],
    ['zero duration', { type: 'fall', dur: 0, still: 0 }],
    ['flashes faster than 0.2 s', { type: 'flash', dur: 0.001, still: 0 }],
    ['bad direction', { type: 'drift', dur: 4, dir: 2, still: 0 }],
    ['fractional steps', { type: 'fall', dur: 3, steps: 1.5, still: 0 }],
    ['a string for the delay', { type: 'bob', dur: 1, delay: '1s', still: 0 }],
  ])('a broken animation (%s) becomes a still frame with its own still', (_case, anim) => {
    expect(rainAnim(anim)).toEqual({
      type: 'still',
      dur: 0,
      delay: 0,
      amp: 2,
      dir: 1,
      still: 0,
    });
  });

  it('a duration of 0.2 s is still an animation', () => {
    expect(rainAnim({ type: 'flash', dur: 0.2 })).toMatchObject({ type: 'flash', dur: 0.2 });
  });

  it('a scene without a sky, with a broken layer, or a repeated key is skipped', () => {
    const log = vi.fn();
    const [taiga] = scenes.filter((item) => item.key === 'taiga');
    const broken = [
      taiga,
      taiga,
      { ...taiga, key: 'nosky', skies: { day: 'red' } },
      { ...taiga, key: 'badlayer', layers: { day: [], sunset: [], night: [] } },
      { ...taiga, key: '../etc' },
    ];
    expect(parseScenes(broken, log)?.map((item) => item.scene.key)).toEqual(['taiga']);
    expect(log).toHaveBeenCalledTimes(4);
  });
});
