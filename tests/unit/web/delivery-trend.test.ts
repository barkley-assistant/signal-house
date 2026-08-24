/**
 * Regression tests for the Host-resources tooltip formatter (issue #363).
 *
 * The formatter must never throw on ECharts param payloads where a series'
 * value is `undefined` (ECharts does not preserve the source `number | null`
 * typing through its event layer for all-null days). Previously a strict
 * `!== null` filter let `undefined` survive and `.toFixed()` detonated with
 * `TypeError: Cannot read properties of undefined (reading 'toFixed')`, which
 * aborted the tooltip render entirely.
 */
import { describe, expect, test } from "bun:test";
import { formatResourceTooltip } from "../../../src/web/components/DeliveryTrend";
import type { ResourcePoint } from "../../../src/web/state/store";

type ResourceTooltipParam = {
  axisValue: string;
  seriesName: string;
  value: number | null | undefined;
  marker: string;
};

const NO_DATA_DAY: ResourcePoint = { date: "2026-05-01", memPct: null, swapPct: null, cpuPct: null };
const MIXED_DAY: ResourcePoint = { date: "2026-08-10", memPct: 42.5, swapPct: null, cpuPct: 12.3 };
const FULL_DAY: ResourcePoint = { date: "2026-08-12", memPct: 55.0, swapPct: 10.0, cpuPct: 30.0 };

describe("formatResourceTooltip (issue #363)", () => {
  test("returns the 'No data' treatment and does not throw for all-undefined values", () => {
    const params: ResourceTooltipParam[] = [
      { axisValue: "2026-05-01", seriesName: "CPU", value: undefined, marker: "●" },
      { axisValue: "2026-05-01", seriesName: "Memory", value: undefined, marker: "●" },
      { axisValue: "2026-05-01", seriesName: "Swap", value: undefined, marker: "●" },
    ];
    const out = formatResourceTooltip(params, [NO_DATA_DAY]);
    expect(out).toContain("No data");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");
  });

  test("renders percentages for present series and lists missing ones in the footer", () => {
    const params: ResourceTooltipParam[] = [
      { axisValue: "2026-08-10", seriesName: "CPU", value: 12.3, marker: "●" },
      { axisValue: "2026-08-10", seriesName: "Memory", value: 42.5, marker: "●" },
      { axisValue: "2026-08-10", seriesName: "Swap", value: undefined, marker: "●" },
    ];
    const out = formatResourceTooltip(params, [MIXED_DAY]);
    expect(out).toContain("CPU:");
    expect(out).toContain("12.3%");
    expect(out).toContain("Memory:");
    expect(out).toContain("42.5%");
    expect(out).toContain("Swap: no data");
    expect(out).not.toContain("undefined");
  });

  test("renders all three series when every value is a finite number", () => {
    const params: ResourceTooltipParam[] = [
      { axisValue: "2026-08-12", seriesName: "CPU", value: 30.0, marker: "●" },
      { axisValue: "2026-08-12", seriesName: "Memory", value: 55.0, marker: "●" },
      { axisValue: "2026-08-12", seriesName: "Swap", value: 10.0, marker: "●" },
    ];
    const out = formatResourceTooltip(params, [FULL_DAY]);
    expect(out).toContain("30.0%");
    expect(out).toContain("55.0%");
    expect(out).toContain("10.0%");
    expect(out).not.toContain("no data");
  });

  test("returns an empty string for an empty param array", () => {
    expect(formatResourceTooltip([], [FULL_DAY])).toBe("");
  });

  test("treats null values as missing (mirrors the legacy non-null handling)", () => {
    const params: ResourceTooltipParam[] = [
      { axisValue: "2026-08-10", seriesName: "CPU", value: 12.3, marker: "●" },
      { axisValue: "2026-08-10", seriesName: "Memory", value: null, marker: "●" },
      { axisValue: "2026-08-10", seriesName: "Swap", value: null, marker: "●" },
    ];
    const out = formatResourceTooltip(params, [MIXED_DAY]);
    expect(out).toContain("CPU:");
    expect(out).toContain("Memory · Swap: no data");
  });
});
