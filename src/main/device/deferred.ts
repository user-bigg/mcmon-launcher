export const DEVICE_READ_DELAY_MS = 1000;

type SetTimer = (run: () => void, ms: number) => () => void;

// reg.exe is started on the main thread, so the first read waits until the window is on its way;
// a sign-in or a telemetry batch that comes earlier starts it at once.
export function readAfterStart<T>(
  read: () => Promise<T>,
  setTimer: SetTimer,
  delayMs: number = DEVICE_READ_DELAY_MS,
): () => Promise<T> {
  setTimer(() => {
    void read().catch(() => undefined);
  }, delayMs);
  return read;
}
