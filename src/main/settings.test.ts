import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';

vi.mock('electron', () => ({ BrowserWindow: {}, ipcMain: {} }));

const { createPlayersService, createSettingsService, LauncherSettingsStore } =
  await import('./settings');

function memoryFs(initial?: string): {
  files: Map<string, string>;
  read: (file: string) => Promise<string>;
  write: (file: string, content: string) => Promise<void>;
} {
  const files = new Map<string, string>();
  if (initial !== undefined) {
    files.set('/data/settings.json', initial);
  }
  return {
    files,
    read: (file): Promise<string> => {
      const content = files.get(file);
      return content === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(content);
    },
    write: (file, content): Promise<void> => {
      files.set(file, content);
      return Promise.resolve();
    },
  };
}

describe('launcher settings in main', () => {
  it('without a file, defaults are used; editing writes the file', async () => {
    const fs = memoryFs();
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.load();
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    await store.update({ whileGame: 'keep' });
    const saved = JSON.parse(fs.files.get('/data/settings.json') ?? '{}') as {
      settings: { whileGame: string };
    };
    expect(saved.settings.whileGame).toBe('keep');
  });

  it('a corrupt file or foreign values are replaced with defaults field by field', async () => {
    const fs = memoryFs(
      JSON.stringify({ settings: { whileGame: 'explode', ramGb: 8, jvmArgs: '-Xmx8G' } }),
    );
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.load();
    expect(store.settings).toEqual({ ...DEFAULT_SETTINGS, ramGb: 8 });
    const broken = new LauncherSettingsStore('/data/settings.json', memoryFs('{'));
    await broken.load();
    expect(broken.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('autostart turned off stays off after another setting is saved', async () => {
    const fs = memoryFs(JSON.stringify({ settings: { ...DEFAULT_SETTINGS, autostart: false } }));
    const existing = new LauncherSettingsStore('/data/settings.json', fs);
    await existing.load();
    expect(existing.settings.autostart).toBe(false);
    await existing.update({ ramGb: 8 });
    const saved = JSON.parse(fs.files.get('/data/settings.json') ?? '{}') as {
      settings: { autostart: boolean };
    };
    expect(saved.settings.autostart).toBe(false);
  });

  it('remembers that the tray hints were shown, each on its own', async () => {
    const fs = memoryFs();
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.load();
    expect(store.hints).toEqual({
      trayNotified: false,
      leftInTrayNotified: false,
      moveDeclined: false,
    });
    await store.markHint('leftInTrayNotified');
    const again = new LauncherSettingsStore('/data/settings.json', fs);
    await again.load();
    expect(again.hints).toEqual({
      trayNotified: false,
      leftInTrayNotified: true,
      moveDeclined: false,
    });
  });

  it('keeps the mod choices of the player, every mod off until chosen', async () => {
    const fs = memoryFs();
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.load();
    expect(store.modChoices).toEqual({ enabled: [], shaders: 'off', optionalOff: {} });
    await store.saveModChoices({
      enabled: ['sodium', '../evil'],
      shaders: 'beautiful',
      optionalOff: { '68': ['emotecraft'] },
    });
    const again = new LauncherSettingsStore('/data/settings.json', fs);
    await again.load();
    expect(again.modChoices).toEqual({
      enabled: ['sodium'],
      shaders: 'beautiful',
      optionalOff: { '68': ['emotecraft'] },
    });
    const copy = again.modChoices;
    copy.enabled.push('iris');
    expect(again.modChoices.enabled).toEqual(['sodium']);
  });

  it('keeps only the number of favorites, and drops it when told to forget', async () => {
    const fs = memoryFs();
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.load();
    expect(store.favoritesCount).toBeNull();
    await store.rememberFavorites(7);
    expect(JSON.parse(fs.files.get('/data/settings.json') ?? '{}')).toMatchObject({
      favoritesCount: 7,
    });
    const again = new LauncherSettingsStore('/data/settings.json', fs);
    await again.load();
    expect(again.favoritesCount).toBe(7);
    await again.rememberFavorites(null);
    expect(again.favoritesCount).toBeNull();
    expect(fs.files.get('/data/settings.json')).toContain('"favoritesCount": null');
  });

  it.each([-1, 1.5, 1e9, '7', [1, 2]])('a remembered count of %j is not trusted', async (value) => {
    const fs = memoryFs(JSON.stringify({ favoritesCount: value }));
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.load();
    expect(store.favoritesCount).toBeNull();
  });

  it('the tray hint is remembered', async () => {
    const fs = memoryFs();
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.markHint('trayNotified');
    const again = new LauncherSettingsStore('/data/settings.json', fs);
    await again.load();
    expect(again.hints.trayNotified).toBe(true);
  });

  it('skipped update versions are stored in settings.json and cleaned up on read', async () => {
    const fs = memoryFs(
      JSON.stringify({ updates: { skipped: ['0.2.0', 'latest', '0.2.0', 3, '0.3.0-beta.1'] } }),
    );
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.load();
    expect(store.skippedUpdates).toEqual(['0.2.0', '0.3.0-beta.1']);
    await store.saveSkippedUpdates(['0.4.0']);
    const again = new LauncherSettingsStore('/data/settings.json', fs);
    await again.load();
    expect(again.skippedUpdates).toEqual(['0.4.0']);
  });

  it('listeners receive both the previous and the new settings', async () => {
    const store = new LauncherSettingsStore('/data/settings.json', memoryFs());
    const listener = vi.fn();
    const stop = store.onChange(listener);
    await store.update({ channel: 'beta' });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'stable' }),
      expect.objectContaining({ channel: 'beta' }),
    );
    stop();
    await store.update({ autoDownload: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('IPC: an edit is validated field by field, unknown or invalid data is rejected', async () => {
    const store = new LauncherSettingsStore('/data/settings.json', memoryFs());
    const service = createSettingsService(store);
    expect(await service.update({ whileGame: 'minimize' })).toMatchObject({
      ok: true,
      value: { whileGame: 'minimize' },
    });
    expect(await service.update({ token: 'x' } as never)).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'token' },
    });
    expect(await service.update(null as never)).toEqual({
      ok: false,
      error: { code: 'invalid-request', field: 'patch' },
    });
    expect((await service.get()).ok && store.settings.whileGame).toBe('minimize');
  });

  it('nickname accounts survive a restart, with no secrets in the file', async () => {
    const fs = memoryFs(JSON.stringify({ settings: { ramGb: 8 } }));
    const store = new LauncherSettingsStore('/data/settings.json', fs);
    await store.load();
    const service = createPlayersService(store);
    expect(await service.get()).toEqual({ ok: true, value: { nicks: [], active: null } });
    const players = {
      nicks: [
        { id: 'nick-artdirector', nick: 'ArtDirector' },
        { id: 'nick-steve', nick: 'Steve' },
      ],
      active: { kind: 'nick' as const, id: 'nick-steve' },
    };
    expect(await service.save(players)).toEqual({ ok: true, value: players });
    const again = new LauncherSettingsStore('/data/settings.json', fs);
    await again.load();
    expect(await createPlayersService(again).get()).toEqual({ ok: true, value: players });
    expect(again.settings.ramGb).toBe(8);
    const saved = JSON.parse(fs.files.get('/data/settings.json') ?? '{}') as {
      players: Record<string, unknown>;
    };
    expect(Object.keys(saved.players).sort()).toEqual(['active', 'nicks']);
  });

  it('IPC: bad nicknames, a stray active account and duplicates are rejected; a corrupt file keeps only its valid entries', async () => {
    const store = new LauncherSettingsStore('/data/settings.json', memoryFs());
    const service = createPlayersService(store);
    const invalid = { ok: false, error: { code: 'invalid-request' } };
    expect(
      await service.save({ nicks: [{ id: 'nick-a', nick: 'с пробелом' }], active: null }),
    ).toEqual(invalid);
    expect(await service.save({ nicks: [], active: { kind: 'nick', id: 'nick-x' } })).toEqual(
      invalid,
    );
    expect(
      await service.save({
        nicks: [
          { id: 'nick-a', nick: 'Alex' },
          { id: 'nick-a', nick: 'Alex2' },
        ],
        active: null,
      }),
    ).toEqual(invalid);
    expect(await service.save(null as never)).toEqual(invalid);
    const fs = memoryFs(
      JSON.stringify({
        players: {
          nicks: [{ id: 'nick-ok', nick: 'Okay' }, { id: '../x', nick: 'Bad' }, 'junk'],
          activeId: '../x',
        },
      }),
    );
    const broken = new LauncherSettingsStore('/data/settings.json', fs);
    await broken.load();
    expect(broken.players).toEqual({ nicks: [{ id: 'nick-ok', nick: 'Okay' }], active: null });
  });
});
