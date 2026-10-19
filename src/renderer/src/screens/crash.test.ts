// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeCrash } from '@shared/crash-text';
import { ru } from '@shared/i18n/ru';
import { crashes } from '../mock/player';
import { openScreen as open, unmountScreen } from '../screen-testing';

afterEach(unmountScreen);

describe('crash screen', () => {
  it('joined before load: signed exit code, Moscow time, a build link, a launch without the join', async () => {
    const analysis = crashes[0];
    if (analysis === undefined) {
      throw new Error('mock crash missing');
    }
    const { app, api, emitCrash, router } = await open('/library');
    vi.mocked(api.crash.apply).mockResolvedValue({
      ok: true,
      value: { fix: { type: 'launch-without-join' }, report: null },
    });
    emitCrash({
      kind: 'analyzed',
      analysis: {
        ...analysis,
        id: 'real-crash-0003',
        instance: 'server-105',
        at: '2026-10-14T02:24:00.000Z',
        exit: { code: 4294967295, signal: null },
        cause: { code: 'join-before-load' },
        fixes: [{ type: 'launch-without-join' }, { type: 'open-log' }, { type: 'report' }],
      },
    });
    await router.push('/crash/server-105');
    await flushPromises();
    expect(app.find('[role="alert"] h1').text()).toBe(
      ru.crashAnalysis.causes['join-before-load'].title,
    );
    const meta = app.find('.alert-meta').text();
    expect(meta).toContain('05:24 по Москве');
    expect(meta).not.toContain('Код выхода');
    expect(app.find('details[data-details] [data-exit-code]').text()).toBe('Код выхода -1');
    expect(app.find('.crumbs a[href$="/server/105"]').exists()).toBe(true);
    await app.find('.fix.is-best button').trigger('click');
    await flushPromises();
    expect(api.crash.apply).toHaveBeenCalledWith({ analysisId: 'real-crash-0003', fix: 0 });
    expect(api.launch.launch).toHaveBeenCalledWith(expect.objectContaining({ joinServer: false }));
  });

  it('the cause and fixes from the analysis model, the first one is primary', async () => {
    const { app } = await open('/crash/server-103');
    const analysis = crashes[0];
    if (analysis === undefined) {
      throw new Error('mock crash missing');
    }
    const text = describeCrash(analysis);
    expect(app.find('[role="alert"] h1').text()).toBe(text.title);
    const fixes = app.findAll('.fix');
    expect(fixes).toHaveLength(analysis.fixes.length);
    expect(fixes[0]?.classes()).toContain('is-best');
    expect(fixes[0]?.text()).toContain(text.fixes[0]?.title);
  });

  it('the technical line is kept out of the alert, in the folded details', async () => {
    const analysis = crashes[0];
    if (analysis === undefined) {
      throw new Error('mock crash missing');
    }
    const evidence = 'fyk$a: GLFW error 65544: WGL: Failed to retrieve pixel format attributes';
    const { app, emitCrash, router } = await open('/library');
    emitCrash({
      kind: 'analyzed',
      analysis: { ...analysis, id: 'real-crash-0002', instance: 'server-105', evidence },
    });
    await router.push('/crash/server-105');
    await flushPromises();
    expect(app.find('[role="alert"]').text()).not.toContain('GLFW');
    const details = app.find('details[data-details]');
    expect(details.attributes('open')).toBeUndefined();
    expect(details.find('summary').text()).toBe(ru.crash.details);
    expect(details.find('[data-evidence]').text()).toBe(evidence);
  });

  it('opened before the analysis of a game stopped at its dialog: the log, the dialog line, the stop', async () => {
    const analysis = crashes[0];
    if (analysis === undefined) {
      throw new Error('mock crash missing');
    }
    const { app, api, emitCrash, router } = await open('/library');
    vi.mocked(api.launch.logTail).mockResolvedValue({
      ok: true,
      value: ['[MC Monitor] minecraft=1.21.11', 'Backend library: LWJGL version 3.3.3'],
    });
    await router.push('/crash/server-105');
    await flushPromises();
    expect(app.find('h1').text()).toBe(ru.crash.notFound);
    emitCrash({
      kind: 'analyzed',
      analysis: {
        ...analysis,
        id: 'real-crash-0004',
        instance: 'server-105',
        exit: { code: null, signal: 'SIGTERM' },
        cause: { code: 'graphics', problem: 'context' },
        rule: 'game-dialog',
        evidence: null,
      },
    });
    await flushPromises();
    const details = app.find('details[data-details]');
    expect(details.find('[data-evidence]').text()).toBe(ru.crash.dialogStopped);
    expect(details.find('[data-evidence]').classes()).not.toContain('lx-mono');
    expect(details.find('[data-exit-code]').text()).toBe(
      'Кода выхода нет: процесс остановлен (SIGTERM)',
    );
    expect(details.find('pre.log').text()).toContain('LWJGL version 3.3.3');
    expect(details.text()).not.toContain(ru.crash.logEmpty);
  });
});
