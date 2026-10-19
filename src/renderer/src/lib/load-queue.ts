export interface LoadJob {
  run: () => Promise<unknown>;
  urgent: () => boolean;
}

export const TILE_LOADS_AT_ONCE = 6;

// A few loads at a time; of those waiting, the ones on screen go before the ones only near it.
export class LoadQueue {
  private readonly waiting: LoadJob[] = [];
  private running = 0;

  constructor(private readonly limit: number = TILE_LOADS_AT_ONCE) {}

  add(job: LoadJob): () => void {
    this.waiting.push(job);
    this.next();
    return (): void => {
      const index = this.waiting.indexOf(job);
      if (index !== -1) {
        this.waiting.splice(index, 1);
      }
    };
  }

  private next(): void {
    while (this.running < this.limit && this.waiting.length > 0) {
      const urgent = this.waiting.findIndex((job) => job.urgent());
      const [job] = this.waiting.splice(Math.max(urgent, 0), 1);
      if (job !== undefined) {
        this.start(job);
      }
    }
  }

  private start(job: LoadJob): void {
    this.running += 1;
    const done = (): void => {
      this.running -= 1;
      this.next();
    };
    job.run().then(done, done);
  }
}

export const tileLoads = new LoadQueue();
