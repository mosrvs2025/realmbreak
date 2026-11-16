/**
 * Fixed-capacity object pool. Objects are allocated once and recycled — nothing is
 * created or garbage-collected during play (important for steady 72 fps on Quest).
 */
export class Pool<T> {
  readonly items: T[];
  private readonly free: number[] = [];
  private readonly live: boolean[];

  constructor(readonly capacity: number, factory: (index: number) => T) {
    this.items = Array.from({ length: capacity }, (_, i) => factory(i));
    this.live = new Array<boolean>(capacity).fill(false);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }

  /** Returns the index of a free slot, or -1 when the pool is exhausted. */
  acquire(): number {
    const i = this.free.pop();
    if (i === undefined) return -1;
    this.live[i] = true;
    return i;
  }

  release(index: number): void {
    if (!this.live[index]) return;
    this.live[index] = false;
    this.free.push(index);
  }

  isLive(index: number): boolean {
    return this.live[index];
  }

  get liveCount(): number {
    return this.capacity - this.free.length;
  }

  releaseAll(): void {
    this.free.length = 0;
    for (let i = this.capacity - 1; i >= 0; i--) {
      this.live[i] = false;
      this.free.push(i);
    }
  }

  forEachLive(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this.capacity; i++) if (this.live[i]) fn(this.items[i], i);
  }
}
