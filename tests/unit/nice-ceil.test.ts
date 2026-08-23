/**
 * Tests for shared niceCeil axis helper.
 *
 * The regression this locks in: the old pure-powers-of-ten ladder jumped
 * 100 → 200, so a single 93-commit day doubled the Throughput y-axis and
 * visually squashed every other day. The per-decade ladder must land on
 * friendly intermediate steps instead.
 */
import { describe, expect, test } from "bun:test";
import { niceCeil } from "../../src/shared/math";

describe("niceCeil", () => {
  test("the 93-commit regression: 120, never 200", () => {
    // 93 × 1.2 headroom = 111.6 → next step is 120 on a per-decade ladder.
    expect(niceCeil(93)).toBe(120);
    expect(niceCeil(93)).toBeLessThan(200);
  });

  test("lands on familiar steps within each decade", () => {
    expect(niceCeil(4)).toBe(5);
    expect(niceCeil(12)).toBe(15);
    expect(niceCeil(14.4)).toBe(20); // 30-day window's typical commit peak
    expect(niceCeil(60)).toBe(80);
    expect(niceCeil(72)).toBe(100);
    expect(niceCeil(400)).toBe(500);
    // Agent Spend token peaks live up here — same ladder, no decade cliff.
    expect(niceCeil(500_000_000)).toBe(600_000_000);
  });

  test("value always fits with headroom (result >= input, within one step)", () => {
    for (let v = 1; v <= 2000; v += 7) {
      const r = niceCeil(v);
      expect(r).toBeGreaterThanOrEqual(v);
      // Never more than ~2.5× the input (old ladder could jump 10×).
      expect(r).toBeLessThanOrEqual(v * 2.5 + 2);
    }
  });

  test("non-positive and non-finite input returns 0 (callers floor)", () => {
    expect(niceCeil(0)).toBe(0);
    expect(niceCeil(-5)).toBe(0);
    expect(niceCeil(Number.NaN)).toBe(0);
    expect(niceCeil(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
