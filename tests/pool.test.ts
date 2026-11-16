import { describe, expect, it } from 'vitest';
import { Pool } from '../src/core/pool';

describe('Pool', () => {
  it('hands out each slot once and reports exhaustion', () => {
    const p = new Pool(3, (i) => ({ i }));
    const a = [p.acquire(), p.acquire(), p.acquire()];
    expect(new Set(a).size).toBe(3);
    expect(p.acquire()).toBe(-1);
    expect(p.liveCount).toBe(3);
  });
  it('recycles released slots without allocating new objects', () => {
    const p = new Pool(2, (i) => ({ i }));
    const first = p.acquire();
    const obj = p.items[first];
    p.release(first);
    const again = p.acquire();
    expect(p.items[again]).toBe(obj);
  });
  it('ignores double release', () => {
    const p = new Pool(2, () => ({}));
    const a = p.acquire();
    p.release(a);
    p.release(a);
    expect(p.liveCount).toBe(0);
    p.acquire();
    p.acquire();
    expect(p.acquire()).toBe(-1);
  });
  it('releaseAll resets and iterates only live items', () => {
    const p = new Pool(4, (i) => i);
    p.acquire();
    p.acquire();
    const seen: number[] = [];
    p.forEachLive((v) => seen.push(v));
    expect(seen).toHaveLength(2);
    p.releaseAll();
    expect(p.liveCount).toBe(0);
  });
});
