import { formatCycleTime } from "@/lib/format-cycle-time";

describe("formatCycleTime", () => {
  it('returns "< 1m" for 0', () => {
    expect(formatCycleTime(0)).toBe("< 1m");
  });

  it("returns empty string for null", () => {
    expect(formatCycleTime(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatCycleTime(undefined)).toBe("");
  });

  it('returns "< 1m" for negative value', () => {
    expect(formatCycleTime(-100)).toBe("< 1m");
  });

  it('returns "1m" for 83', () => {
    expect(formatCycleTime(83)).toBe("1m");
  });

  it('returns "2m" for 118', () => {
    expect(formatCycleTime(118)).toBe("2m");
  });

  it('returns "6m" for 352', () => {
    expect(formatCycleTime(352)).toBe("6m");
  });

  it('returns "1h" for 3600', () => {
    expect(formatCycleTime(3600)).toBe("1h");
  });

  it('returns "12h" for 43200', () => {
    expect(formatCycleTime(43200)).toBe("12h");
  });

  it('returns "1d" for 86400', () => {
    expect(formatCycleTime(86400)).toBe("1d");
  });

  it('returns "1w" for 604800', () => {
    expect(formatCycleTime(604800)).toBe("1w");
  });

  it('returns "1w 3d" for 864000', () => {
    expect(formatCycleTime(864000)).toBe("1w 3d");
  });
});
