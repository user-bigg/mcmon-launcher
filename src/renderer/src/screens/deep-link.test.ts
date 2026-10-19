// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { ARM_DELAY_MS } from '../composables/useDeepLink';
import { SERVER_IDS } from '../mock/servers';
import { openScreen as open, serverName, unmountScreen } from '../screen-testing';
import { launchEvent } from '../testing';

afterEach(() => {
  unmountScreen();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

describe('play request of the site', () => {
  const site = (serverId: number) => ({ kind: 'play', serverId, via: 'site' }) as const;

  it('opens the launch and starts it without a question', async () => {
    const { app, api, router, emitDeepLink } = await open('/');
    emitDeepLink(site(SERVER_IDS.cubeIsland));
    await flushPromises();
    expect(app.find('[role="alertdialog"]').exists()).toBe(false);
    expect(api.ackDeepLink).toHaveBeenCalledWith(1);
    expect(api.launch.launch).toHaveBeenCalledOnce();
    expect(api.launch.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ serverId: SERVER_IDS.cubeIsland }) as unknown,
        name: serverName(SERVER_IDS.cubeIsland),
      }),
    );
    expect(router.currentRoute.value.path).toBe(`/launch/${String(SERVER_IDS.cubeIsland)}`);
  });

  it('a server with its own launcher just opens, nothing starts', async () => {
    const { app, api, router, emitDeepLink } = await open('/');
    emitDeepLink(site(SERVER_IDS.technograd));
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/server/${String(SERVER_IDS.technograd)}`);
    expect(app.find('[role="alertdialog"]').exists()).toBe(false);
    expect(api.launch.launch).not.toHaveBeenCalled();
  });

  it('a server missing from the catalog opens its page and starts nothing', async () => {
    const { api, router, emitDeepLink } = await open('/');
    emitDeepLink(site(777));
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/server/777');
    expect(api.launch.launch).not.toHaveBeenCalled();
  });

  it('during a game opens the server and starts nothing', async () => {
    const { api, emit, emitDeepLink } = await open('/');
    emit(launchEvent({ kind: 'phase', phase: 'running', operationId: 1 }, { phase: 'running' }));
    emitDeepLink(site(SERVER_IDS.cubeIsland));
    await flushPromises();
    expect(api.launch.launch).not.toHaveBeenCalled();
  });

  it('a stale request only opens the server: no launch and no question', async () => {
    const { app, api, router, emitDeepLink } = await open('/');
    emitDeepLink({ ...site(SERVER_IDS.cubeIsland), stale: true });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/server/${String(SERVER_IDS.cubeIsland)}`);
    expect(app.find('[role="alertdialog"]').exists()).toBe(false);
    expect(api.launch.launch).not.toHaveBeenCalled();
  });

  it('replaces the question of a link that was open', async () => {
    const { app, api, emitDeepLink } = await open('/');
    emitDeepLink({ kind: 'play', serverId: SERVER_IDS.wasteland });
    await flushPromises();
    expect(app.find('[role="alertdialog"]').exists()).toBe(true);
    emitDeepLink(site(SERVER_IDS.cubeIsland));
    await flushPromises();
    expect(app.find('[role="alertdialog"]').exists()).toBe(false);
    expect(api.launch.launch).toHaveBeenCalledOnce();
  });
});

describe('mcmonitor:// link', () => {
  it('an mcmonitor:// link opens the server and asks for confirmation', async () => {
    const { app, api, router, emitDeepLink } = await open('/');
    emitDeepLink({ kind: 'play', serverId: SERVER_IDS.cubeIsland });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/server/${String(SERVER_IDS.cubeIsland)}`);
    const dialog = app.find('[role="alertdialog"]');
    expect(dialog.find('h2').text()).toBe(
      fill(ru.deepLink.title, { name: serverName(SERVER_IDS.cubeIsland) }),
    );
    expect(dialog.find('.deep-link-address').text()).toBe('play.cubeisland.example');
    expect(api.launch.launch).not.toHaveBeenCalled();
    expect(api.ackDeepLink).toHaveBeenCalledWith(1);
    const confirm = (): ReturnType<typeof dialog.findAll>[number] | undefined =>
      app
        .find('[role="alertdialog"]')
        .findAll('button')
        .find((item) => item.text() === ru.deepLink.confirm);
    expect(confirm()?.attributes('disabled')).toBeDefined();
    expect(document.activeElement?.textContent.trim()).toBe(ru.deepLink.cancel);
    expect(app.find('.lx-body').attributes('inert')).toBeDefined();
    await vi.advanceTimersByTimeAsync(ARM_DELAY_MS);
    await confirm()?.trigger('click');
    await flushPromises();
    expect(api.launch.launch).toHaveBeenCalledOnce();
    expect(app.find('[role="alertdialog"]').exists()).toBe(false);
  });

  it('while a link prompt is open, search does not intercept keys, Esc closes only the prompt', async () => {
    const { app, emitDeepLink } = await open('/');
    const input = app.find<HTMLInputElement>('.search input');
    await input.setValue('sky');
    emitDeepLink({ kind: 'play', serverId: SERVER_IDS.cubeIsland });
    await flushPromises();
    const cancel = document.activeElement;
    for (const init of [
      { key: '/' },
      { key: 'f', ctrlKey: true },
      { key: 'а', code: 'KeyF', ctrlKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      cancel?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(cancel);
    }
    input.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(app.find('[role="alertdialog"]').exists()).toBe(false);
    expect(input.element.value).toBe('sky');
  });

  it('a new link while a card is open queues up instead of replacing the target', async () => {
    const { app, emitDeepLink } = await open('/');
    emitDeepLink({ kind: 'play', serverId: SERVER_IDS.cubeIsland });
    await flushPromises();
    emitDeepLink({ kind: 'play', serverId: SERVER_IDS.wasteland });
    await flushPromises();
    expect(app.find('[role="alertdialog"]').text()).toContain(serverName(SERVER_IDS.cubeIsland));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(app.find('[role="alertdialog"]').text()).toContain(serverName(SERVER_IDS.wasteland));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(app.find('[role="alertdialog"]').exists()).toBe(false);
  });

  it("during gameplay 'Join' is unavailable and it is explained why", async () => {
    const { app, emit, emitDeepLink } = await open('/');
    emit(launchEvent({ kind: 'phase', phase: 'running', operationId: 1 }, { phase: 'running' }));
    emitDeepLink({ kind: 'play', serverId: SERVER_IDS.cubeIsland });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ARM_DELAY_MS);
    const dialog = app.find('[role="alertdialog"]');
    expect(dialog.find('.deep-link-busy').exists()).toBe(true);
    const confirm = dialog.findAll('button').find((item) => item.text() === ru.deepLink.confirm);
    expect(confirm?.attributes('disabled')).toBeDefined();
  });

  it('a link with a source and a launch id still asks for confirmation', async () => {
    const { app, api, emitDeepLink } = await open('/');
    emitDeepLink({
      kind: 'play',
      serverId: SERVER_IDS.cubeIsland,
      launchId: '3f0c2a52-6f0e-4c1e-9a55-0d3a4d1b7c21',
      source: 'catalog',
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(ARM_DELAY_MS);
    expect(app.find('[role="alertdialog"]').exists()).toBe(true);
    expect(api.launch.launch).not.toHaveBeenCalled();
  });

  it('cancelling launches nothing, an unknown server — without a join button', async () => {
    const { app, api, emitDeepLink } = await open('/');
    emitDeepLink({ kind: 'play', serverId: 777 });
    await flushPromises();
    const dialog = app.find('[role="alertdialog"]');
    expect(dialog.text()).toContain(fill(ru.deepLink.unknown, { id: 777 }));
    expect(dialog.findAll('button').map((item) => item.text())).toEqual([ru.deepLink.cancel]);
    await dialog.find('button').trigger('click');
    expect(app.find('[role="alertdialog"]').exists()).toBe(false);
    expect(api.launch.launch).not.toHaveBeenCalled();
  });
});
