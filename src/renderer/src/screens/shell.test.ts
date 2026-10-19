// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@shared/i18n/ru';
import { SERVER_IDS } from '../mock/servers';
import {
  openScreen as open,
  progress,
  progressEvent,
  SCREENS,
  serverName,
  unmountScreen,
} from '../screen-testing';
import { launchEvent } from '../testing';

const MARKING_WORDS = /Реклама|реклама|erid|ООО|ИП /;

afterEach(unmountScreen);

describe('window shell', () => {
  it("'/' focuses search, the field accepts typing, Esc clears it and removes focus", async () => {
    const { app } = await open('/');
    const input = app.find<HTMLInputElement>('.search input');
    expect(app.find('.search kbd').text()).toBe('/');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    await flushPromises();
    expect(document.activeElement).toBe(input.element);
    expect(app.find('.search kbd').exists()).toBe(false);
    const typed = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    input.element.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    await input.setValue('sky');
    await input.trigger('keydown', { key: 'Escape' });
    expect(input.element.value).toBe('');
    expect(document.activeElement).toBe(input.element);
    await input.trigger('keydown', { key: 'Escape' });
    expect(document.activeElement).not.toBe(input.element);
    expect(app.find('.search kbd').exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    await flushPromises();
    expect(document.activeElement).toBe(input.element);
  });

  it("Russian layout: Ctrl+F and '/' are recognized by key, a checkbox is not a field", async () => {
    const { app } = await open('/');
    const input = app.find<HTMLInputElement>('.search input');
    const press = (target: EventTarget, init: KeyboardEventInit): boolean => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press(window, { key: 'а', code: 'KeyF', ctrlKey: true })).toBe(true);
    expect(document.activeElement).toBe(input.element);
    expect(press(input.element, { key: '.', code: 'Slash' })).toBe(false);
    input.element.blur();
    expect(press(window, { key: ',', code: 'Slash', shiftKey: true })).toBe(false);
    expect(document.activeElement).not.toBe(input.element);
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.append(box);
    box.focus();
    expect(press(box, { key: '.', code: 'Slash' })).toBe(true);
    expect(document.activeElement).toBe(input.element);
    box.remove();
  });

  it('the install banner in the titlebar shows only while installing', async () => {
    const { app, emit, router } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    expect(app.find('.activity').exists()).toBe(false);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    await router.push('/');
    emit(progressEvent(progress(['done', 'active'], 37)));
    await flushPromises();
    const pill = app.find('.activity');
    expect(pill.text()).toContain(serverName(SERVER_IDS.cubeIsland));
    expect(pill.text()).toContain('37%');
    emit(launchEvent({ kind: 'phase', phase: 'idle', operationId: 1 }, { operationId: 1 }));
    await flushPromises();
    expect(app.find('.activity').exists()).toBe(false);
  });
});

describe('accessibility and rules on every screen', () => {
  it.each(SCREENS)('%s: every button has text or an aria-label', async (path) => {
    const { app } = await open(path);
    for (const button of app.findAll('button, a')) {
      const text = button.text().trim();
      const label = button.attributes('aria-label') ?? '';
      expect(text.length + label.length, button.html()).toBeGreaterThan(0);
    }
  });

  it.each(SCREENS)('%s: no sponsor label, advertiser name or erid', async (path) => {
    const { app } = await open(path);
    expect(app.html()).not.toMatch(MARKING_WORDS);
  });

  it.each(SCREENS)('%s: at most one live parallax scene', async (path) => {
    const { app } = await open(path);
    expect(app.findAll('[data-motion="parallax"]').length).toBeLessThanOrEqual(1);
  });
});

describe('hiding the window during gameplay', () => {
  it('main navigates to /idle without screens and returns to the previous route', async () => {
    const { app, router, emitNavigate } = await open('/library');
    emitNavigate({ kind: 'idle' });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/idle');
    expect(app.find('.lx-body').exists()).toBe(false);
    emitNavigate({ kind: 'restore' });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/library');
    expect(app.find('.lx-body').exists()).toBe(true);
  });

  it('a crash while the window is hidden opens the crash screen', async () => {
    const { router, emitNavigate } = await open('/library');
    emitNavigate({ kind: 'idle' });
    await flushPromises();
    emitNavigate({ kind: 'crash', instanceId: 'server-7' });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/crash/server-7');
  });
});

describe('commands of the application menu and the tray', () => {
  it('the menu opens the settings, and the about section by its name', async () => {
    const { router, emitNavigate } = await open('/library');
    emitNavigate({ kind: 'settings', section: null });
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/settings');
    emitNavigate({ kind: 'settings', section: 'about' });
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/settings?section=about');
  });

  it('a setting changed in the tray menu shows up in the open settings', async () => {
    const stub = await open('/settings');
    const toggle = (): boolean =>
      stub.app
        .findAll('[role="switch"]')
        .some(
          (item) =>
            item.attributes('aria-label') === ru.settings.autostart.other &&
            item.attributes('aria-checked') === 'true',
        );
    const before = toggle();
    stub.settings.autostart = !before;
    stub.emitNavigate({ kind: 'settings-changed' });
    await flushPromises();
    expect(toggle()).toBe(!before);
    expect(stub.api.settings.update).not.toHaveBeenCalled();
  });

  it('autostart switched off in the Task Manager: unchecked, with the reason, and a click asks main', async () => {
    const stub = await open('/settings');
    stub.settings.autostart = true;
    stub.emitNavigate({ kind: 'settings-changed' });
    vi.mocked(stub.api.system.autostart).mockResolvedValue({
      ok: true,
      value: { view: 'blocked' },
    });
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    const toggle = stub.app
      .findAll('[role="switch"]')
      .find((item) => item.attributes('aria-label') === ru.settings.autostart.other);
    expect(toggle?.attributes('aria-checked')).toBe('false');
    expect(stub.app.find('[data-autostart-blocked]').text()).toBe(ru.settings.autostartBlocked);
    await toggle?.trigger('click');
    await flushPromises();
    expect(stub.api.system.enableAutostart).toHaveBeenCalledTimes(1);
    expect(stub.app.find('[data-autostart-blocked]').exists()).toBe(false);
    expect(stub.api.settings.update).not.toHaveBeenCalled();
  });
});
