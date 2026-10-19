// @vitest-environment happy-dom
import { hostSystemOf } from '@shared/host-system';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { SiteMeta } from '@shared/site';
import { BEHAVIOR_TELEMETRY_TYPES, LAUNCH_TELEMETRY_TYPES } from '@shared/telemetry';
import { SAVE_DELAY_MS } from '../composables/useSettings';
import { labelOf } from '../lib/telemetry';
import { formatGb } from '../lib/units';
import { mountScreen, openScreen, unmountScreen } from '../screen-testing';
import { mountAt, stubLauncher, type Mounted, type Stub } from '../testing';

let mounted: Mounted | undefined;
const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  mounted?.app.unmount();
  mounted = undefined;
  unmountScreen();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function open(stub: Stub = stubLauncher(), demo = true): Promise<Mounted> {
  mounted = await mountAt('/settings', { stub, demo });
  return mounted;
}

function about(app: Mounted['app']): ReturnType<Mounted['app']['find']> {
  return app.find('#settings-about');
}

function privacy(app: Mounted['app']): ReturnType<Mounted['app']['find']> {
  return app.find('#settings-privacy');
}

function withMeta(links: SiteMeta['links']): Stub {
  const stub = stubLauncher();
  stub.api.site.meta = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: { links, connect: null, reportReasons: [] },
      stale: false,
      fetchedAt: '2026-10-03T12:00:00Z',
    }),
  );
  return stub;
}

function linkKeys(app: Mounted['app']): string[] {
  return about(app)
    .findAll('[data-about-link]')
    .map((item) => item.attributes('data-about-link') ?? '');
}

describe('settings: about', () => {
  it("'Pulse' of the hour as a 42-row strip without parallax, a mark and text below it", async () => {
    const { app } = await open();
    const band = about(app).findComponent({ name: 'PixelLandscape' });
    expect(band.attributes('data-scene')).toMatch(/^pulse-/);
    expect(about(app).text()).toContain(ru.settings.pitch);
    expect(about(app).text()).toContain(fill(ru.settings.aboutFooter, { year: '2026' }));
  });

  it('without scenes — a placeholder the same height as the landscape strip', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    const stub = stubLauncher();
    stub.api.site.scenes = vi.fn(() => new Promise<never>(() => undefined));
    const { app } = await open(stub, false);
    expect(about(app).find('.landscape').exists()).toBe(false);
    const empty = about(app).find('.band.is-empty');
    expect((empty.element as HTMLElement).style.height).toBe('126px');
  });

  it('scenes that did not come — the built-in landscape in the strip', async () => {
    const { app } = await open(stubLauncher(), false);
    expect(about(app).find('.landscape').attributes('data-scene')).toBe('builtin-day');
    expect(about(app).find('.band.is-empty').exists()).toBe(false);
  });

  it('the version is copied as a report string and confirmed', async () => {
    const { app } = await open();
    const chip = about(app).find('[data-about="version"]');
    expect(chip.text()).toBe(fill(ru.settings.versionLine, { version: '0.1.0' }));
    expect(chip.attributes('aria-label')).toBeUndefined();
    await chip.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(
      'MC Monitor Launcher 0.1.0 (сборка 3 октября 2026, 12:00, Windows x64)',
    );
    expect(chip.text()).toBe(ru.settings.versionCopied);
    expect(about(app).find('[role="status"]').text()).toBe(ru.settings.versionCopied);
  });

  it('without a build date — only version and platform', async () => {
    const stub = stubLauncher();
    stub.update.state = {
      ...stub.update.state,
      current: { ...stub.update.state.current, builtAt: null },
    };
    const { app } = await open(stub);
    await about(app).find('[data-about="version"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('MC Monitor Launcher 0.1.0 (Windows x64)');
  });

  it('while main has not responded, there is no version chip', async () => {
    const stub = stubLauncher();
    stub.update.state = {
      ...stub.update.state,
      current: { version: '', builtAt: null, os: '', arch: '' },
    };
    const { app } = await open(stub);
    expect(about(app).find('[data-about="version"]').exists()).toBe(false);
  });

  it("'Check for updates' — the same action as in the updates section", async () => {
    const { app, api, emitUpdate } = await open();
    const button = about(app)
      .findAll('button')
      .find((item) => item.text() === ru.settings.aboutCheck);
    await button?.trigger('click');
    await flushPromises();
    expect(api.update.check).toHaveBeenCalledTimes(1);
    emitUpdate({ status: { kind: 'checking' } });
    await flushPromises();
    expect(button?.attributes('disabled')).toBeDefined();
    expect(about(app).text()).toContain(ru.settings.updateStatus.checking);
  });

  it('links in one row; code and tracker are hidden without an address in meta', async () => {
    const { app } = await open(stubLauncher(), false);
    expect(linkKeys(app)).toEqual(['site', 'licenses', 'privacy']);
    expect(about(app).find('[data-about-link="licenses"] a').attributes('href')).toContain(
      '/licenses',
    );
  });

  it('code and tracker from meta open in the browser', async () => {
    const stub = withMeta({
      source: 'https://git.example/launcher',
      issues: 'https://git.example/launcher/issues',
    });
    const { app, api } = await open(stub, false);
    expect(linkKeys(app)).toEqual(['site', 'source', 'licenses', 'issues', 'privacy']);
    await about(app).find('[data-about-link="issues"] a').trigger('click');
    expect(api.openExternal).toHaveBeenCalledWith('https://git.example/launcher/issues');
    await about(app).find('[data-about-link="site"] a').trigger('click');
    expect(api.openExternal).toHaveBeenCalledWith('https://mc-mon.ru');
  });
});

describe('settings: privacy', () => {
  it("a 'what — why — can it be disabled' table with labels for cards", async () => {
    const { app } = await open();
    const table = privacy(app).find('table');
    const heads = table.findAll('thead th').map((item) => item.text());
    expect(heads).toEqual([ru.privacy.what, ru.privacy.why, ru.privacy.off]);
    const keys = table
      .findAll('tbody tr[data-privacy]')
      .map((item) => item.attributes('data-privacy'));
    for (const cell of table.findAll('tbody tr[data-privacy] > *')) {
      expect(heads).toContain(cell.attributes('data-label'));
    }
    const rowHeads = table.findAll('tbody tr[data-privacy] > th[scope="row"]');
    expect(rowHeads).toHaveLength(keys.length);
  });

  it('how to disable is said in words, the table has no switches', async () => {
    const { app } = await open();
    expect(privacy(app).find('tr[data-privacy="crash"] td:last-child').text()).toBe(
      ru.privacy.crashOff,
    );
    expect(privacy(app).find('[role="switch"]').exists()).toBe(false);
  });

  it("'What is sent' shows the batch from the queue", async () => {
    const stub = stubLauncher();
    stub.api.site.telemetryPreview = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          queued: 2,
          packet: { install: 'x', launcher: '0.1.0', os: 'windows', arch: 'x64', events: [] },
        },
      }),
    ) as unknown as Stub['api']['site']['telemetryPreview'];
    const { app } = await open(stub);
    const button = privacy(app)
      .findAll('button')
      .find((item) => item.text() === ru.privacy.packetShow);
    await button?.trigger('click');
    await flushPromises();
    expect(privacy(app).find('pre.packet').text()).toContain('"launcher": "0.1.0"');
    expect(privacy(app).text()).toContain(fill(ru.privacy.packetNote, { count: 2 }));
  });
});

function javaState(app: Mounted['app'], major: number): string {
  return app.find(`[data-java="${String(major)}"] :is(.installed, .small)`).text();
}

describe('settings: Java', () => {
  it('the section and its entry in the list of sections are in place', async () => {
    const { app } = await openScreen('/settings');
    const java = app.find('#settings-java');
    expect(java.find('h2').text()).toBe(ru.settings.java);
    expect(java.text()).toContain(ru.settings.javaNote);
    expect(app.findAll('.subnav button').map((item) => item.text())).toContain(ru.settings.java);
    expect(java.findAll('[data-java]').map((row) => row.attributes('data-java'))).toEqual([
      '25',
      '21',
      '17',
      '8',
    ]);
    expect(java.find('[data-java="21"]').text()).toContain('1.20.5–1.21.11');
  });

  it('a row says what main found on disk, not made-up data', async () => {
    const stub = stubLauncher();
    stub.api.system.java = vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { installed: [8] } }),
    );
    const { app } = await openScreen('/settings', stub);
    expect(javaState(app, 8)).toBe(ru.settings.javaInstalled);
    expect(javaState(app, 25)).toBe(ru.settings.javaOnDemand);
    expect(javaState(app, 21)).toBe(ru.settings.javaOnDemand);
  });

  it('without an answer from main the rows claim nothing', async () => {
    const stub = stubLauncher();
    stub.api.system.java = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'failed' as const } }),
    );
    const { app } = await openScreen('/settings', stub);
    const java = app.find('#settings-java').text();
    expect(java).not.toContain(ru.settings.javaInstalled);
    expect(java).not.toContain(ru.settings.javaOnDemand);
  });
});

function manual(): Stub {
  const stub = stubLauncher();
  stub.settings.autoMemory = false;
  stub.settings.fullscreen = false;
  return stub;
}

describe('settings: memory and behavior', () => {
  it('by default the game section is two switches: memory by itself, full screen', async () => {
    const { app } = await openScreen('/settings');
    const game = app.find('#settings-game');
    expect(game.find('[role="slider"]').exists()).toBe(false);
    expect(app.find('[data-window="size"]').exists()).toBe(false);
    expect(game.text()).toContain(ru.settings.memoryAutoNote);
    expect(game.find('[data-memory="note"]').exists()).toBe(false);
    expect(app.find('input.field').exists()).toBe(false);
  });

  it('the slider and the window size appear only when the player takes them over', async () => {
    const { app } = await openScreen('/settings');
    const switches = app.findAll('[role="switch"]');
    await switches
      .find((item) => item.attributes('aria-label') === ru.settings.memoryAuto)
      ?.trigger('click');
    await switches
      .find((item) => item.attributes('aria-label') === ru.settings.fullscreen)
      ?.trigger('click');
    expect(app.find('[data-memory="manual"] [role="slider"]').exists()).toBe(true);
    expect(app.find('[data-window="size"] select').exists()).toBe(true);
    expect(app.find('[data-memory="note"]').text()).toBe(ru.settings.memoryNote);
  });

  it('a memory slider with the keyboard, selects store keys', async () => {
    const { app } = await openScreen('/settings', manual());
    const slider = app.find('[role="slider"]');
    expect(slider.attributes('aria-valuenow')).toBe('6');
    await slider.trigger('keydown', { key: 'ArrowRight' });
    expect(slider.attributes('aria-valuenow')).toBe('7');
    const values = app.findAll('select').map((item) => (item.element as HTMLSelectElement).value);
    expect(values).toContain('tray');
    expect(values).toContain('1920x1080');
  });

  it('privacy is described per the telemetry schema: all events and fields, nickname on auto-join', async () => {
    const { app } = await openScreen('/settings');
    expect(app.text()).toContain(ru.privacy.telemetryWhat);
    expect(app.text()).toContain(ru.privacy.deviceWhat[hostSystemOf(navigator.platform)]);
    const lines = app.findAll('.telemetry li').map((item) => item.text());
    expect(lines).toHaveLength(LAUNCH_TELEMETRY_TYPES.length);
    expect(app.find('[data-privacy="behavior"]').exists()).toBe(false);
    expect(app.text()).not.toContain(ru.telemetry.fields.launch_id);
    expect(app.text()).not.toContain(ru.telemetry.events['screen.viewed']);
  });

  it('with the behavior flag on, privacy lists the new events in their own row', async () => {
    const stub = stubLauncher();
    stub.api.telemetry.behavior = vi.fn(() => Promise.resolve(true));
    const { app } = await openScreen('/settings', stub);
    const keys = app.findAll('tbody tr[data-privacy]').map((row) => row.attributes('data-privacy'));
    expect(keys.slice(0, 3)).toEqual(['telemetry', 'behavior', 'install']);
    const row = app.find('[data-privacy="behavior"]');
    expect(row.text()).toContain(ru.privacy.behaviorWhat);
    expect(row.text()).toContain(ru.privacy.behaviorWhy);
    expect(row.find('td:last-child').text()).toBe(ru.privacy.behaviorOff);
    const lines = row.findAll('.telemetry li').map((item) => item.text());
    expect(lines).toHaveLength(BEHAVIOR_TELEMETRY_TYPES.length);
    expect(app.find('[data-privacy="telemetry"]').text()).toContain(ru.telemetry.fields.launch_id);
    expect(row.text()).not.toMatch(/обновлени/i);
    expect(labelOf('app.closed', 'duration_s')).not.toBe(labelOf('launch.finished', 'duration_s'));
    expect(row.find('.packet-action').exists()).toBe(false);
  });

  it('memory label: RAM from main', async () => {
    const { app, api } = await openScreen('/settings', manual());
    expect(api.system.memory).toHaveBeenCalled();
    expect(app.find('.ram-hint').text()).toBe(
      fill(ru.settings.memoryHintTotal, { total: formatGb(16) }),
    );
  });

  it('memory label is hidden without a response from main', async () => {
    const stub = manual();
    stub.api.system.memory = (): ReturnType<typeof stub.api.system.memory> =>
      Promise.resolve({ ok: false, error: { code: 'failed' } });
    const mounted = await mountScreen('/settings', { stub, demo: false });
    expect(mounted.app.find('.ram-hint').exists()).toBe(false);
  });

  it('settings are read from main and saved back to it', async () => {
    const stub = stubLauncher();
    stub.settings.whileGame = 'keep';
    const { app, api } = await openScreen('/settings', stub);
    const values = app.findAll('select').map((item) => (item.element as HTMLSelectElement).value);
    expect(values).toContain('keep');
    const select = app
      .findAll('select')
      .find((item) => (item.element as HTMLSelectElement).value === 'keep');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await select?.setValue('minimize');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    await flushPromises();
    expect(api.settings.update).toHaveBeenCalledWith({ whileGame: 'minimize' });
  });
});
