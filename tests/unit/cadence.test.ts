/**
 * Tests for per-source refresh cadence (issue #361).
 *
 * Semantics under test:
 *  - isCollectorDue(): fast sources always due; github gated on
 *    orchestrator.githubIntervalSeconds since its last successful capture;
 *  - poller pass skips not-yet-due sources (they're absent from results);
 *  - manual pass forces every source regardless of cadence;
 *  - a failed github pass does NOT advance the schedule (next tick retries).
 */
import { describe, expect, test } from "bun:test";
import { openMemoryDatabase } from "../../src/db/client";
import { runRefresh, isCollectorDue, type RefreshContext } from "../../src/orchestrator/refresh";
import { RefreshLock } from "../../src/orchestrator/lock";
import { getLatestState, setLatestState } from "../../src/db/latest-state";
import type { Collector, CollectorResult, SourceData } from "../../src/shared/types";
import { emptySourceData } from "../../src/shared/types";
import type { RuntimeConfig } from "../../src/config/types";

const baseConfig: RuntimeConfig = {
  dev: false,
  environment: "production",
  host: "0.0.0.0",
  port: 8999,
  db: { dir: "/tmp", file: "metrics.db", path: "/tmp/metrics.db" },
  auth: { username: "signal-house", password: "", enabled: false },
  github: { token: null, owner: null, repo: null },
  git: { repos: [], roots: [], globs: ["*"], maxDepth: 3, excludes: [] },
  hermes: { dbPath: "/tmp/hermes.db", profilesDir: null },
  opencode: { dbPath: "/tmp/opencode.db" },
  usage: { periodDays: 30 },
  poller: { enabled: false, intervalSeconds: 120, startupDelaySeconds: 5, runOnStartup: false },
  orchestrator: { concurrency: 3, lookbackDays: 28, githubIntervalSeconds: 600 },
  staleness: { staleThresholdDays: 14, staleThresholdMinutes: 15 },
  retention: { snapshotsDays: 30, dailyMetricsDays: 90 },
  privacy: { showPrivateRepoItems: false },
  refresh: { lockStaleMs: 600_000 },
  estimateCosts: false,
  hostMetrics: { enabled: false },
};

function stubCollector(id: string, opts: { ok?: boolean } = {}): Collector {
  return {
    id: id as Collector["id"],
    tier: "core",
    title: id,
    async collect(_signal): Promise<CollectorResult<SourceData>> {
      const ok = opts.ok !== false;
      return {
        source: id as Collector["id"],
        ok,
        data: ok ? emptySourceData() : null,
        durationMs: 1,
        warnings: [],
        errors: ok ? [] : [{ message: "boom", code: "test", retryable: true }],
        unavailable: false,
      };
    },
  };
}

function ctx(owner: ReturnType<typeof openMemoryDatabase>, collectors: Collector[]): RefreshContext {
  return { owner, config: baseConfig, collectors, lock: new RefreshLock(owner.db, 600_000) };
}

describe("isCollectorDue", () => {
  const now = 1_800_000_000_000;

  test("non-github sources are always due", () => {
    expect(isCollectorDue("git", now - 1000, now, baseConfig)).toBe(true);
    expect(isCollectorDue("hermes", now, now, baseConfig)).toBe(true);
    expect(isCollectorDue("opencode", now, now, baseConfig)).toBe(true);
  });

  test("github with no prior success is due", () => {
    expect(isCollectorDue("github", null, now, baseConfig)).toBe(true);
  });

  test("github not due inside the interval, due after it", () => {
    // 600s interval → due again at lastOk + 600_000ms.
    expect(isCollectorDue("github", now - 599_999, now, baseConfig)).toBe(false);
    expect(isCollectorDue("github", now - 600_000, now, baseConfig)).toBe(true);
    expect(isCollectorDue("github", now - 3_600_000, now, baseConfig)).toBe(true);
  });
});

describe("per-source cadence in the refresh runner", () => {
  test("poller pass skips a not-due github and still collects fast sources", async () => {
    const owner = openMemoryDatabase();
    // Seed a fresh github success 60s ago — well inside the 600s interval.
    setLatestState(owner.db, "github", { ok: true, data: emptySourceData() }, Date.now() - 60_000);

    let githubCalls = 0;
    const inner = stubCollector("github");
    const github: Collector = {
      id: "github",
      tier: "core",
      title: "github",
      async collect(signal): Promise<CollectorResult<SourceData>> {
        githubCalls += 1;
        return inner.collect(signal);
      },
    };
    const hermes = stubCollector("hermes");

    const out = await runRefresh(ctx(owner, [hermes, github]), "poller");
    expect(out.status).toBe("success");
    expect(githubCalls).toBe(0); // skipped by cadence
    expect(out.skipped).toEqual(["github"]);
    expect(out.results.map((r) => r.source)).toEqual(["hermes"]);
  });

  test("manual pass forces github even when not due", async () => {
    const owner = openMemoryDatabase();
    setLatestState(owner.db, "github", { ok: true, data: emptySourceData() }, Date.now() - 60_000);

    const github = stubCollector("github");
    const hermes = stubCollector("hermes");

    const out = await runRefresh(ctx(owner, [hermes, github]), "manual");
    expect(out.status).toBe("success");
    expect(out.skipped).toEqual([]);
    expect(out.results.map((r) => r.source).sort()).toEqual(["github", "hermes"]);
  });

  test("a FAILED github pass does not advance the schedule — next poller tick retries", async () => {
    const owner = openMemoryDatabase();

    const failing = stubCollector("github", { ok: false });
    await runRefresh(ctx(owner, [stubCollector("hermes"), failing]), "poller");

    // The failed pass persisted nothing for github.
    expect(getLatestState(owner.db, "github")).toBeNull();

    // Next poller pass: github must be attempted AGAIN (still never-succeeded),
    // this time succeeding.
    const succeeding = stubCollector("github", { ok: true });
    const out2 = await runRefresh(ctx(owner, [stubCollector("hermes"), succeeding]), "poller");
    expect(out2.skipped).toEqual([]);
    expect(getLatestState(owner.db, "github")).not.toBeNull();

    // And only NOW does the cadence gate engage: an immediate third poller
    // pass skips github.
    const out3 = await runRefresh(ctx(owner, [stubCollector("hermes"), succeeding]), "poller");
    expect(out3.skipped).toEqual(["github"]);
  });

  test("first-run backfill still collects everything (no prior successes)", async () => {
    const owner = openMemoryDatabase(); // fresh DB
    const github = stubCollector("github");
    const git = stubCollector("git");
    const hermes = stubCollector("hermes");

    const out = await runRefresh(ctx(owner, [git, hermes, github]), "poller");
    expect(out.status).toBe("success");
    expect(out.skipped).toEqual([]);
    expect(out.results.length).toBe(3);
  });
});
