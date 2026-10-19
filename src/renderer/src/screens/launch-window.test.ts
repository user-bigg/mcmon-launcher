// @vitest-environment happy-dom
import { flushPromises, type DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { LaunchState, LaunchStepStatus } from '@shared/launch';
import type { SkinModTable } from '@shared/skin-mod';
import { SERVER_IDS } from '../mock/servers';
import { openScreen as open, progress, unmountScreen } from '../screen-testing';
import { idleSteps, stepView } from '../lib/launch-view';
import { formatMemoryMb } from '../lib/units';
import { launchEvent, stubLauncher, type Mounted, type Stub } from '../testing';

const LAUNCH = `/launch/${String(SERVER_IDS.cubeIsland)}`;
const STARTING: LaunchStepStatus[] = ['done', 'done', 'skipped', 'done', 'active', 'wait'];
const PLAYING: LaunchStepStatus[] = ['done', 'done', 'skipped', 'done', 'done', 'active'];

const table: SkinModTable = {
  updated_at: '2026-10-13T07:30:51Z',
  service_root: 'https://mc-mon.ru/skins/',
  source_url: null,
  license_url: null,
  license: null,
  entries: [
    {
      minecraft: '1.21.4',
      loader: 'fabric',
      loader_version: '0.19.5',
      mod: {
        version: '15.1-Universal',
        urls: ['https://cdn.modrinth.com/data/idMHQ4n2/versions/yyYvYfZI/mod.jar'],
        sha256: 'c'.repeat(64),
        size: 222917,
      },
    },
  ],
  client_mod: null,
};

function withTable(): Stub {
  const stub = stubLauncher();
  stub.api.site.skinMod = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: table,
      stale: false,
      fetchedAt: '2026-10-13T08:00:00Z',
    }),
  );
  return stub;
}

async function playing(stub?: Stub): Promise<Mounted> {
  const mounted = await open(LAUNCH, stub);
  const button = mounted.app.findAll('button').find((item) => item.text() === ru.install.start);
  await button?.trigger('click');
  await flushPromises();
  return mounted;
}

async function running(mounted: Mounted, state: Partial<LaunchState>): Promise<void> {
  mounted.emit(
    launchEvent(
      { kind: 'progress' },
      {
        phase: 'running',
        operationId: 1,
        progress: progress(state.windowReady === true ? PLAYING : STARTING, 100),
        ...state,
      },
    ),
  );
  await flushPromises();
}

async function preparing(mounted: Mounted, state: Partial<LaunchState> = {}): Promise<void> {
  mounted.emit(
    launchEvent(
      { kind: 'progress' },
      { phase: 'preparing', operationId: 1, progress: progress(['done', 'active'], 40), ...state },
    ),
  );
  await flushPromises();
}

function button(app: Mounted['app'], text: string): DOMWrapper<Element> | undefined {
  return app.findAll('button').find((item) => item.text() === text);
}

function toggle(app: Mounted['app'], label: string): DOMWrapper<Element> {
  return app.find(`.side [role="switch"][aria-label="${label}"]`);
}

function isLocked(item: DOMWrapper<Element>): boolean {
  return item.attributes('disabled') !== undefined;
}

afterEach(unmountScreen);

describe('launch screen: waiting for the game window', () => {
  it('a started process without a window is a wait, not a running game', async () => {
    const mounted = await playing();
    await running(mounted, { windowReady: false });
    const { app } = mounted;
    expect(app.find('.lx-eyebrow').text()).toBe(ru.install.eyebrowStarting);
    expect(app.find('h1').text()).toBe(
      fill(ru.install.titleStarting, { name: 'Кубический Остров' }),
    );
    expect(app.text()).not.toContain(ru.install.eyebrowRunning);
    expect(app.find('[data-slow-start]').exists()).toBe(false);
    expect(button(app, ru.install.cancel)).toBeDefined();
    expect(button(app, ru.install.kill)).toBeUndefined();
  });

  it("the window appearing turns the screen to 'the game is running'", async () => {
    const mounted = await playing();
    await running(mounted, { windowReady: false });
    await running(mounted, { windowReady: true });
    const { app } = mounted;
    expect(app.find('.lx-eyebrow').text()).toBe(ru.install.eyebrowRunning);
    expect(app.find('h1').text()).toBe(
      fill(ru.install.titleRunning, { name: 'Кубический Остров' }),
    );
    expect(button(app, ru.install.kill)).toBeDefined();
    expect(button(app, ru.install.cancel)).toBeUndefined();
  });

  it('a slow start is a calm notice with two actions and no alert', async () => {
    const mounted = await playing();
    await running(mounted, { windowReady: false, windowSlow: true });
    const notice = mounted.app.find('[data-slow-start]');
    expect(notice.attributes('role')).toBe('status');
    expect(notice.text()).toContain(ru.install.slowTitle);
    expect(notice.findAll('button').map((item) => item.text())).toEqual([
      ru.install.slowWait,
      ru.install.slowStop,
    ]);
    expect(mounted.app.find('.notice[role="alert"]').exists()).toBe(false);
    expect(button(mounted.app, ru.install.cancel)).toBeUndefined();
  });

  it("'Wait more' asks the service to keep waiting and hides the notice", async () => {
    const mounted = await playing();
    await running(mounted, { windowReady: false, windowSlow: true });
    await button(mounted.app, ru.install.slowWait)?.trigger('click');
    await flushPromises();
    expect(mounted.api.launch.keepWaiting).toHaveBeenCalledOnce();
    expect(mounted.api.launch.cancel).not.toHaveBeenCalled();
    expect(mounted.app.find('[data-slow-start]').exists()).toBe(false);
  });

  it("'Close the game' from the slow notice stops the game", async () => {
    const mounted = await playing();
    await running(mounted, { windowReady: false, windowSlow: true });
    await button(mounted.app, ru.install.slowStop)?.trigger('click');
    expect(mounted.api.launch.cancel).toHaveBeenCalledOnce();
    expect(mounted.api.launch.keepWaiting).not.toHaveBeenCalled();
  });

  it("the game's own error dialog: an alert whose button stops the launch", async () => {
    const mounted = await playing();
    await running(mounted, { windowReady: false, windowSlow: true, windowDialog: true });
    const notice = mounted.app.find('[data-game-dialog]');
    expect(notice.attributes('role')).toBe('alert');
    expect(notice.text()).toContain(ru.install.dialogTitle);
    expect(notice.text()).toContain(ru.install.dialogText);
    expect(mounted.app.find('[data-slow-start]').exists()).toBe(false);
    expect(button(mounted.app, ru.install.cancel)).toBeUndefined();
    expect(mounted.app.find('h1').text()).toBe(
      fill(ru.install.titleDialog, { name: 'Кубический Остров' }),
    );
    await running(mounted, { windowReady: false, windowSlow: true, windowDialog: true });
    await mounted.app.find('[data-game-dialog] button').trigger('click');
    expect(mounted.api.launch.cancel).toHaveBeenCalledOnce();
    await running(mounted, { windowReady: false, windowDialog: false });
    expect(mounted.app.find('[data-game-dialog]').exists()).toBe(false);
  });

  it('the notice is gone once the window opens', async () => {
    const mounted = await playing();
    await running(mounted, { windowReady: false, windowSlow: true });
    await running(mounted, { windowReady: true, windowSlow: false });
    expect(mounted.app.find('[data-slow-start]').exists()).toBe(false);
  });
});

describe("launch screen: the 'On launch' switches in each phase", () => {
  it('before the launch every switch is free and no note is shown', async () => {
    const { app } = await open(LAUNCH, withTable());
    expect(isLocked(toggle(app, ru.install.autoJoin))).toBe(false);
    expect(isLocked(toggle(app, ru.install.withoutMods))).toBe(false);
    expect(isLocked(toggle(app, ru.install.minimize))).toBe(false);
    expect(app.find('[data-locked-note]').exists()).toBe(false);
  });

  it('while the files install the switches stay free, and joining is passed to the launch', async () => {
    const mounted = await playing(withTable());
    await preparing(mounted);
    const { app, api } = mounted;
    expect(isLocked(toggle(app, ru.install.withoutMods))).toBe(false);
    expect(isLocked(toggle(app, ru.install.minimize))).toBe(false);
    const join = toggle(app, ru.install.autoJoin);
    expect(isLocked(join)).toBe(false);
    await join.trigger('click');
    await flushPromises();
    expect(api.launch.setJoinServer).toHaveBeenCalledWith(false);
    await toggle(app, ru.install.withoutMods).trigger('click');
    await flushPromises();
    expect(api.instances.setWithoutMods).toHaveBeenCalledWith(
      `server-${String(SERVER_IDS.cubeIsland)}`,
      true,
    );
    expect(app.find('[data-locked-note]').exists()).toBe(false);
  });

  it("once the loader step has read the choice, 'without mods' is locked with a note", async () => {
    const mounted = await playing(withTable());
    await preparing(mounted, { skins: 'on' });
    const { app } = mounted;
    expect(isLocked(toggle(app, ru.install.withoutMods))).toBe(true);
    expect(app.find('[data-without-mods] [data-locked-note]').text()).toBe(ru.install.lockedNote);
    expect(isLocked(toggle(app, ru.install.autoJoin))).toBe(false);
    expect(isLocked(toggle(app, ru.install.minimize))).toBe(false);
  });

  it('joining locks when the launch step begins, before the process exists', async () => {
    const mounted = await playing(withTable());
    mounted.emit(
      launchEvent(
        { kind: 'progress' },
        { phase: 'preparing', operationId: 1, progress: progress(STARTING, 100), skins: 'on' },
      ),
    );
    await flushPromises();
    expect(isLocked(toggle(mounted.app, ru.install.autoJoin))).toBe(true);
    expect(mounted.app.find('[data-auto-join] [data-locked-note]').text()).toBe('Уже выбрано');
  });

  it('a choice the launch refuses is put back on the switch', async () => {
    const stub = withTable();
    stub.api.launch.setJoinServer = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'running' as const } }),
    );
    const mounted = await playing(stub);
    await preparing(mounted);
    const join = toggle(mounted.app, ru.install.autoJoin);
    await join.trigger('click');
    await flushPromises();
    expect(stub.api.launch.setJoinServer).toHaveBeenCalledOnce();
    expect(join.attributes('aria-checked')).toBe('true');
  });

  it('a note never adds a line: every switch row keeps one line under its name', async () => {
    const mounted = await playing(withTable());
    const rows = (): number[] =>
      ['[data-auto-join]', '[data-without-mods]', '[data-conceal]'].map(
        (row) => mounted.app.findAll(`${row} .lx-row-desc`).length,
      );
    await preparing(mounted);
    expect(rows()).toEqual([1, 1, 1]);
    await running(mounted, { windowReady: false, skins: 'on' });
    expect(rows()).toEqual([1, 1, 1]);
    await running(mounted, { windowReady: true, skins: 'on' });
    expect(rows()).toEqual([1, 1, 1]);
    expect(mounted.app.find('[data-conceal]').text()).toContain('Со следующего запуска');
  });

  it('a join step that was skipped for a server with an address does not blame the build', async () => {
    const mounted = await playing();
    mounted.emit(
      launchEvent(
        { kind: 'progress' },
        {
          phase: 'idle',
          operationId: 1,
          progress: progress(['done', 'done', 'skipped', 'done', 'failed', 'skipped'], 100),
        },
      ),
    );
    await flushPromises();
    const join = mounted.app.findAll('.step')[5]?.text() ?? '';
    expect(join).toContain(ru.install.joinNotRun);
  });

  it('with the process started, joining and mods are locked with a note; hiding still applies to this launch', async () => {
    const mounted = await playing(withTable());
    await running(mounted, { windowReady: false, skins: 'on' });
    const { app, api } = mounted;
    expect(isLocked(toggle(app, ru.install.autoJoin))).toBe(true);
    expect(app.find('[data-auto-join] [data-locked-note]').text()).toBe(ru.install.lockedNote);
    expect(isLocked(toggle(app, ru.install.withoutMods))).toBe(true);
    const conceal = toggle(app, ru.install.minimize);
    expect(isLocked(conceal)).toBe(false);
    expect(app.find('[data-conceal]').text()).toContain(ru.install.minimizeNote);
    await conceal.trigger('click');
    await flushPromises();
    expect(conceal.attributes('aria-checked')).toBe('false');
    expect(api.launch.setJoinServer).not.toHaveBeenCalled();
  });

  it('during the game hiding can still be switched and says it applies next time; memory link stays', async () => {
    const mounted = await playing(withTable());
    await running(mounted, { windowReady: true, skins: 'on' });
    const { app } = mounted;
    const conceal = toggle(app, ru.install.minimize);
    expect(isLocked(conceal)).toBe(false);
    expect(app.find('[data-conceal]').text()).toContain(ru.install.nextLaunchNote);
    await conceal.trigger('click');
    expect(conceal.attributes('aria-checked')).toBe('false');
    const memory = app.find('[data-memory] a');
    expect(memory.text()).toBe(ru.install.memoryNote);
    expect(memory.attributes('href')).toContain('/settings');
  });

  it('a game of another server leaves the switches of this one free', async () => {
    const mounted = await playing(withTable());
    await running(mounted, { windowReady: true, skins: 'on' });
    await mounted.router.push(`/launch/${String(SERVER_IDS.wasteland)}`);
    await flushPromises();
    const { app } = mounted;
    expect(isLocked(toggle(app, ru.install.autoJoin))).toBe(false);
    expect(app.find('[data-locked-note]').exists()).toBe(false);
    expect(app.find('[data-conceal]').text()).toContain(ru.install.minimizeNote);
  });
});

describe('launch steps: time of the active step', () => {
  const context = {
    minecraft: '1.16.5',
    host: 'play.example.ru',
    memory: '3 ГБ',
    update: null,
    skins: null,
    fabric: null,
  };

  it("runs on the screen's clock, not only on progress events", () => {
    const [step] = idleSteps('vanilla').filter((item) => item.id === 'launch');
    if (step === undefined) {
      throw new Error('no launch step');
    }
    const active = {
      ...step,
      status: 'active' as const,
      startedAt: '2026-10-14T05:38:11.000Z',
      durationMs: 2000,
    };
    const at = (iso: string): string | null =>
      stepView(active, { ...context, nowMs: Date.parse(iso) }).right;
    expect(at('2026-10-14T05:38:13.000Z')).toBe(stepView(active, context).right);
    expect(at('2026-10-14T05:38:14.000Z')).not.toBe(at('2026-10-14T05:38:13.000Z'));
    expect(at('2026-10-14T05:41:13.000Z')).toContain('3');
    const done = { ...active, status: 'done' as const };
    expect(stepView(done, { ...context, nowMs: Date.parse('2026-10-14T06:00:00Z') }).right).toBe(
      stepView(active, context).right,
    );
  });
});

describe('the game memory on the launch screen and the server page', () => {
  function onSmallMachine(): Stub {
    const stub = stubLauncher();
    stub.api.system.memory = vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { totalMb: 5939, defaultGameMb: 3072 } }),
    );
    return stub;
  }

  it('both show the default the launch passes to -Xmx, taken from this computer', async () => {
    const { app, router } = await open(LAUNCH, onSmallMachine());
    expect(app.find('[data-memory] .lx-num').text()).toBe(formatMemoryMb(3072));
    await router.push(`/server/${String(SERVER_IDS.cubeIsland)}`);
    await flushPromises();
    expect(app.find('dd[data-memory]').text()).toBe(
      fill(ru.serverPage.installMemoryAuto, { value: formatMemoryMb(3072) }),
    );
  });
});
