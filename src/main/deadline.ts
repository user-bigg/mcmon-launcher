export function withDeadline<T>(work: Promise<T>, ms: number, late: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(late);
    }, ms);
    timer.unref();
    void work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(late);
      },
    );
  });
}
