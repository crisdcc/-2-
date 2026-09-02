/**
 * Deterministic pseudo-randomness.
 *
 * The whole simulation is reproducible from a single seed string. Subsystems
 * take *named sub-streams* (`rng.stream("raid:day-12")`) so that consuming an
 * extra roll in one system can never shift the numbers another system sees.
 */

/** xmur3 string hash — turns a seed string into a 32-bit integer. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  readonly seed: string;
  private state: number;
  private draws = 0;

  constructor(seed: string) {
    this.seed = seed;
    // A zero state is a valid mulberry32 input, but nudging it off zero keeps
    // the very first draw of a pathological seed from being degenerate.
    this.state = hashSeed(seed) || 0x9e3779b9;
  }

  /** Number of values drawn so far — handy for asserting stream isolation. */
  get count(): number {
    return this.draws;
  }

  /** mulberry32: fast, well-distributed, exactly reproducible. */
  next(): number {
    this.draws++;
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in `[min, max)`. */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in `[min, max]`, both ends inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`Rng.int: empty range [${min}, ${max}]`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`; `p <= 0` never fires and `p >= 1` always does. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Rng.pick: empty collection");
    return items[this.int(0, items.length - 1)]!;
  }

  /**
   * Weighted selection. Non-positive weights are treated as ineligible; if no
   * item has a positive weight the caller gets `undefined` rather than a
   * silently wrong pick.
   */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T | undefined {
    let total = 0;
    let last: T | undefined;
    for (const item of items) {
      const w = weightOf(item);
      if (w > 0) {
        total += w;
        last = item;
      }
    }
    if (total <= 0) return undefined;

    let roll = this.next() * total;
    for (const item of items) {
      const w = weightOf(item);
      if (w <= 0) continue;
      roll -= w;
      if (roll < 0) return item;
    }
    // Only reachable through floating-point drift on the final item.
    return last;
  }

  /** Fisher-Yates on a copy; the input array is left untouched. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = out[i]!;
      out[i] = out[j]!;
      out[j] = a;
    }
    return out;
  }

  /**
   * A fresh generator derived from this one's seed and a label. Same seed plus
   * same label always yields the same stream, independent of how many values
   * this generator has already produced.
   */
  stream(label: string): Rng {
    return new Rng(`${this.seed}::${label}`);
  }
}
