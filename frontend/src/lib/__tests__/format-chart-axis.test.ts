import { describe, expect, it } from "@jest/globals";
import { formatCompactNumber, formatNumber } from "../../../../utils/format";

describe("formatCompactNumber for chart axis labels", () => {
  it('returns "—" for null and undefined', () => {
    expect(formatCompactNumber(null)).toBe("—");
    expect(formatCompactNumber(undefined)).toBe("—");
  });

  it("returns raw integers for small numbers (<1000)", () => {
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(1)).toBe("1");
    expect(formatCompactNumber(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatCompactNumber(1000)).toBe("1K");
    expect(formatCompactNumber(1500)).toBe("1.5K");
    expect(formatCompactNumber(9999)).toBe("10K");
  });

  it("formats millions with M suffix", () => {
    expect(formatCompactNumber(1_000_000)).toBe("1M");
    expect(formatCompactNumber(10_500_000)).toBe("11M");
    expect(formatCompactNumber(12_345_678)).toBe("12M");
  });

  it("handles negative numbers", () => {
    expect(formatCompactNumber(-1000)).toBe("-1K");
    expect(formatCompactNumber(-1_000_000)).toBe("-1M");
  });
});

describe("formatNumber for dashboard values", () => {
  it('returns "—" for null, undefined, and non-finite values', () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats large values with thousand separators by default", () => {
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(150_000_000)).toBe("150,000,000");
    expect(formatNumber(-2_500_000)).toBe("-2,500,000");
  });

  it("supports compact notation as an opt-in", () => {
    expect(formatNumber(1234, { compact: true })).toBe("1.2K");
    expect(formatNumber(150_000_000, { compact: true })).toBe("150M");
  });
});
