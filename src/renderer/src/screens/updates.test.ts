// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { SAVE_DELAY_MS } from '../composables/useSettings';
import { mountAt, stubLauncher, type Mounted, type Stub } from '../testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.app.unmount();
  mounted = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function open(path: string, stub: Stub = stubLauncher()): Promise<Mounted> {
  mounted = await mountAt(path, { stub });
  return mounted;
}

function section(app: Mounted['app']): ReturnType<Mounted['app']['find']> {
  return app.find('#settings-updates');
}

function button(app: Mounted['app'], text: string): ReturnType<Mounted['app']['find']> {
  const found = app.findAll('button').find((item) => item.text() === text);
  if (found === undefined) {
    throw new Error(`no button ${text}`);
  }
  return found;
}

describe('updates in the title bar', () => {
  it("a ready update: a 'will install on exit' banner and restart", async () => {
    const { app, api, emitUpdate } = await open('/');
    expect(app.find('.titlebar .update').exists()).toBe(false);
    emitUpdate({ status: { kind: 'ready', version: '0.2.0', notes: null } });
    await flushPromises();
    const banner = app.find('.titlebar .update');
    expect(banner.text()).toContain(fill(ru.update.ready, { version: '0.2.0' }));
    await banner.find('button').trigger('click');
    await flushPromises();
    expect(api.update.restart).toHaveBeenCalledTimes(1);
  });

  it('during gameplay restart is unavailable and explained', async () => {
    const { app, api, emitUpdate } = await open('/');
    emitUpdate({ status: { kind: 'ready', version: '0.2.0', notes: null }, blocked: 'game' });
    await flushPromises();
    const action = app.find('.titlebar .update button');
    expect(action.attributes('aria-disabled')).toBe('true');
    expect(action.attributes('title')).toBe(ru.update.blockedGame);
    expect(app.find('#titlebar-update-blocked').text()).toBe(ru.update.blockedGame);
    await action.trigger('click');
    expect(api.update.restart).not.toHaveBeenCalled();
  });

  it('a skipped version does not show the banner, a signature failure does', async () => {
    const { app, emitUpdate } = await open('/');
    emitUpdate({ status: { kind: 'ready', version: '0.2.0', notes: null }, skipped: ['0.2.0'] });
    await flushPromises();
    expect(app.find('.titlebar .update').exists()).toBe(false);
    emitUpdate({ status: { kind: 'error', code: 'signature', version: '0.3.0' }, skipped: [] });
    await flushPromises();
    expect(app.find('.titlebar .update.is-danger').text()).toContain(ru.update.rejected);
  });

  it('no connection for .sig — not a failure: there is no red banner', async () => {
    const { app, emitUpdate } = await open('/');
    emitUpdate({ status: { kind: 'error', code: 'offline', version: '0.2.0' } });
    await flushPromises();
    expect(app.find('.titlebar .update').exists()).toBe(false);
  });

  it('a stale event does not overwrite a newer one', async () => {
    const stub = stubLauncher();
    const { app, emitUpdate } = await open('/', stub);
    emitUpdate({ seq: 5, status: { kind: 'ready', version: '0.2.0', notes: null } });
    emitUpdate({ seq: 3, status: { kind: 'none' } });
    await flushPromises();
    expect(app.find('.titlebar .update').exists()).toBe(true);
  });
});

describe('updates in settings', () => {
  it('version, build date by Moscow time, and check time', async () => {
    const { app } = await open('/settings');
    const text = section(app).text();
    expect(text).toContain(
      fill(ru.settings.updateBuiltAt, { version: '0.1.0', date: '3 октября 2026' }),
    );
    expect(text).toContain(fill(ru.settings.updateStatus.noneAt, { time: '14:30' }));
    await button(app, ru.settings.updateCheck).trigger('click');
    expect(mounted?.api.update.check).toHaveBeenCalledTimes(1);
  });

  it("an available version without auto-download: notes, 'Download', 'Skip this version'", async () => {
    const stub = stubLauncher();
    stub.settings.autoDownload = false;
    stub.update.state = {
      ...stub.update.state,
      status: { kind: 'available', version: '0.2.0', notes: 'Быстрее запуск\nНовый каталог' },
    };
    const { app, api } = await open('/settings', stub);
    const offer = section(app).find('[data-update="offer"]');
    expect(offer.text()).toContain(fill(ru.settings.updateNotes, { version: '0.2.0' }));
    expect(offer.find('.notes').text()).toContain('Новый каталог');
    await button(app, ru.settings.updateDownload).trigger('click');
    expect(api.update.download).toHaveBeenCalledTimes(1);
    await button(app, ru.settings.updateSkip).trigger('click');
    await flushPromises();
    expect(api.update.skip).toHaveBeenCalledWith('0.2.0');
    expect(section(app).text()).toContain(
      fill(ru.settings.updateStatus.skipped, { version: '0.2.0' }),
    );
    await button(app, ru.settings.updateUnskip).trigger('click');
    expect(api.update.unskip).toHaveBeenCalledWith('0.2.0');
  });

  it('downloading — percentage and a bar', async () => {
    const { app, emitUpdate } = await open('/settings');
    emitUpdate({ status: { kind: 'downloading', version: '0.2.0', percent: 42 } });
    await flushPromises();
    expect(section(app).text()).toContain(
      fill(ru.settings.updateStatus.downloading, { version: '0.2.0', percent: 42 }),
    );
    expect(section(app).find('[role="progressbar"]').attributes('aria-valuenow')).toBe('42');
    expect(button(app, ru.settings.updateCheck).attributes('disabled')).toBeDefined();
  });

  it('a signature failure — human text and a link to the launcher page', async () => {
    const { app, emitUpdate } = await open('/settings');
    emitUpdate({ status: { kind: 'error', code: 'signature', version: '0.2.0' } });
    await flushPromises();
    const alert = section(app).find('[role="alert"]');
    expect(alert.text()).toContain(
      fill(ru.settings.updateErrors.signature, { version: '0.2.0', site: 'mc-mon.ru' }),
    );
    expect(section(app).text()).toContain(ru.settings.officialLink);
  });

  it('ready, but gameplay is in progress: restart is disabled, an explanation alongside', async () => {
    const { app, api, emitUpdate } = await open('/settings');
    emitUpdate({ status: { kind: 'ready', version: '0.2.0', notes: null }, blocked: 'game' });
    await flushPromises();
    const restart = section(app)
      .findAll('button')
      .find((item) => item.text() === ru.update.restart);
    expect(restart?.attributes('disabled')).toBeDefined();
    expect(section(app).text()).toContain(ru.update.blockedGame);
    await restart?.trigger('click');
    expect(api.update.restart).not.toHaveBeenCalled();
  });

  it('the channel and auto-download are saved to settings', async () => {
    const { app, api } = await open('/settings');
    const channel = section(app)
      .findAll('select')
      .find((item) => (item.element as HTMLSelectElement).value === 'stable');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await channel?.setValue('beta');
    await section(app).find(`[aria-label="${ru.settings.autoDownload}"]`).trigger('click');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    await flushPromises();
    expect(api.settings.update).toHaveBeenCalledWith({ channel: 'beta', autoDownload: false });
  });

  it('the status lives in a persistent status node, an error — in a separate alert', async () => {
    const { app, emitUpdate } = await open('/settings');
    expect(section(app).find('[role="status"]').text()).toContain(
      fill(ru.settings.updateStatus.noneAt, { time: '14:30' }),
    );
    expect(section(app).find('[role="alert"]').exists()).toBe(false);
    const status = section(app).find('[role="status"]').element;
    emitUpdate({ status: { kind: 'error', code: 'offline', version: null } });
    await flushPromises();
    expect(section(app).find('[role="alert"]').text()).toContain(ru.settings.updateErrors.offline);
    expect(section(app).find('[role="status"]').element).toBe(status);
    emitUpdate({ status: { kind: 'checking' } });
    await flushPromises();
    expect(section(app).find('[role="status"]').element).toBe(status);
    expect(section(app).find('[role="alert"]').exists()).toBe(false);
  });

  it("while main has not responded, there is no empty 'Version' row", async () => {
    const stub = stubLauncher();
    stub.update.state = {
      ...stub.update.state,
      current: { ...stub.update.state.current, version: '', builtAt: null },
    };
    const { app } = await open('/settings', stub);
    const prefix = fill(ru.settings.versionLine, { version: '' }).trim();
    const lines = app.findAll('.lx-row-title, .lx-row-desc').map((item) => item.text().trim());
    expect(lines).not.toContain(prefix);
  });

  it('the ?section=updates address opens the updates section', async () => {
    const { app } = await open('/settings?section=updates');
    expect(app.find('.subnav .is-active').text()).toBe(ru.settings.updates);
  });
});
