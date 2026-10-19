import { describe, expect, it } from 'vitest';
import {
  catalogView,
  clipText,
  isModSlug,
  serverModsOf,
  DEFAULT_MOD_CHOICES,
  fabricFloor,
  modLabels,
  modsLoaderMin,
  modSteps,
  newestMinecraft,
  normalizeModChoices,
  NO_SERVER_MODS,
  planMods,
  serverModsView,
  telemetryMods,
  withFailures,
  type CatalogMod,
  type ModCatalog,
  type ModFile,
  type ModsPlan,
  type ModsQuestion,
} from './mods';

const MC = '1.21.11';

type Row = Omit<ModFile, 'requires'> & { requires?: string[] };

function file(slug: string, patch: Partial<ModFile> = {}): Row {
  return {
    minecraft: MC,
    loader: 'fabric',
    loader_min: '0.16.10',
    version: `${slug}-1.0`,
    channel: 'release',
    urls: [`https://mc-mon.ru/storage/mods/${slug}.jar`],
    sha256: 'a'.repeat(64),
    size: 1000,
    ...patch,
  };
}

function mod(
  slug: string,
  patch: Partial<Omit<CatalogMod, 'files'>> & { files?: Row[] } = {},
): CatalogMod {
  const requires = patch.requires ?? [];
  const files = (patch.files ?? [file(slug)]).map((row) => ({
    ...row,
    requires: row.requires ?? requires,
  }));
  return {
    slug,
    kind: 'mod',
    title: `Title ${slug}`,
    short: `Short ${slug}`,
    summary: `Summary ${slug}`,
    group: 'interface',
    player: true,
    server: false,
    often_forbidden: false,
    modrinth_id: 'AAAAAAAA',
    license: 'MIT',
    source_url: null,
    credit: null,
    options: null,
    ...patch,
    requires,
    files,
  };
}

function pack(slug: string): CatalogMod {
  return mod(slug, {
    kind: 'shader_pack',
    player: false,
    group: 'graphics',
    requires: ['iris'],
    files: [file(slug, { loader: null, loader_min: null, urls: [`https://x/${slug}.zip`] })],
  });
}

const catalog: ModCatalog = {
  updated_at: null,
  mods: [
    mod('fabric-api', { player: false }),
    mod('rso', { player: false }),
    mod('sodium', {
      requires: ['rso'],
      group: 'optimization',
      files: [file('sodium', { loader_min: '0.17.2' })],
    }),
    mod('iris', { requires: ['sodium'], group: 'graphics' }),
    mod('minimap', { often_forbidden: true }),
    mod('appleskin'),
    mod('voice', {
      server: true,
      group: 'sound',
      files: [file('voice'), file('voice', { minecraft: '26.2' })],
    }),
    mod('emotes', {
      player: false,
      server: true,
      requires: ['fabric-api'],
      files: [file('emotes', { channel: 'beta', loader_min: '0.19.1' })],
    }),
    mod('old-only', { files: [file('old-only', { minecraft: '1.20.1' })] }),
    mod('no-address', { files: [file('no-address', { urls: [] })] }),
    mod('needs-old', { requires: ['old-only'] }),
    pack('light-pack'),
    pack('pretty-pack'),
  ],
  shaders: { light: 'light-pack', beautiful: 'pretty-pack' },
};

function ask(patch: Partial<ModsQuestion> = {}): ModsPlan {
  const plan = planMods({
    catalog,
    minecraft: MC,
    place: 'server',
    server: NO_SERVER_MODS,
    enabled: [],
    shaders: 'off',
    optionalOff: [],
    ...patch,
  });
  if (plan === null) {
    throw new Error('no plan');
  }
  return plan;
}

function states(plan: ModsPlan): Record<string, string> {
  return Object.fromEntries(plan.entries.map((entry) => [entry.slug, entry.state]));
}

function installed(plan: ModsPlan): string[] {
  return plan.installs.map(({ mod: item }) => item.slug);
}

describe('planMods: where mods go', () => {
  it('a server with a modpack gets no catalog mods at all', () => {
    const question = {
      catalog,
      minecraft: MC,
      server: NO_SERVER_MODS,
      enabled: ['appleskin'],
      shaders: 'off' as const,
      optionalOff: [],
    };
    expect(planMods({ ...question, place: 'modpack' })).toBeNull();
  });

  it('every mod is off by default: nothing is installed without a choice or a server', () => {
    expect(ask()).toMatchObject({ entries: [], installs: [], refused: null, shaderPack: null });
    expect(DEFAULT_MOD_CHOICES).toEqual({ enabled: [], shaders: 'off', optionalOff: {} });
  });
});

describe('planMods: server mods', () => {
  it('required and optional mods go in with their dependencies, dependencies first', () => {
    const plan = ask({ server: { required: ['voice'], optional: ['emotes'], forbidden: [] } });
    expect(states(plan)).toEqual({ voice: 'on', emotes: 'on' });
    expect(installed(plan)).toEqual(['voice', 'fabric-api', 'emotes']);
    expect(plan.refused).toBeNull();
  });

  it('a required mod without a file for this version refuses the launch as missing', () => {
    expect(
      ask({ server: { required: ['old-only'], optional: [], forbidden: [] } }).refused,
    ).toEqual({
      kind: 'missing',
      slugs: ['old-only'],
    });
    expect(
      ask({ server: { required: ['no-address'], optional: [], forbidden: [] } }).refused?.kind,
    ).toBe('missing');
    expect(
      ask({ server: { required: ['needs-old'], optional: [], forbidden: [] } }).refused?.kind,
    ).toBe('missing');
  });

  it('an unknown required slug refuses the launch, an unknown optional or forbidden one is skipped', () => {
    const plan = ask({
      server: { required: ['mystery'], optional: ['ghost'], forbidden: ['phantom'] },
    });
    expect(plan.refused).toEqual({ kind: 'missing', slugs: ['mystery'] });
    expect(states(plan)).toEqual({ mystery: 'no_file' });
    expect(telemetryMods(plan).map((item) => item.slug)).toEqual(['mystery']);
  });

  it('a required mod for another game version is fine where the version has a file', () => {
    expect(
      ask({ minecraft: '26.2', server: { required: ['voice'], optional: [], forbidden: [] } })
        .refused,
    ).toBeNull();
  });

  it('an optional mod without a file is played without', () => {
    const plan = ask({ server: { required: [], optional: ['old-only'], forbidden: [] } });
    expect(plan.refused).toBeNull();
    expect(states(plan)).toEqual({ 'old-only': 'no_file' });
  });

  it('an optional mod the player turned off for this server stays out', () => {
    const plan = ask({
      server: { required: [], optional: ['emotes'], forbidden: [] },
      optionalOff: ['emotes'],
    });
    expect(states(plan)).toEqual({ emotes: 'off_by_player' });
    expect(installed(plan)).toEqual([]);
  });

  it('a slug listed twice is planned once, required first', () => {
    const plan = ask({
      server: { required: ['voice'], optional: ['voice'], forbidden: [] },
      enabled: ['voice'],
    });
    expect(plan.entries).toEqual([
      { slug: 'voice', role: 'required', state: 'on', needs: ['voice'] },
    ]);
  });
});

describe('planMods: player mods and the forbidden list', () => {
  it('the mods the player enabled go in with what they need', () => {
    const plan = ask({ enabled: ['iris', 'appleskin'] });
    expect(installed(plan)).toEqual(['rso', 'sodium', 'iris', 'appleskin']);
    expect(states(plan)).toEqual({ iris: 'on', appleskin: 'on' });
  });

  it('a forbidden mod stays out on this server, neither by itself nor as a dependency', () => {
    const plan = ask({
      server: { required: [], optional: [], forbidden: ['minimap', 'sodium'] },
      enabled: ['minimap', 'iris', 'appleskin'],
    });
    expect(states(plan)).toEqual({ minimap: 'forbidden', iris: 'forbidden', appleskin: 'on' });
    expect(installed(plan)).toEqual(['appleskin']);
  });

  it('shaders are off on a server that forbids Iris or Sodium', () => {
    for (const forbidden of [['iris'], ['sodium']]) {
      const plan = ask({ server: { required: [], optional: [], forbidden }, shaders: 'beautiful' });
      expect(states(plan)).toEqual({ 'pretty-pack': 'forbidden' });
      expect(plan.shaderPack).toBeNull();
    }
  });

  it('the forbidden list names only mods of players: a dependency there is not a ban', () => {
    const plan = ask({
      server: { required: [], optional: [], forbidden: ['rso'] },
      enabled: ['sodium'],
    });
    expect(states(plan)).toEqual({ sodium: 'on' });
  });

  it('a forbidden mod in the required list makes the server impossible to enter', () => {
    const plan = ask({ server: { required: ['minimap'], optional: [], forbidden: ['minimap'] } });
    expect(plan.refused).toEqual({ kind: 'missing', slugs: ['minimap'] });
  });

  it('a mod that is not for players, a shader pack or an unknown slug is not enabled by hand', () => {
    const plan = ask({ enabled: ['emotes', 'light-pack', 'gone'] });
    expect(plan.entries).toEqual([]);
  });
});

describe('planMods: shaders', () => {
  it('the chosen pack goes in with Iris and Sodium', () => {
    const plan = ask({ shaders: 'light' });
    expect(installed(plan)).toEqual(['rso', 'sodium', 'iris', 'light-pack']);
    expect(plan.shaderPack).toBe('light-pack');
    expect(ask({ shaders: 'beautiful' }).shaderPack).toBe('pretty-pack');
  });

  it('no shaders in the catalog means no pack whatever the choice', () => {
    const plan = ask({ catalog: { ...catalog, shaders: null }, shaders: 'light' });
    expect(plan.entries).toEqual([]);
  });
});

describe('planMods: without a catalog', () => {
  it('a server with a required mod asks to retry', () => {
    const plan = ask({
      catalog: null,
      server: { required: ['voice'], optional: ['emotes'], forbidden: [] },
      enabled: ['appleskin'],
      optionalOff: [],
    });
    expect(plan.refused).toEqual({ kind: 'failed', slugs: ['voice'] });
    expect(plan.installs).toEqual([]);
  });

  it('without required mods the game goes on, nothing is installed and nothing is reported', () => {
    const plan = ask({
      catalog: null,
      enabled: ['appleskin', 'gone'],
      shaders: 'light',
      server: { required: [], optional: ['ghost'], forbidden: ['appleskin'] },
      optionalOff: ['ghost'],
    });
    expect(plan.refused).toBeNull();
    expect(plan.installs).toEqual([]);
    expect(telemetryMods(plan)).toEqual([]);
  });
});

describe('withFailures', () => {
  it('a file that did not come takes down every mod that needs it', () => {
    const plan = ask({ enabled: ['iris', 'appleskin'], shaders: 'light' });
    const after = withFailures(plan, catalog, new Set(['rso']));
    expect(states(after)).toEqual({ iris: 'failed', appleskin: 'on', 'light-pack': 'failed' });
    expect(installed(after)).toEqual(['appleskin']);
    expect(after.shaderPack).toBeNull();
  });

  it('a required mod that did not come refuses the launch with a retry', () => {
    const plan = ask({ server: { required: ['emotes'], optional: [], forbidden: [] } });
    expect(withFailures(plan, catalog, new Set(['fabric-api'])).refused).toEqual({
      kind: 'failed',
      slugs: ['emotes'],
    });
  });

  it('nothing failed leaves the plan as it is', () => {
    const plan = ask({ enabled: ['appleskin'] });
    expect(withFailures(plan, catalog, new Set())).toBe(plan);
  });
});

describe('dependencies of the row picked for the game version', () => {
  const NEW = '26.2';
  const LATER = '26.3';
  const byVersion: ModCatalog = {
    updated_at: null,
    mods: [
      mod('fabric-api', {
        player: false,
        files: [file('fabric-api'), file('fabric-api', { minecraft: NEW })],
      }),
      mod('animlib', {
        files: [file('animlib', { minecraft: NEW, size: 300 })],
      }),
      mod('emotecraft', {
        requires: ['fabric-api', 'animlib'],
        files: [
          file('emotecraft', { requires: ['fabric-api'] }),
          file('emotecraft', { minecraft: NEW, requires: ['fabric-api', 'animlib'] }),
          file('emotecraft', { minecraft: LATER, requires: ['animlib'] }),
        ],
      }),
      mod('iris', {
        group: 'graphics',
        files: [file('iris'), file('iris', { minecraft: NEW })],
      }),
      mod('light-pack', {
        kind: 'shader_pack',
        player: false,
        requires: ['iris'],
        files: [
          file('light-pack', { loader: null, loader_min: null }),
          file('light-pack', { minecraft: NEW, loader: null, loader_min: null }),
        ],
      }),
    ],
    shaders: { light: 'light-pack', beautiful: 'light-pack' },
  };

  function on(minecraft: string, patch: Partial<ModsQuestion> = {}): ModsPlan {
    return ask({ catalog: byVersion, minecraft, enabled: ['emotecraft'], ...patch });
  }

  it('a mod brings only what its row for this version needs', () => {
    expect(installed(on(MC))).toEqual(['fabric-api', 'emotecraft']);
    expect(installed(on(NEW))).toEqual(['fabric-api', 'animlib', 'emotecraft']);
  });

  it('a dependency without a row for the version makes the mod unavailable only there', () => {
    expect(states(on(LATER))).toEqual({ emotecraft: 'no_file' });
    expect(installed(on(LATER))).toEqual([]);
    expect(states(on(MC))).toEqual({ emotecraft: 'on' });
  });

  it('a ban follows what the mod needs on any version', () => {
    const plan = on(MC, { server: { required: [], optional: [], forbidden: ['animlib'] } });
    expect(states(plan)).toEqual({ emotecraft: 'forbidden' });
  });

  it('the views count the sizes and the shader needs of the picked row', () => {
    const size = (minecraft: string): number | null | undefined =>
      catalogView(byVersion, DEFAULT_MOD_CHOICES, minecraft)
        .groups.flatMap((group) => group.mods)
        .find((item) => item.slug === 'emotecraft')?.totalSize;
    expect(size(MC)).toBe(2000);
    expect(size(NEW)).toBe(2300);
    expect(size(LATER)).toBeNull();
    for (const minecraft of [MC, NEW, LATER]) {
      expect(catalogView(byVersion, DEFAULT_MOD_CHOICES, minecraft).shaders?.needs).toEqual([
        'iris',
      ]);
    }
    const server = serverModsView(
      { serverId: 1, minecraft: NEW },
      {
        state: 'known',
        modpack: false,
        mods: { required: ['emotecraft'], optional: [], forbidden: [] },
      },
      byVersion,
      DEFAULT_MOD_CHOICES,
    );
    expect(server.mods[0]).toMatchObject({ slug: 'emotecraft', available: true, totalSize: 2300 });
  });
});

describe('dependencies that differ by version further down the chain', () => {
  const NEW = '26.2';
  const chain: ModCatalog = {
    updated_at: null,
    mods: [
      mod('x', { player: false }),
      mod('fabric-api', {
        player: false,
        requires: ['x'],
        files: [
          file('fabric-api', { requires: [] }),
          file('fabric-api', { minecraft: NEW, requires: ['x'] }),
        ],
      }),
      mod('animlib', { player: false, files: [file('animlib', { minecraft: NEW })] }),
      mod('emotecraft', {
        requires: ['fabric-api', 'animlib'],
        files: [
          file('emotecraft', { requires: ['fabric-api'] }),
          file('emotecraft', { minecraft: NEW, requires: ['fabric-api', 'animlib'] }),
        ],
      }),
      mod('late', { files: [file('late', { minecraft: '26.3', requires: ['x'] })] }),
    ],
    shaders: null,
  };

  function on(minecraft: string): ModsPlan {
    return ask({ catalog: chain, minecraft, enabled: ['emotecraft'] });
  }

  it('a dependency of a dependency without a row for the version takes the mod down there only', () => {
    expect(states(on(NEW))).toEqual({ emotecraft: 'no_file' });
    expect(states(on(MC))).toEqual({ emotecraft: 'on' });
    expect(installed(on(MC))).toEqual(['fabric-api', 'emotecraft']);
  });

  it('a failed dependency of another version leaves the mod in the game', () => {
    const plan = on(MC);
    const after = withFailures(plan, chain, new Set(['animlib', 'x']));
    expect(states(after)).toEqual({ emotecraft: 'on' });
    expect(installed(after)).toEqual(['fabric-api', 'emotecraft']);
    expect(states(withFailures(plan, chain, new Set(['fabric-api'])))).toEqual({
      emotecraft: 'failed',
    });
  });

  it('telemetry names the mod as on or without a file, never its dependencies', () => {
    expect(telemetryMods(on(MC))).toEqual([
      { slug: 'emotecraft', state: 'on', version: 'emotecraft-1.0' },
    ]);
    expect(telemetryMods(on(NEW))).toEqual([{ slug: 'emotecraft', state: 'no_file' }]);
  });

  it('the default version is the newest one where some mod comes with all it needs', () => {
    expect(newestMinecraft(chain)).toBe(NEW);
  });
});

describe('loader for the mods', () => {
  it('is the highest loader_min of the mods in the launch, by numbers', () => {
    expect(modsLoaderMin(ask({ enabled: ['appleskin'] }))).toBe('0.16.10');
    expect(modsLoaderMin(ask({ enabled: ['appleskin', 'sodium'] }))).toBe('0.17.2');
    expect(
      modsLoaderMin(
        ask({ enabled: ['sodium'], server: { required: ['emotes'], optional: [], forbidden: [] } }),
      ),
    ).toBe('0.19.1');
  });

  it('is never below 0.15.0 and is none without mods', () => {
    const low = {
      ...catalog,
      mods: [mod('tiny', { files: [file('tiny', { loader_min: '0.9.3' })] })],
    };
    expect(modsLoaderMin(ask({ catalog: low, enabled: ['tiny'] }))).toBe('0.15.0');
    expect(modsLoaderMin(ask())).toBeNull();
    expect(modsLoaderMin(null)).toBeNull();
  });

  it('compares numbers, not text', () => {
    const versions = {
      ...catalog,
      mods: [
        mod('a', { files: [file('a', { loader_min: '0.9.10' })] }),
        mod('b', { files: [file('b', { loader_min: '0.16.2' })] }),
      ],
    };
    expect(modsLoaderMin(ask({ catalog: versions, enabled: ['a', 'b'] }))).toBe('0.16.2');
  });

  it('the floor of the game version follows the line minimum: 0.18.4 from 26.1 on', () => {
    expect(fabricFloor('1.21.11')).toBe('0.15.0');
    expect(fabricFloor('1.14')).toBe('0.15.0');
    expect(fabricFloor('26.1')).toBe('0.18.4');
    expect(fabricFloor('26.2')).toBe('0.18.4');
    expect(fabricFloor('26.1-snapshot-1')).toBe('0.15.0');
  });
});

describe('telemetryMods', () => {
  it('an optional mod turned off by the player but needed by another one is on', () => {
    const withDependency = {
      ...catalog,
      mods: [
        ...catalog.mods,
        mod('needs-emotes', { player: false, server: true, requires: ['emotes'] }),
      ],
    };
    const plan = ask({
      catalog: withDependency,
      server: { required: ['needs-emotes'], optional: ['emotes'], forbidden: [] },
      optionalOff: ['emotes'],
    });
    expect(installed(plan)).toEqual(['fabric-api', 'emotes', 'needs-emotes']);
    expect(telemetryMods(plan)).toEqual([
      { slug: 'needs-emotes', state: 'on', version: 'needs-emotes-1.0' },
      { slug: 'emotes', state: 'on', version: 'emotes-1.0' },
    ]);
    const failed = withFailures(plan, withDependency, new Set(['fabric-api']));
    expect(telemetryMods(failed)).toEqual([
      { slug: 'needs-emotes', state: 'failed' },
      { slug: 'emotes', state: 'off_by_player' },
    ]);
  });

  it('names server mods, enabled player mods and the forbidden ones once, without dependencies', () => {
    const plan = ask({
      server: { required: ['voice'], optional: ['emotes', 'old-only'], forbidden: ['minimap'] },
      enabled: ['minimap', 'appleskin', 'voice'],
      optionalOff: ['emotes'],
      shaders: 'light',
    });
    expect(telemetryMods(plan)).toEqual([
      { slug: 'voice', state: 'on', version: 'voice-1.0' },
      { slug: 'emotes', state: 'off_by_player' },
      { slug: 'old-only', state: 'no_file' },
      { slug: 'minimap', state: 'forbidden' },
      { slug: 'appleskin', state: 'on', version: 'appleskin-1.0' },
      { slug: 'light-pack', state: 'on', version: 'light-pack-1.0' },
    ]);
  });

  it('a failed mod has no version and an empty plan gives an empty list', () => {
    const plan = withFailures(ask({ enabled: ['appleskin'] }), catalog, new Set(['appleskin']));
    expect(telemetryMods(plan)).toEqual([{ slug: 'appleskin', state: 'failed' }]);
    expect(telemetryMods(ask())).toEqual([]);
    expect(telemetryMods(null)).toEqual([]);
  });
});

describe('modSteps', () => {
  it('lists each file to install with its role, dependency group, beta channel and size', () => {
    const plan = ask({
      server: { required: ['voice'], optional: ['emotes'], forbidden: ['minimap'] },
      enabled: ['minimap'],
    });
    const steps = modSteps(plan, catalog);
    expect(
      steps.steps.map((step) => [step.slug, step.role, step.dependencyOf, step.channel]),
    ).toEqual([
      ['voice', 'required', [], 'release'],
      ['fabric-api', 'dependency', ['emotes'], 'release'],
      ['emotes', 'optional', [], 'beta'],
    ]);
    expect(steps.steps[0]).toMatchObject({
      short: 'Short voice',
      title: 'Title voice',
      version: 'voice-1.0',
      size: 1000,
      bytesDone: 0,
      status: 'wait',
      fromDisk: false,
    });
    expect(steps.skipped).toEqual([
      {
        slug: 'minimap',
        short: 'Short minimap',
        title: 'Title minimap',
        state: 'forbidden',
        role: 'player',
      },
    ]);
  });
});

describe('modLabels', () => {
  it('gives short and title for the error screen, and only the slug for an unknown mod', () => {
    expect(modLabels(catalog, ['voice', 'mystery'])).toEqual([
      { slug: 'voice', short: 'Short voice', title: 'Title voice' },
      { slug: 'mystery', short: null, title: null },
    ]);
  });
});

describe('normalizeModChoices', () => {
  it('keeps valid slugs once, a known shader choice and optional mods per server', () => {
    expect(
      normalizeModChoices({
        enabled: ['sodium', 'sodium', '../x', 5, 'Iris'],
        shaders: 'light',
        optionalOff: { '68': ['voice', 'bad slug'], abc: ['x'], '0': ['y'], '7': [] },
      }),
    ).toEqual({ enabled: ['sodium'], shaders: 'light', optionalOff: { '68': ['voice'] } });
  });

  it('anything else is the default with every mod off', () => {
    for (const value of [null, 'x', [], { shaders: 'ultra' }]) {
      expect(normalizeModChoices(value)).toEqual(DEFAULT_MOD_CHOICES);
    }
  });
});

describe('views for the window', () => {
  const choices = {
    enabled: ['sodium'],
    shaders: 'light' as const,
    optionalOff: { '68': ['emotes'] },
  };

  it('the catalog view groups mods of players in the launcher order with sizes for the version', () => {
    const view = catalogView(catalog, choices, MC);
    expect(view.groups.map((group) => group.group)).toEqual([
      'optimization',
      'graphics',
      'interface',
      'sound',
    ]);
    const sodium = view.groups[0]?.mods[0];
    expect(sodium).toMatchObject({
      slug: 'sodium',
      enabled: true,
      available: true,
      size: 1000,
      totalSize: 2000,
    });
    const interfaceMods = view.groups.find((group) => group.group === 'interface')?.mods ?? [];
    expect(interfaceMods.map((item) => [item.slug, item.available, item.often_forbidden])).toEqual([
      ['minimap', true, true],
      ['appleskin', true, false],
      ['old-only', false, false],
      ['no-address', false, false],
      ['needs-old', false, false],
    ]);
    expect(view.shaders).toMatchObject({
      choice: 'light',
      packs: [{ choice: 'light', slug: 'light-pack', totalSize: 4000 }, { choice: 'beautiful' }],
    });
    expect(view.enabledCount).toBe(1);
  });

  it('the catalog view names what the shader packs bring and credits every mod of the catalog', () => {
    const view = catalogView(catalog, choices, MC);
    expect(view.shaders?.needs).toEqual(['iris']);
    expect(view.credits.map((item) => item.slug)).toEqual(catalog.mods.map((mod) => mod.slug));
    expect(view.credits[0]).toEqual({
      slug: catalog.mods[0]?.slug,
      kind: catalog.mods[0]?.kind,
      title: catalog.mods[0]?.title,
      credit: catalog.mods[0]?.credit,
      license: catalog.mods[0]?.license,
      source_url: catalog.mods[0]?.source_url,
      modrinth_id: catalog.mods[0]?.modrinth_id,
    });
  });

  it('the server view lists required, optional, forbidden and the player mods for this server', () => {
    const view = serverModsView(
      { serverId: 68, minecraft: MC },
      {
        state: 'known',
        modpack: false,
        mods: {
          required: ['voice', 'mystery'],
          optional: ['emotes'],
          forbidden: ['minimap', 'sodium'],
        },
      },
      catalog,
      choices,
    );
    expect(view.known).toBe(true);
    expect(view.installs).toBe(true);
    expect(view.unknownRequired).toEqual(['mystery']);
    expect(
      view.mods.map((item) => [item.slug, item.role, item.state, item.enabled, item.available]),
    ).toEqual([
      ['voice', 'required', 'on', true, true],
      ['emotes', 'optional', 'off_by_player', false, true],
      ['sodium', 'forbidden', 'forbidden', true, true],
      ['light-pack', 'shaders', 'forbidden', true, true],
      ['minimap', 'forbidden', 'forbidden', false, true],
    ]);
    expect(view.mods.find((item) => item.slug === 'emotes')).toMatchObject({
      channel: 'beta',
      short: 'Short emotes',
      totalSize: 2000,
    });
  });

  it('a server with a modpack gets no mods in its view', () => {
    const view = serverModsView(
      { serverId: 1, minecraft: MC },
      { state: 'known', modpack: true, mods: NO_SERVER_MODS },
      catalog,
      choices,
    );
    expect(view).toMatchObject({ known: true, installs: false, mods: [], unknownRequired: [] });
  });

  it('a server whose mods are unknown says so and lists nothing', () => {
    const view = serverModsView(
      { serverId: 1, minecraft: MC },
      { state: 'unknown' },
      catalog,
      choices,
    );
    expect(view).toEqual({
      serverId: 1,
      minecraft: MC,
      known: false,
      installs: false,
      mods: [],
      unknownRequired: [],
    });
  });
});

describe('slugs and texts', () => {
  it('a slug may not be a device name of Windows', () => {
    for (const slug of ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9']) {
      expect(isModSlug(slug)).toBe(false);
    }
    for (const slug of ['console', 'com10', 'com0', 'nul-mod', 'sodium']) {
      expect(isModSlug(slug)).toBe(true);
    }
  });

  it('a long text is cut at a word with an ellipsis, a short one stays', () => {
    expect(clipText('Игра идёт плавнее', 40)).toBe('Игра идёт плавнее');
    expect(clipText('Игра идёт плавнее и настройки графики понятнее', 20)).toBe(
      'Игра идёт плавнее…',
    );
    expect(clipText('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(clipText('С\u202eкрытым\u0007 текстом\nв две строки', 80)).toBe(
      'Скрытым текстом в две строки',
    );
  });
});

describe('serverModsOf', () => {
  it('reads the mods of a direct launch and calls everything else unknown', () => {
    const mods = { required: ['voice'], optional: [], forbidden: [] };
    expect(serverModsOf({ kind: 'direct', minecraft: MC, mods })).toEqual({
      state: 'known',
      mods,
      modpack: false,
    });
    expect(serverModsOf({ kind: 'direct', minecraft: MC })).toEqual({
      state: 'known',
      mods: NO_SERVER_MODS,
      modpack: false,
    });
    expect(serverModsOf({ kind: 'direct', minecraft: MC, modpack: true, mods })).toEqual({
      state: 'known',
      mods: NO_SERVER_MODS,
      modpack: true,
    });
    expect(serverModsOf({ kind: 'direct', minecraft: MC, modsUnreadable: true })).toEqual({
      state: 'unknown',
    });
    expect(serverModsOf({ kind: 'none' })).toEqual({ state: 'unknown' });
    expect(serverModsOf(null)).toEqual({ state: 'unknown' });
  });
});
