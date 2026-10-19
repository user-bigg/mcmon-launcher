import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOD_CHOICES,
  normalizeModChoices,
  type ModCatalog,
  type ServerModsSource,
  type ModChoices,
} from '@shared/mods';
import type { SiteResult } from '@shared/site';
import { parseModCatalog } from '../site/mods';
import modsBody from '../site/fixtures/mods.json';
import { createModsService, type ModChoicesStore } from './service';

const SERVERS: Partial<Record<number, ServerModsSource>> = {
  68: {
    state: 'known',
    modpack: false,
    mods: {
      required: ['simple-voice-chat'],
      optional: ['emotecraft'],
      forbidden: ['xaeros-minimap'],
    },
  },
  69: {
    state: 'known',
    modpack: false,
    mods: { required: [], optional: ['emotecraft'], forbidden: [] },
  },
};

const catalog = parseModCatalog(modsBody, {
  apiHosts: new Set(['mc-mon.ru']),
  log: () => undefined,
});

function store(): ModChoicesStore & { saved: number } {
  let choices: ModChoices = structuredClone(DEFAULT_MOD_CHOICES);
  return {
    saved: 0,
    get modChoices(): ModChoices {
      return structuredClone(choices);
    },
    saveModChoices(next): Promise<void> {
      choices = normalizeModChoices(next);
      this.saved += 1;
      return Promise.resolve();
    },
  };
}

function fetched(value: ModCatalog | null): () => Promise<SiteResult<ModCatalog>> {
  return () =>
    Promise.resolve(
      value === null
        ? { ok: false, error: { code: 'offline' } }
        : { ok: true, value, stale: false, fetchedAt: '2026-10-18T09:00:00Z' },
    );
}

function setup(value: ModCatalog | null = catalog): {
  service: ReturnType<typeof createModsService>;
  choices: ReturnType<typeof store>;
} {
  const choices = store();
  return {
    service: createModsService({
      catalog: fetched(value),
      serverMods: (serverId) => Promise.resolve(SERVERS[serverId] ?? { state: 'unknown' }),
      store: choices,
    }),
    choices,
  };
}

describe('mods service', () => {
  it('the catalog view is for the newest version unless the window names one', async () => {
    const { service } = setup();
    const view = await service.catalog();
    expect(view.ok && view.value.minecraft).toBe('26.2');
    const older = await service.catalog('1.21.11');
    expect(older.ok && older.value.minecraft).toBe('1.21.11');
  });

  it('a site that cannot be reached is an error for the window to show', async () => {
    const { service } = setup(null);
    expect(await service.catalog()).toEqual({ ok: false, error: { code: 'offline' } });
    expect(await service.serverPlan({ serverId: 68, minecraft: '1.21.11' })).toEqual({
      ok: false,
      error: { code: 'offline' },
    });
  });

  it('saves the mods of the player and the shader choice', async () => {
    const { service, choices } = setup();
    expect(
      await service.setChoices({ enabled: ['sodium', 'iris', 'sodium'], shaders: 'light' }),
    ).toEqual({
      ok: true,
      value: { enabled: ['sodium', 'iris'], shaders: 'light', optionalOff: {} },
    });
    expect(await service.setChoices({ shaders: 'off' })).toMatchObject({
      ok: true,
      value: { enabled: ['sodium', 'iris'], shaders: 'off' },
    });
    expect(choices.saved).toBe(2);
  });

  it.each([
    null,
    'sodium',
    { enabled: 'sodium' },
    { enabled: ['../evil'] },
    { enabled: Array.from({ length: 257 }, (_, index) => `mod-${String(index)}`) },
    { shaders: 'ultra' },
  ])('refuses the choice %j and keeps the old one', async (patch) => {
    const { service, choices } = setup();
    expect(await service.setChoices(patch)).toEqual({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(choices.saved).toBe(0);
  });

  it('turns an optional mod off and on again for one server only', async () => {
    const { service } = setup();
    expect(await service.setServerOptional(68, 'emotecraft', false)).toMatchObject({
      ok: true,
      value: { optionalOff: { '68': ['emotecraft'] } },
    });
    const plan = await service.serverPlan({ serverId: 68, minecraft: '1.21.11' });
    expect(
      plan.ok && plan.value.mods.map((item) => [item.slug, item.role, item.state, item.enabled]),
    ).toEqual([
      ['simple-voice-chat', 'required', 'on', true],
      ['emotecraft', 'optional', 'off_by_player', false],
      ['xaeros-minimap', 'forbidden', 'forbidden', false],
    ]);
    const other = await service.serverPlan({ serverId: 69, minecraft: '1.21.11' });
    expect(other.ok && other.value.mods[0]).toMatchObject({
      slug: 'emotecraft',
      state: 'on',
      channel: 'beta',
    });
    expect(await service.setServerOptional(68, 'emotecraft', true)).toMatchObject({
      ok: true,
      value: { optionalOff: {} },
    });
  });

  it.each([
    [0, 'emotecraft', false],
    [68, '../x', false],
    [68, 'emotecraft', 'no'],
    ['68', 'emotecraft', false],
  ])('refuses to turn %j %j %j', async (serverId, slug, on) => {
    const { service } = setup();
    expect(await service.setServerOptional(serverId as number, slug, on as boolean)).toEqual({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });

  it.each([
    null,
    { serverId: 0, minecraft: '1.21.11' },
    { serverId: 68, minecraft: '../1.21' },
    { serverId: '68', minecraft: '1.21.11' },
    { serverId: 68 },
  ])('refuses the server query %j', async (query) => {
    const { service } = setup();
    expect(await service.serverPlan(query as never)).toEqual({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });

  it('takes the mods of the server from the site, never from the window', async () => {
    const { service } = setup();
    const unknown = await service.serverPlan({
      serverId: 70,
      minecraft: '1.21.11',
      mods: { required: [], optional: [], forbidden: [] },
    });
    expect(unknown.ok && unknown.value).toMatchObject({ known: false, installs: false, mods: [] });
  });

  it('a version that is not a version is refused', async () => {
    const { service } = setup();
    expect(await service.catalog('../../etc')).toEqual({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });
});
