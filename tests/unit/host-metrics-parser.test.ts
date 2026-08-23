/**
 * Unit tests for the pmlogsummary stdout parser and percentage derivation.
 *
 * The LIVE_FIXTURE below is verbatim pmlogsummary output from this host
 * (2026-08-23 archive), including the two real swap devices and the exact
 * per-metric units. Expected percentages are hand-computed from those raw
 * numbers so the math in hostResourcePercentages() is checked against an
 * independent derivation, not against itself.
 */
import { describe, expect, test } from "bun:test";
import {
  parseHostMetricsSummary,
  hostResourcePercentages,
  HOST_METRIC_NAMES,
} from "../../src/server/host-metrics-parser";

const LIVE_FIXTURE = `mem.util.used  10698734.082 Kbyte
mem.util.free  5009509.918 Kbyte
mem.util.cached  6237979.560 Kbyte
mem.util.available  9375155.083 Kbyte
mem.physmem  15708244.000 Kbyte
swap.used  3840628356.992 byte
swapdev.length ["/swap.img"] 16777212.000 Kbyte
swapdev.length ["/dev/zram0"] 8388604.000 Kbyte
kernel.all.cpu.user  0.138 none
kernel.all.cpu.sys  0.049 none
kernel.all.cpu.idle  3.781 none
kernel.all.cpu.nice  0.000 none
kernel.all.cpu.irq.soft  0.001 none
kernel.all.cpu.irq.hard  0.000 none
kernel.all.cpu.steal  0.000 none`;

describe("parseHostMetricsSummary", () => {
  test("parses singular metrics with their native units", () => {
    const p = parseHostMetricsSummary(LIVE_FIXTURE);
    expect(p.scalars.get("mem.util.available")).toEqual({ value: 9375155.083, unit: "Kbyte" });
    expect(p.scalars.get("mem.physmem")).toEqual({ value: 15708244, unit: "Kbyte" });
    // swap.used really is reported in plain bytes on this host.
    expect(p.scalars.get("swap.used")).toEqual({ value: 3840628356.992, unit: "byte" });
    expect(p.scalars.get("kernel.all.cpu.idle")).toEqual({ value: 3.781, unit: "none" });
  });

  test("parses every instance of an instanced metric", () => {
    const p = parseHostMetricsSummary(LIVE_FIXTURE);
    const lengths = p.instances.get("swapdev.length");
    expect(lengths?.get("/swap.img")).toEqual({ value: 16777212, unit: "Kbyte" });
    expect(lengths?.get("/dev/zram0")).toEqual({ value: 8388604, unit: "Kbyte" });
    // Instanced metrics must not leak into the scalar map.
    expect(p.scalars.has("swapdev.length")).toBe(false);
  });

  test("captures unparseable lines, capped", () => {
    const garbage = Array.from({ length: 9 }, (_, i) => `??? line ${i} ???`).join("\n");
    const p = parseHostMetricsSummary(garbage);
    expect(p.unparsedLines.length).toBe(5);
    expect(p.scalars.size).toBe(0);
  });

  test("empty input yields empty maps", () => {
    const p = parseHostMetricsSummary("");
    expect(p.scalars.size).toBe(0);
    expect(p.instances.size).toBe(0);
    expect(p.unparsedLines.length).toBe(0);
  });
});

describe("hostResourcePercentages", () => {
  test("derives all three percentages from the live fixture", () => {
    const pct = hostResourcePercentages(parseHostMetricsSummary(LIVE_FIXTURE));
    // Hand-computed: 9375155.083 / 15708244.000 × 100
    expect(pct.memPct).toBeCloseTo(59.69, 1);
    // Hand-computed: 3840628356.992 bytes over (16777212 + 8388604) KiB
    //   = 3840628356.992 / 25769795584 × 100 — both devices summed,
    //     Kbyte→byte normalization applied.
    expect(pct.swapPct).toBeCloseTo(14.9, 1);
    // Hand-computed: (1 − 3.781 / (0.138+0.049+3.781+0.001)) × 100
    expect(pct.cpuPct).toBeCloseTo(4.74, 1);
  });

  test("null when a percentage's ingredients are absent", () => {
    // No mem.util.available line (older PCP kernels don't emit it).
    const noAvailable = LIVE_FIXTURE
      .split("\n")
      .filter((l) => !l.startsWith("mem.util.available"))
      .join("\n");
    const pct = hostResourcePercentages(parseHostMetricsSummary(noAvailable));
    expect(pct.memPct).toBeNull();
    expect(pct.swapPct).not.toBeNull();
    expect(pct.cpuPct).not.toBeNull();
  });

  test("null swap when no swap devices appear", () => {
    const noSwapDev = LIVE_FIXTURE
      .split("\n")
      .filter((l) => !l.startsWith("swapdev.length"))
      .join("\n");
    const pct = hostResourcePercentages(parseHostMetricsSummary(noSwapDev));
    expect(pct.memPct).not.toBeNull();
    expect(pct.swapPct).toBeNull();
  });

  test("null cpu when idle counter is absent", () => {
    const noIdle = LIVE_FIXTURE
      .split("\n")
      .filter((l) => !l.startsWith("kernel.all.cpu.idle"))
      .join("\n");
    const pct = hostResourcePercentages(parseHostMetricsSummary(noIdle));
    expect(pct.cpuPct).toBeNull();
  });

  test("includes iowait when a kernel exposes it", () => {
    const withIowait = LIVE_FIXTURE.replace(
      "kernel.all.cpu.user  0.138 none",
      "kernel.all.cpu.user  0.138 none\nkernel.all.cpu.iowait  0.500 none",
    );
    const pct = hostResourcePercentages(parseHostMetricsSummary(withIowait));
    // (1 − 3.781 / (0.138+0.049+3.781+0.001+0.500)) × 100
    expect(pct.cpuPct).toBeCloseTo(15.39, 1);
  });

  test("clamps into 0–100 instead of trusting weird counters", () => {
    const saturated = `mem.util.available  999999999999 Kbyte
mem.physmem  15708244.000 Kbyte
swap.used  999999999999 byte
swapdev.length ["only"] 8388604.000 Kbyte
kernel.all.cpu.idle  -5.000 none
kernel.all.cpu.user  10.000 none`;
    const pct = hostResourcePercentages(parseHostMetricsSummary(saturated));
    expect(pct.memPct).toBe(100);
    expect(pct.swapPct).toBe(100);
    expect(pct.cpuPct).toBe(100);
  });
});

describe("HOST_METRIC_NAMES", () => {
  test("covers every metric the parser consumes", () => {
    const needed = new Set([
      "mem.util.available",
      "mem.physmem",
      "swap.used",
      "swapdev.length",
      ...["user", "sys", "idle", "nice", "iowait", "irq.soft", "irq.hard", "steal"].map(
        (s) => `kernel.all.cpu.${s}`,
      ),
    ]);
    for (const name of needed) {
      expect(HOST_METRIC_NAMES).toContain(name);
    }
    expect(HOST_METRIC_NAMES.length).toBe(needed.size);
  });
});
