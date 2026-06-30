import { describe, expect, it } from "@jest/globals";
import { formatCompactNumber } from "../../../../utils/format";

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
