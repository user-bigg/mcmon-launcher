import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, gameWindowOf, normalizeSettings, parseSettingsPatch } from './settings';

describe('parseSettingsPatch', () => {
  it.each([
    [{ whileGame: 'hide' }, 'whileGame'],
    [{ ramGb: 0 }, 'ramGb'],
    [{ ramGb: 4.5 }, 'ramGb'],
    [{ resolution: '1920*1080' }, 'resolution'],
    [{ resolution: '100x100' }, 'resolution'],
    [{ resolution: '99999x99999' }, 'resolution'],
    [{ resolution: '7681x4320' }, 'resolution'],
    [{ jvmArgs: '-XX:+UseZGC' }, 'jvmArgs'],
    [{ autostart: 'yes' }, 'autostart'],
    [{ channel: 'nightly' }, 'channel'],
    [{ autoDownload: 'yes' }, 'autoDownload'],
  ])('rejects %j', (patch, field) => {
    expect(parseSettingsPatch(patch)).toEqual({ ok: false, field });
  });
});

describe('normalizeSettings', () => {
  it('drops the removed JVM arguments and Java switch of an older file and keeps its other choices', () => {
    const stored = { ...DEFAULT_SETTINGS, fullscreen: false, jvmArgs: '-Xmx8G', autoJava: false };
    const settings = normalizeSettings(stored);
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, fullscreen: false });
  });

  it('a new install starts with Windows', () => {
    expect(normalizeSettings(undefined).autostart).toBe(true);
    expect(normalizeSettings({ ramGb: 8 }).autostart).toBe(true);
  });

  it('settings saved before keep their own autostart choice', () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, autostart: false }).autostart).toBe(false);
  });

  it('a new install plays in full screen', () => {
    expect(normalizeSettings(undefined).fullscreen).toBe(true);
  });

  it('reads a file saved with the removed notifications field and drops it', () => {
    const stored = { ...DEFAULT_SETTINGS, ramGb: 8, autostart: true, notifications: false };
    const settings = normalizeSettings(stored);
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, ramGb: 8, autostart: true });
  });

  it('reads a file saved with the removed server picks switch and drops it', () => {
    const stored = { ...DEFAULT_SETTINGS, fullscreen: false, personal: false };
    const settings = normalizeSettings(stored);
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, fullscreen: false });
  });
});

describe('gameWindowOf', () => {
  it('reads the window size and the full screen choice', () => {
    expect(gameWindowOf({ fullscreen: false, resolution: '1600x900' })).toEqual({
      fullscreen: false,
      width: 1600,
      height: 900,
    });
  });

  it.each(['100x100', '99999x99999', '640x479', 'big'])(
    'a size of %s the game could not open is not passed on',
    (resolution) => {
      expect(gameWindowOf({ fullscreen: false, resolution })).toEqual({
        fullscreen: false,
        width: 0,
        height: 0,
      });
    },
  );

  it('keeps the smallest and the largest window', () => {
    expect(gameWindowOf({ fullscreen: true, resolution: '640x480' })).toMatchObject({ width: 640 });
    expect(gameWindowOf({ fullscreen: true, resolution: '7680x4320' })).toMatchObject({
      height: 4320,
    });
  });
});
