import { describe, expect, it } from "vitest";
import { RANK_ALPHABET, compareRanks, isValidRank, rankBetween, rebalanceRanks } from "./rank-logic";

function randomKey(rng: () => number): string {
  const len = 1 + Math.floor(rng() * 5);
  let s = "";
  for (let i = 0; i < len; i++) s += RANK_ALPHABET[Math.floor(rng() * 26)];
  return s.replace(/a+$/, "") || "n";
}

// Tiny deterministic PRNG so the property test is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("rankBetween", () => {
  it("starts an empty column in the middle", () => {
    expect(rankBetween(null, null)).toBe("n");
  });
  it("finds room before and after a key", () => {
    expect(rankBetween(null, "n")).toBe("g");
    expect(rankBetween("n", null)).toBe("t");
    expect(rankBetween(null, "b")).toBe("an");
    expect(rankBetween("z", null)).toBe("zn");
  });
  it("splits adjacent and prefix cases", () => {
    expect(rankBetween("n", "o")).toBe("nn");
    expect(rankBetween("n", "nb")).toBe("nan");
    expect(rankBetween(null, "ab")).toBe("aan");
    expect(rankBetween("a", "b")).toBe("an");
  });
  it("always lands strictly between random neighbours and stays canonical", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      let p = randomKey(rng);
      let n = randomKey(rng);
      if (p === n) continue;
      if (p > n) [p, n] = [n, p];
      const out = rankBetween(p, n);
      expect(compareRanks(p, out)).toBe(-1);
      expect(compareRanks(out, n)).toBe(-1);
      expect(isValidRank(out)).toBe(true);
    }
  });
  it("grows at most one character per repeated split of the same gap", () => {
    let prev = "n";
    let last = prev;
    for (let i = 0; i < 200; i++) {
      const out = rankBetween(prev, "o");
      expect(out > prev && out < "o").toBe(true);
      expect(out.length - last.length).toBeLessThanOrEqual(1);
      last = out;
      prev = out;
    }
    let after = "n";
    for (let i = 0; i < 200; i++) {
      const out = rankBetween(after, null);
      expect(out > after).toBe(true);
      after = out;
    }
    let before = "n";
    for (let i = 0; i < 200; i++) {
      const out = rankBetween(null, before);
      expect(out < before).toBe(true);
      before = out;
    }
  });
  it("refuses inverted neighbours", () => {
    expect(() => rankBetween("o", "n")).toThrow();
    expect(() => rankBetween("n", "n")).toThrow();
  });
});

describe("rebalanceRanks", () => {
  it("returns nothing for an empty column", () => {
    expect(rebalanceRanks(0)).toEqual([]);
  });
  it("spaces keys evenly, strictly increasing, canonical and short", () => {
    for (const n of [1, 5, 26, 100, 1000]) {
      const keys = rebalanceRanks(n);
      expect(keys).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        expect(isValidRank(keys[i])).toBe(true);
        if (i > 0) expect(compareRanks(keys[i - 1], keys[i])).toBe(-1);
      }
      expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(n <= 12 ? 1 : n <= 337 ? 2 : 3);
      // Room remains on both sides of every key.
      expect(rankBetween(null, keys[0]) < keys[0]).toBe(true);
      expect(rankBetween(keys[n - 1], null) > keys[n - 1]).toBe(true);
    }
  });
});
