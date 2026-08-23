/**
 * Tests for the host-metrics fetcher: archive discovery, accumulating
 * cache behaviour, immutability of past days, hourly freshness gate,
 * atomic-write failure survival, and diagnostics honesty. All time and
 * I/O is injected — no real PCP, no real $HOME.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverArchiveDays,
  ensureHostMetricsFresh,
  getHostMetricsPoints,
  getHostMetricsStatus,
  setHostMetricsEnvironmentForTesting,
  setHostMetricsRunnerForTesting,
  setHostMetricsIOForTesting,
  resetHostMetricsForTesting,
} from "../../src/server/host-metrics-fetcher";

const FIXTURE_STDOUT = `mem.util.available  9375155.083 Kbyte
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

let workDir: string;
let archiveDir: string;
let cacheFile: string;

function ts(day: string, hour = 10, minute = 15): Date {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
}

/** Fake runner that records invocations and always answers with fixture data. */
function makeRecordingRunner(failFor: string[] = []) {
  const calls: string[] = [];
  const runner = async (archive: string) => {
    calls.push(archive);
    if (failFor.some((frag) => archive.includes(frag))) {
      return { ok: false, stdout: "pmlogsummary: No such file or directory\n" };
    }
    return { ok: true, stdout: FIXTURE_STDOUT };
  };
  return { calls, runner };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "sh-host-metrics-"));
  archiveDir = join(workDir, "archives");
  cacheFile = join(workDir, "cache", "host-metrics.json");
  mkdirSync(archiveDir, { recursive: true });
  setHostMetricsEnvironmentForTesting(archiveDir, cacheFile);
});

afterEach(() => {
  resetHostMetricsForTesting();
  setHostMetricsIOForTesting(undefined);
  rmSync(workDir, { recursive: true, force: true });
});

describe("discoverArchiveDays", () => {
  test("finds one archive per day, keyed off .index sidecars", () => {
    for (const f of [
      "20260821.0.zst",
      "20260821.meta.xz",
      "20260821.index",
      "20260822.0.zst",
      "20260822.index",
      "20260823.00.10.index",
      "Latest",
      "pmlogger.log",
    ]) {
      writeFileSync(join(archiveDir, f), "x");
    }
    const days = discoverArchiveDays(archiveDir);
    expect([...days.keys()].sort()).toEqual(["2026-08-21", "2026-08-22", "2026-08-23"]);
    expect(days.get("2026-08-23")).toBe(join(archiveDir, "20260823.00.10"));
  });

  test("keeps the latest archive when a day has several (restarts)", () => {
    writeFileSync(join(archiveDir, "20260823.00.05.index"), "x");
    writeFileSync(join(archiveDir, "20260823.00.10.index"), "x");
    const days = discoverArchiveDays(archiveDir);
    expect(days.size).toBe(1);
    expect(days.get("2026-08-23")).toBe(join(archiveDir, "20260823.00.10"));
  });

  test("missing directory yields an empty map (never throws)", () => {
    expect(discoverArchiveDays(join(workDir, "nope")).size).toBe(0);
  });
});

describe("ensureHostMetricsFresh", () => {
  test("summarizes each archived day once and writes the cache atomically", async () => {
    writeFileSync(join(archiveDir, "20260822.index"), "x");
    writeFileSync(join(archiveDir, "20260823.index"), "x");
    const { calls, runner } = makeRecordingRunner();
    setHostMetricsRunnerForTesting(runner);

    await ensureHostMetricsFresh(ts("2026-08-23"));

    // Two archives, two spawns.
    expect(calls.length).toBe(2);

    // Cache file exists with the accumulated days.
    const cached = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(Object.keys(cached.days).sort()).toEqual(["2026-08-22", "2026-08-23"]);

    // Dense window across both days plus a missing leading day (nulls).
    const points = getHostMetricsPoints("2026-08-21", "2026-08-23");
    expect(points.map((p) => p.date)).toEqual(["2026-08-21", "2026-08-22", "2026-08-23"]);
    expect(points[0].memPct).toBeNull();
    expect(points[1].memPct).not.toBeNull();
    expect(points[2].cpuPct).not.toBeNull();

    const status = getHostMetricsStatus();
    expect(status.lastFetchStatus).toBe("ok");
    expect(status.dayCount).toBe(2);
    expect(status.archiveCount).toBe(2);
  });

  test("same-hour re-evaluation is a no-op; past days are immutable afterwards", async () => {
    writeFileSync(join(archiveDir, "20260822.index"), "x");
    writeFileSync(join(archiveDir, "20260823.index"), "x");
    const { calls, runner } = makeRecordingRunner();
    setHostMetricsRunnerForTesting(runner);

    await ensureHostMetricsFresh(ts("2026-08-23", 10));
    expect(calls.length).toBe(2);

    // Same wall-clock hour: gate short-circuits, zero spawns.
    await ensureHostMetricsFresh(ts("2026-08-23", 10, 55));
    expect(calls.length).toBe(2);

    // Two hours later: only TODAY is recomputed; yesterday stays frozen.
    await ensureHostMetricsFresh(ts("2026-08-23", 12));
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.includes("20260823")) || calls.filter((c) => c.includes("20260822")).length === 1).toBe(
      true,
    );
  });

  test("warm disk cache means past days never respawn in a fresh process", async () => {
    writeFileSync(join(archiveDir, "20260822.index"), "x");
    const first = makeRecordingRunner();
    setHostMetricsRunnerForTesting(first.runner);
    await ensureHostMetricsFresh(ts("2026-08-22"));
    expect(first.calls.length).toBe(1);

    // Simulate a process restart: full state reset, same cache path.
    resetHostMetricsForTesting();
    setHostMetricsEnvironmentForTesting(archiveDir, cacheFile);
    const second = makeRecordingRunner();
    setHostMetricsRunnerForTesting(second.runner);

    // Evaluate on a LATER day: 2026-08-22 is now immutable history, already
    // on disk, so nothing spawns. (Evaluating on its own day would respawn
    // it by design — today's row stays provisional until midnight UTC.)
    await ensureHostMetricsFresh(ts("2026-08-23", 11));
    expect(second.calls.length).toBe(0);
    expect(getHostMetricsPoints("2026-08-22", "2026-08-22")[0].memPct).not.toBeNull();
  });

  test("all-spawns-fail: cold cache reports failed, warm cache reports stale", async () => {
    writeFileSync(join(archiveDir, "20260822.index"), "x");
    const failing = makeRecordingRunner(["20260822"]);
    setHostMetricsRunnerForTesting(failing.runner);

    await ensureHostMetricsFresh(ts("2026-08-22"));
    let status = getHostMetricsStatus();
    expect(status.lastFetchStatus).toBe("failed");
    expect(status.dayCount).toBe(0);

    // A good pass warms the cache…
    setHostMetricsRunnerForTesting(makeRecordingRunner().runner);
    await ensureHostMetricsFresh(ts("2026-08-22", 11));
    status = getHostMetricsStatus();
    expect(status.lastFetchStatus).toBe("ok");

    // …then breakage again, next hour: stale, not ok, data still served.
    setHostMetricsRunnerForTesting(makeRecordingRunner(["20260822"]).runner);
    await ensureHostMetricsFresh(ts("2026-08-22", 12));
    status = getHostMetricsStatus();
    expect(status.lastFetchStatus).toBe("stale");
    expect(getHostMetricsPoints("2026-08-22", "2026-08-22")[0].memPct).not.toBeNull();
  });

  test("atomic-write failure preserves the previous-good cache file", async () => {
    writeFileSync(join(archiveDir, "20260822.index"), "x");
    setHostMetricsRunnerForTesting(makeRecordingRunner().runner);
    await ensureHostMetricsFresh(ts("2026-08-22"));
    const good = readFileSync(cacheFile, "utf-8");

    // Next hour, new data computed fine but the disk write explodes.
    setHostMetricsIOForTesting({
      write: async () => {
        throw new Error("disk on fire");
      },
      rename: async () => {},
    });
    writeFileSync(join(archiveDir, "20260823.index"), "x");
    await ensureHostMetricsFresh(ts("2026-08-23", 12));

    // Previous-good file untouched; in-memory still serves both days.
    expect(readFileSync(cacheFile, "utf-8")).toBe(good);
    expect(getHostMetricsPoints("2026-08-22", "2026-08-23").map((p) => p.memPct)).toEqual([
      expect.anything(),
      expect.anything(),
    ]);
  });

  test("prunes rows beyond retention", async () => {
    // Seed a cache with a 200-day-old row.
    mkdirSync(join(workDir, "cache"), { recursive: true });
    const old = {
      fetchedAt: ts("2026-02-01").toISOString(),
      days: { "2026-02-01": { memPct: 50, swapPct: 10, cpuPct: 5 } },
    };
    writeFileSync(cacheFile, JSON.stringify(old));

    writeFileSync(join(archiveDir, "20260822.index"), "x");
    setHostMetricsRunnerForTesting(makeRecordingRunner().runner);
    await ensureHostMetricsFresh(ts("2026-08-22"));

    const cached = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(cached.days["2026-02-01"]).toBeUndefined();
    expect(cached.days["2026-08-22"]).toBeDefined();
  });

  test("no archives at all: empty status, all-null points, no crash", async () => {
    const { runner } = makeRecordingRunner();
    setHostMetricsRunnerForTesting(runner);
    await ensureHostMetricsFresh(ts("2026-08-23"));
    const status = getHostMetricsStatus();
    expect(status.archiveCount).toBe(0);
    expect(getHostMetricsPoints("2026-08-20", "2026-08-23").every((p) => p.memPct === null)).toBe(true);
  });
});
