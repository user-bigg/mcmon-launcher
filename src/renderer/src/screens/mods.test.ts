// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ru } from '@shared/i18n/ru';
import type { ModsStepState, ModStep } from '@shared/mods';
import { SERVER_IDS } from '../mock/servers';
import {
  failedEvent,
  openScreen as open,
  progress,
  progressEvent,
  unmountScreen,
} from '../screen-testing';

afterEach(unmountScreen);

const EMERALD = `/server/${String(SERVER_IDS.emeraldValley)}`;

const VOICE_STEP: ModStep = {
  slug: 'simple-voice-chat',
  short: 'Голосовой чат',
  title: 'Simple Voice Chat',
  credit: null,
  kind: 'mod',
  version: '2.6.24',
  channel: 'release',
  size: 2_200_000,
  bytesDone: 0,
  role: 'required',
  dependencyOf: [],
  status: 'failed',
  fromDisk: false,
};

const failedVoice: ModsStepState = { steps: [VOICE_STEP], skipped: [] };

describe('mods section', () => {
  it('sits in the menu after skins with the count of enabled mods', async () => {
    const { app } = await open('/mods');
    await flushPromises();
    const links = app.findAll('.sidebar .nav-link').map((link) => link.text());
    const skins = links.findIndex((text) => text.startsWith(ru.nav.skins));
    expect(links[skins + 1]).toBe(`${ru.nav.mods} 6`);
  });

  it('shows the groups with switches and turns a mod on', async () => {
    const { app } = await open('/mods');
    await flushPromises();
    expect(app.findAll('[data-mods-group]').map((item) => item.text())).toContain(
      ru.mods.groups.graphics,
    );
    const ferrite = app.find('[data-mod="ferritecore"] [role="switch"]');
    expect(ferrite.attributes('aria-checked')).toBe('false');
    await ferrite.trigger('click');
    await flushPromises();
    expect(app.find('[data-mod="ferritecore"] [role="switch"]').attributes('aria-checked')).toBe(
      'true',
    );
    expect(app.find('[data-mod="xaeros-minimap"] [data-mod-often-forbidden]').exists()).toBe(true);
  });

  it('shaders are one switch with a choice of packs and a credit line', async () => {
    const { app } = await open('/mods');
    await flushPromises();
    const shaders = app.find('[data-mod="shaders"]');
    expect(shaders.find('[data-shader-credit]').text()).toContain('Complementary Development');
    await shaders.find('[role="switch"]').trigger('click');
    await flushPromises();
    expect(app.find('[data-shader-credit]').exists()).toBe(false);
  });
});

describe('mods of a server', () => {
  it('the summary under Play opens a list with a locked required mod and a switch', async () => {
    const { app } = await open(EMERALD);
    await flushPromises();
    const summary = app.find('[data-server-mods] button');
    expect(summary.text()).toContain('голосовой чат и эмоции');
    await summary.trigger('click');
    const list = app.find('[data-server-mods-list]');
    expect(list.find(`[aria-label="${ru.mods.requiredLock}"]`).exists()).toBe(true);
    const emotes = list.find('[data-server-mod="emotecraft"] [role="switch"]');
    await emotes.trigger('click');
    await flushPromises();
    expect(app.find('[data-server-mods] button').text()).not.toContain('эмоции');
  });

  it('a banned mod of the player is marked on that server only', async () => {
    const { app } = await open(`/server/${String(SERVER_IDS.northernEdge)}`);
    await flushPromises();
    await app.find('[data-server-mods] button').trigger('click');
    expect(app.find('[data-server-mod="xaeros-minimap"]').text()).toContain(ru.mods.forbiddenMark);
  });

  it('a required mod that did not come stops the launch in its step with Retry', async () => {
    const { app, api, emit } = await open(EMERALD);
    await flushPromises();
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    emit(progressEvent({ ...progress(['done', 'done', 'active'], 80), mods: failedVoice }));
    await flushPromises();
    expect(app.find('[data-mod-group]').text()).toBe(ru.mods.groupServer);
    const error = {
      code: 'mods-required-failed' as const,
      mods: [{ slug: 'simple-voice-chat', short: 'Голосовой чат', title: 'Simple Voice Chat' }],
    };
    const failed = failedEvent(error);
    emit({
      ...failed,
      state: {
        ...failed.state,
        progress: { ...progress(['done', 'done', 'failed'], 80), mods: failedVoice },
      },
    });
    await flushPromises();
    const problem = app.find('[data-mod-problem="required"]');
    expect(problem.text()).toContain(ru.mods.failedRequired);
    expect(app.find('.notice[role="alert"]').exists()).toBe(false);
    const retry = problem.findAll('button').find((item) => item.text() === ru.mods.retry);
    await retry?.trigger('click');
    await flushPromises();
    expect(api.launch.launch).toHaveBeenCalledTimes(2);
  });

  it('an optional mod that did not come pauses the launch with a choice to play without it', async () => {
    const { app, api, emit } = await open(EMERALD);
    await flushPromises();
    await app.find('[data-launch="direct"]').trigger('click');
    await flushPromises();
    const emotes = {
      ...VOICE_STEP,
      slug: 'emotecraft',
      short: 'Эмоции',
      role: 'optional' as const,
    };
    const waiting = progressEvent({
      ...progress(['done', 'done', 'wait'], 80),
      mods: { steps: [emotes], skipped: [] },
    });
    emit({
      ...waiting,
      state: {
        ...waiting.state,
        modsWaiting: [{ slug: 'emotecraft', short: 'Эмоции', title: 'Emotecraft' }],
      },
    });
    await flushPromises();
    expect(app.find('[data-eyebrow]').text()).toBe(ru.mods.eyebrowWaiting);
    const choice = app.find('[data-mod-choice]');
    const without = choice.findAll('button').find((item) => item.text() === ru.mods.playWithout);
    await without?.trigger('click');
    expect(api.launch.answerMods).toHaveBeenCalledWith('without');
    await flushPromises();
    expect(app.find('[data-mod-choice]').exists()).toBe(false);
  });

  it('Escape closes the list of server mods and gives the focus back to the summary', async () => {
    const { app } = await open(EMERALD);
    await flushPromises();
    const summary = app.find('[data-server-mods] button');
    await summary.trigger('click');
    expect(summary.attributes('aria-controls')).toBeDefined();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    await app.find('[data-server-mods-list] [role="switch"]').trigger('keydown', { key: 'Escape' });
    document.removeEventListener('keydown', outer);
    expect(app.find('[data-server-mods-list]').exists()).toBe(false);
    expect(summary.attributes('aria-controls')).toBeUndefined();
    expect(document.activeElement).toBe(summary.element);
    expect(outer).not.toHaveBeenCalled();
  });
});
