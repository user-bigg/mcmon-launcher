export interface VisibleGate {
  tick: () => void;
  dispose: () => void;
}

// A window hidden for the time of the game asks the site nothing on its own timers: the ticks
// it missed become one run when it is shown again.
export function whenVisible(run: () => void): VisibleGate {
  const page = typeof document === 'undefined' ? undefined : document;
  let missed = false;
  const shown = (): void => {
    if (page?.hidden === false && missed) {
      missed = false;
      run();
    }
  };
  page?.addEventListener('visibilitychange', shown);
  return {
    tick: (): void => {
      if (page?.hidden === true) {
        missed = true;
      } else {
        run();
      }
    },
    dispose: (): void => {
      page?.removeEventListener('visibilitychange', shown);
    },
  };
}
