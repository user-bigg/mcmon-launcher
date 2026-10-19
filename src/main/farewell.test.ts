import { describe, expect, it, vi } from 'vitest';
import { aliveStateOf, Farewell, FAREWELL_MS, type FarewellDeps } from './farewell';

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

interface Built {
  farewell: Farewell;
  deps: { [K in keyof FarewellDeps]: ReturnType<typeof vi.fn<FarewellDeps[K]>> };
  sent: Gate;
  timeout: Gate;
}

function setup(): Built {
  const sent = gate();
  const timeout = gate();
  const deps = {
    send: vi.fn(() => sent.promise),
    withdraw: vi.fn(),
    leave: vi.fn(),
    wait: vi.fn<FarewellDeps['wait']>(() => timeout.promise),
    hideWindows: vi.fn(),
    quit: vi.fn(),
  };
  return { farewell: new Farewell(deps), deps, sent, timeout };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('app.alive state', () => {
  const window = (visible: boolean, minimized: boolean): Parameters<typeof aliveStateOf>[1] => ({
    isVisible: () => visible,
    isMinimized: () => minimized,
  });

  it('a running game wins, then a visible window, otherwise background', () => {
    expect(aliveStateOf(true, window(true, false))).toBe('playing');
    expect(aliveStateOf(true, null)).toBe('playing');
    expect(aliveStateOf(false, window(true, false))).toBe('foreground');
    expect(aliveStateOf(false, window(true, true))).toBe('background');
    expect(aliveStateOf(false, window(false, false))).toBe('background');
    expect(aliveStateOf(false, null)).toBe('background');
  });
});

describe('farewell on quit', () => {
  it('holds the quit, hides the windows and quits once the batch has left', async () => {
    const { farewell, deps, sent } = setup();
    expect(farewell.holdQuit()).toBe(true);
    expect(farewell.holdQuit()).toBe(true);
    expect(deps.send).toHaveBeenCalledOnce();
    expect(deps.hideWindows).toHaveBeenCalledOnce();
    expect(deps.quit).not.toHaveBeenCalled();
    sent.open();
    await tick();
    expect(deps.quit).toHaveBeenCalledOnce();
    expect(farewell.holdQuit()).toBe(false);
  });

  it('a slow send is cut off by the timeout', async () => {
    const { farewell, deps, timeout } = setup();
    farewell.holdQuit();
    expect(deps.wait).toHaveBeenCalledWith(FAREWELL_MS);
    expect(FAREWELL_MS).toBeLessThanOrEqual(1500);
    timeout.open();
    await tick();
    expect(deps.quit).toHaveBeenCalledOnce();
    expect(farewell.holdQuit()).toBe(false);
  });

  it('a failing send still lets the launcher quit', async () => {
    const { farewell, deps } = setup();
    deps.send.mockImplementation(() => Promise.reject(new Error('disk')));
    farewell.holdQuit();
    await tick();
    expect(deps.quit).toHaveBeenCalledOnce();
  });

  it('a second start during the farewell cancels the quit and takes the event back', async () => {
    const { farewell, deps, sent, timeout } = setup();
    farewell.holdQuit();
    expect(farewell.stay()).toBe(true);
    expect(deps.withdraw).toHaveBeenCalledOnce();
    sent.open();
    timeout.open();
    await tick();
    expect(deps.quit).not.toHaveBeenCalled();
    expect(farewell.stay()).toBe(false);
    expect(farewell.holdQuit()).toBe(true);
    expect(deps.send).toHaveBeenCalledTimes(2);
  });

  it('a second start outside the farewell changes nothing', () => {
    const { farewell, deps } = setup();
    expect(farewell.stay()).toBe(false);
    expect(deps.withdraw).not.toHaveBeenCalled();
  });

  it('an update install or a session end does not wait: the event is only queued, once', () => {
    const { farewell, deps } = setup();
    farewell.skip();
    farewell.skip();
    expect(deps.leave).toHaveBeenCalledOnce();
    expect(farewell.holdQuit()).toBe(false);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.hideWindows).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('a skip during the farewell stops it from quitting a second time', async () => {
    const { farewell, deps, sent } = setup();
    farewell.holdQuit();
    farewell.skip();
    expect(deps.leave).not.toHaveBeenCalled();
    expect(farewell.holdQuit()).toBe(false);
    sent.open();
    await tick();
    expect(deps.quit).not.toHaveBeenCalled();
  });
});
