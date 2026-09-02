import { describe, expect, it } from "vitest";
import { Rng, hashSeed } from "../src/core/rng";

describe("Rng", () => {
  it("is fully reproducible from its seed", () => {
    const one = new Rng("run");
    const two = new Rng("run");
    const seqA = Array.from({ length: 50 }, () => one.next());
    const seqB = Array.from({ length: 50 }, () => two.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = Array.from({ length: 10 }, () => new Rng("alpha").next());
    const b = Array.from({ length: 10 }, () => new Rng("beta").next());
    expect(a[0]).not.toEqual(b[0]);
  });

  it("keeps every draw inside [0, 1)", () => {
    const rng = new Rng("range");
    for (let i = 0; i < 2000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("counts its draws", () => {
    const rng = new Rng("count");
    expect(rng.count).toBe(0);
    rng.next();
    rng.next();
    expect(rng.count).toBe(2);
  });

  it("returns inclusive integer bounds", () => {
    const rng = new Rng("ints");
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) seen.add(rng.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("rejects an empty integer range", () => {
    expect(() => new Rng("bad").int(5, 4)).toThrow(RangeError);
  });

  it("treats chance(0) and chance(1) as certainties without drawing", () => {
    const rng = new Rng("chance");
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.count).toBe(0);
    expect(typeof rng.chance(0.5)).toBe("boolean");
    expect(rng.count).toBe(1);
  });

  it("samples weighted items in proportion to their weights", () => {
    const rng = new Rng("weights");
    const items = [
      { id: "common", weight: 3 },
      { id: "rare", weight: 1 },
    ];
    const tally: Record<string, number> = { common: 0, rare: 0 };
    for (let i = 0; i < 20000; i++) {
      const picked = rng.weighted(items, (item) => item.weight)!;
      tally[picked.id] = (tally[picked.id] ?? 0) + 1;
    }
    const ratio = tally["common"]! / tally["rare"]!;
    expect(ratio).toBeGreaterThan(2.7);
    expect(ratio).toBeLessThan(3.3);
  });

  it("never selects a non-positive weight, and gives up when none are positive", () => {
    const rng = new Rng("zero");
    const items = [
      { id: "off", weight: 0 },
      { id: "on", weight: 5 },
      { id: "negative", weight: -2 },
    ];
    for (let i = 0; i < 500; i++) {
      expect(rng.weighted(items, (item) => item.weight)!.id).toBe("on");
    }
    expect(rng.weighted(items.filter((i) => i.weight <= 0), (i) => i.weight)).toBeUndefined();
    expect(rng.weighted([], () => 1)).toBeUndefined();
  });

  it("shuffles into a permutation without touching the input", () => {
    const rng = new Rng("shuffle");
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(new Rng("shuffle").shuffle(input)).toEqual(out);
  });

  it("throws when picking from nothing", () => {
    expect(() => new Rng("pick").pick([])).toThrow(RangeError);
  });

  it("derives sub-streams that do not depend on the parent's position", () => {
    const parent = new Rng("root");
    const early = parent.stream("combat").next();
    for (let i = 0; i < 100; i++) parent.next();
    const late = parent.stream("combat").next();
    expect(late).toBe(early);
    expect(parent.stream("loot").next()).not.toBe(early);
  });

  it("hashes seeds to stable unsigned integers", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
    expect(hashSeed("")).toBeGreaterThanOrEqual(0);
  });
});
