// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerInstanceInfo } from '@shared/instance';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { SERVER_IDS } from '../mock/servers';
import {
  failedEvent,
  liveSite,
  mountScreen,
  openScreen as open,
  progress,
  progressEvent,
  serverName,
  unmountScreen,
} from '../screen-testing';
import { launchEvent, stubLauncher } from '../testing';

afterEach(unmountScreen);

describe('install and launch', () => {
  it("'Play' launches the service with the server address and the active account's nickname", async () => {
    const { app, api, router } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/launch/${String(SERVER_IDS.cubeIsland)}`);
    expect(api.launch.launch).toHaveBeenCalledWith({
      target: {
        kind: 'server',
        serverId: SERVER_IDS.cubeIsland,
        minecraft: '1.21.4',
        address: 'play.cubeisland.example:25565',
      },
      account: { kind: 'nick', nick: 'Frostbyte' },
      joinServer: true,
      name: serverName(SERVER_IDS.cubeIsland),
      launchId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
    });
  });

  it("while the game is running, 'Play' for another server does not leave the page, the join toggle is locked", async () => {
    const { app, api, router, emit } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(launchEvent({ kind: 'phase', phase: 'running', operationId: 1 }, { phase: 'running' }));
    await flushPromises();
    const join = app.find(`.side [role="switch"][aria-label="${ru.install.autoJoin}"]`);
    expect(join.attributes('disabled')).toBeDefined();
    await router.push(`/server/${String(SERVER_IDS.wasteland)}`);
    await flushPromises();
    const play = app.find('[data-launch="direct"]');
    if (play.exists()) {
      await play.trigger('click');
      await flushPromises();
    }
    expect(router.currentRoute.value.path).toBe(`/server/${String(SERVER_IDS.wasteland)}`);
    expect(api.launch.launch).toHaveBeenCalledOnce();
  });

  it('steps change by service events, cancelling calls cancel', async () => {
    const { app, api, emit } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(progressEvent(progress(['done', 'active', 'skipped'], 42)));
    await flushPromises();
    const statuses = app
      .findAll('.step')
      .map((step) => step.classes().find((name) => name.startsWith('is-')));
    expect(statuses).toEqual([
      'is-done',
      'is-active',
      'is-skipped',
      'is-wait',
      'is-wait',
      'is-wait',
    ]);
    expect(app.find('.step.is-skipped').text()).toContain(ru.install.loaderSkipped);
    expect(app.find('[aria-live="polite"]').text()).toContain('40%');
    const cancel = app.findAll('button').find((item) => item.text() === ru.install.cancel);
    await cancel?.trigger('click');
    expect(api.launch.cancel).toHaveBeenCalledOnce();
  });

  it('a service error — human text and an action', async () => {
    const { app, emit } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(failedEvent({ code: 'disk-full', path: null, bytesNeeded: null }));
    await flushPromises();
    const alert = app.find('.notice[role="alert"]');
    expect(alert.text()).toContain(ru.launchError['disk-full'].title);
    expect(alert.text()).toContain(ru.launchError['disk-full'].action);
  });

  it("auto-join is not supported — 'Launch without auto-join' launches without joinServer", async () => {
    const { app, api, emit } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(failedEvent({ code: 'join-unsupported', minecraft: '1.5.2' }));
    await flushPromises();
    const action = app
      .findAll('.notice[role="alert"] button')
      .find((item) => item.text() === ru.launchError['join-unsupported'].action);
    await action?.trigger('click');
    await flushPromises();
    expect(api.launch.launch).toHaveBeenCalledTimes(2);
    expect(api.launch.launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ joinServer: false }),
    );
  });

  it("cancelling the install — 'Stopped' and 'Continue install' with auto-join", async () => {
    const { app, api, emit } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(failedEvent({ code: 'cancelled' }));
    await flushPromises();
    expect(app.find('.lx-eyebrow').text()).toBe(ru.install.eyebrowCancelled);
    const action = app
      .findAll('.notice.is-cancelled button')
      .find((item) => item.text() === ru.launchError.cancelled.action);
    await action?.trigger('click');
    await flushPromises();
    expect(api.launch.launch).toHaveBeenCalledTimes(2);
    expect(api.launch.launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ joinServer: true }),
    );
  });

  it("without a game account — 'A game account is needed', the button leads to accounts", async () => {
    const stub = liveSite();
    const mounted = await mountScreen('/servers', { stub, demo: false });
    await mounted.router.push(`/launch/${String(SERVER_IDS.cubeIsland)}`);
    await flushPromises();
    const play = mounted.app.findAll('button').find((item) => item.text() === ru.install.start);
    await play?.trigger('click');
    await flushPromises();
    const alert = mounted.app.find('.notice[role="alert"]');
    expect(alert.text()).toContain(ru.launchError['no-account'].title);
    expect(alert.text()).not.toContain(ru.launchError.nick.title);
    expect(stub.api.launch.launch).not.toHaveBeenCalled();
    const action = alert
      .findAll('button')
      .find((item) => item.text() === ru.launchError['no-account'].action);
    await action?.trigger('click');
    await flushPromises();
    expect(mounted.router.currentRoute.value.path).toBe('/accounts');
  });

  it('the log comes from logTail', async () => {
    const stub = stubLauncher();
    stub.api.launch.logTail = (): ReturnType<typeof stub.api.launch.logTail> =>
      Promise.resolve({ ok: true, value: ['[main/INFO]: Hello'] });
    const { app } = await open(`/launch/${String(SERVER_IDS.cubeIsland)}`, stub);
    const logButton = app.findAll('button').find((item) => item.text() === ru.install.log);
    await logButton?.trigger('click');
    await flushPromises();
    expect(app.find('.log').text()).toContain('Hello');
  });

  it("an installed instance older than the catalog: a mark on 'Files' and in 'What will be installed'", async () => {
    const stub = stubLauncher();
    const folder: ServerInstanceInfo = {
      folderId: `server-${String(SERVER_IDS.cubeIsland)}`,
      serverId: SERVER_IDS.cubeIsland,
      sizeBytes: 0,
      lastPlayedAt: null,
      installed: { minecraft: '1.21.1', loader: { kind: 'vanilla', version: null } },
    };
    stub.api.instances.list = (): ReturnType<typeof stub.api.instances.list> =>
      Promise.resolve({ ok: true, value: [folder] });
    const note = fill(ru.install.updateFrom, { old: '1.21.1', new: '1.21.4' });
    const { app, router } = await open(`/launch/${String(SERVER_IDS.cubeIsland)}`, stub);
    const notes = app.findAll('.step-note').map((item) => item.text());
    expect(notes[1]).toBe(note);
    expect(notes.filter((text) => text === note)).toHaveLength(1);
    await router.push(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await flushPromises();
    expect(app.find('.is-launch [data-size-note]').text()).toBe(note);
  });

  it("a server's own launcher does not trigger an install", async () => {
    const { app, api } = await open(`/launch/${String(SERVER_IDS.technograd)}`);
    expect(app.text()).toContain(ru.install.ownTitle);
    expect(app.find('.steps').exists()).toBe(false);
    expect(api.launch.launch).not.toHaveBeenCalled();
  });

  it("an unknown server — 'not found'", async () => {
    const { app } = await open('/launch/999999');
    expect(app.find('h1').text()).toBe(ru.install.notFound);
  });

  it("without a connection and without a cache — 'no connection' with retry, not 'not found'", async () => {
    const stub = stubLauncher();
    const mounted = await mountScreen(`/launch/${String(SERVER_IDS.cubeIsland)}`, {
      stub,
      demo: false,
    });
    const { app } = mounted;
    expect(app.text()).not.toContain(ru.install.notFound);
    const alert = app.find('[role="alert"]');
    expect(alert.text()).toContain(ru.state.offlineTitle);
    const before = vi.mocked(stub.api.site.server).mock.calls.length;
    await alert.find('button').trigger('click');
    expect(vi.mocked(stub.api.site.server).mock.calls.length).toBe(before + 1);
  });

  it('cancelling the install — a calm card, not an error', async () => {
    const { app, emit } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(failedEvent({ code: 'cancelled' }));
    await flushPromises();
    expect(app.find('.notice.is-error').exists()).toBe(false);
    expect(app.find('.notice.is-cancelled').text()).toContain(ru.launchError.cancelled.title);
    expect(app.find('[data-eyebrow]').attributes('data-eyebrow')).toBe('muted');
  });

  it('a snapshot with a stale seq does not overwrite a newer one', async () => {
    const { app, emit } = await open(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(
      launchEvent(
        { kind: 'progress' },
        { seq: 50, phase: 'preparing', progress: progress(['done', 'active'], 64) },
      ),
    );
    emit(
      launchEvent(
        { kind: 'progress' },
        { seq: 49, phase: 'preparing', progress: progress(['active'], 12) },
      ),
    );
    await flushPromises();
    const statuses = app
      .findAll('.step')
      .map((step) => step.classes().find((name) => name.startsWith('is-')));
    expect(statuses.slice(0, 2)).toEqual(['is-done', 'is-active']);
  });
});
