import { describe, expect, test } from "bun:test";
import { openMemoryDatabase } from "../../src/db/client";
import { runRefresh, type RefreshContext } from "../../src/orchestrator/refresh";
import { RefreshLock } from "../../src/orchestrator/lock";
import { getLatestState } from "../../src/db/latest-state";
import { getRefreshMeta, setRefreshMeta } from "../../src/db/refresh-meta";
import { queryDailyMetrics } from "../../src/db/daily-metrics";
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
  poller: { enabled: false, intervalSeconds: 300, startupDelaySeconds: 5, runOnStartup: true },
  orchestrator: { concurrency: 3, lookbackDays: 28, githubIntervalSeconds: 600 },
  staleness: { staleThresholdDays: 14, staleThresholdMinutes: 15 },
  retention: { snapshotsDays: 30, dailyMetricsDays: 90 },
  privacy: { showPrivateRepoItems: false },
  refresh: { lockStaleMs: 600_000 },
    estimateCosts: false,
    hostMetrics: { enabled: false },
};

function stubCollector(id: string, opts: { ok?: boolean; data?: Partial<SourceData>; unavailable?: boolean; errors?: CollectorResult["errors"] } = {}): Collector {
  const data = emptySourceData();
  Object.assign(data, opts.data ?? {});
  return {
    id: id as Collector["id"],
    tier: "core",
    title: id,
    async collect(): Promise<CollectorResult<SourceData>> {
      if (opts.unavailable) {
        return { source: id as Collector["id"], ok: true, data: null, durationMs: 1, warnings: ["unavailable"], errors: [], unavailable: true };
      }
      if (opts.ok === false) {
        return { source: id as Collector["id"], ok: false, data: null, durationMs: 1, warnings: [], errors: opts.errors ?? [{ message: "boom", code: "test", retryable: true }], unavailable: false };
      }
      return { source: id as Collector["id"], ok: true, data, durationMs: 1, warnings: [], errors: [], unavailable: false };
    },
  };
}

function ctx(owner: ReturnType<typeof openMemoryDatabase>, collectors: Collector[]): RefreshContext {
  return {
    owner,
    config: baseConfig,
    collectors,
    lock: new RefreshLock(owner.db, 600_000),
  };
}

describe("refresh runner", () => {
  test("successful refresh persists latest_state, snapshots, daily metrics, metadata", async () => {
    const owner = openMemoryDatabase();
    const hermes = stubCollector("hermes", {
      data: {
        usage: {
          source: "hermes",
          periodDays: 30,
          byDay: [
            { date: "2026-07-31", sessions: 5, messages: 100, tokensInput: 1000, tokensOutput: 100, tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 2.5 },
          ],
          byModel: [{ model: "m1", provider: "p1", sessions: 5, messages: 100, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 2.5 }],
        },
      },
    });
    const out = await runRefresh(ctx(owner, [hermes]), "manual");
    expect(out.status).toBe("success");
    const state = getLatestState(owner.db, "hermes");
    expect(state).not.toBeNull();
    const rows = queryDailyMetrics(owner.db, { from: "2026-07-31", to: "2026-07-31" });
    expect(rows.length).toBeGreaterThan(0);
    expect(getRefreshMeta(owner.db, "last_success_at")).not.toBeNull();
    owner.close();
  });

  test("per-day model breakdowns reach daily_metrics but are stripped from snapshots", async () => {
    const owner = openMemoryDatabase();
    const hermes = stubCollector("hermes", {
      data: {
        usage: {
          source: "hermes",
          periodDays: 30,
          byDay: [
            {
              date: "2026-07-31", sessions: 5, messages: 100, tokensInput: 1000, tokensOutput: 100,
              tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 2.5,
              byModel: [{ model: "DeepSeek-V4-Pro", provider: "custom", sessions: 5, messages: null, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 2.5 }],
            },
          ],
          byModel: [{ model: "DeepSeek-V4-Pro", provider: "custom", sessions: 5, messages: 100, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 2.5 }],
        },
      },
    });
    const out = await runRefresh(ctx(owner, [hermes]), "manual");
    expect(out.status).toBe("success");

    // daily_metrics carries the per-day per-model history (tags = model name).
    const modelRows = queryDailyMetrics(owner.db, { from: "2026-07-31", to: "2026-07-31", metric: "model.sessions" });
    expect(modelRows.length).toBe(1);
    expect(modelRows[0].tags.model).toBe("DeepSeek-V4-Pro");
    expect(modelRows[0].value).toBe(5);

    // The snapshot is stripped: no byModel inside byDay (keeps blobs lean).
    const state = getLatestState(owner.db, "hermes");
    const parsed = JSON.parse(state!.data) as { data: { usage: { byDay: Array<Record<string, unknown>> } } };
    expect(parsed.data.usage.byDay[0]).not.toHaveProperty("byModel");
    owner.close();
  });

  test("a successful refresh clears prior failure metadata", async () => {
    const owner = openMemoryDatabase();
    // Prime a failure record (as if a previous refresh had failed)
    setRefreshMeta(owner.db, "last_failure_at", "2026-07-31T10:00:00Z", 1);
    setRefreshMeta(owner.db, "last_failure_message", "boom", 1);

    const good = stubCollector("hermes", {
      data: {
        usage: {
          source: "hermes",
          periodDays: 30,
          byDay: [{ date: "2026-07-31", sessions: 1, messages: 1, tokensInput: 1, tokensOutput: 1, tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 0.1 }],
          byModel: [],
        },
      },
    });
    const out = await runRefresh(ctx(owner, [good]), "manual");
    expect(out.status).toBe("success");
    expect(getRefreshMeta(owner.db, "last_failure_at")).toBeNull();
    expect(getRefreshMeta(owner.db, "last_failure_message")).toBeNull();
    expect(getRefreshMeta(owner.db, "last_success_at")).not.toBeNull();
    owner.close();
  });

  test("partial failure keeps last-good data and journals the failure", async () => {
    const owner = openMemoryDatabase();
    const good = stubCollector("hermes", {
      data: {
        usage: {
          source: "hermes",
          periodDays: 30,
          byDay: [{ date: "2026-07-31", sessions: 1, messages: 1, tokensInput: 1, tokensOutput: 1, tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 0.1 }],
          byModel: [],
        },
      },
    });
    const bad = stubCollector("github", { ok: false });
    await runRefresh(ctx(owner, [good, bad]), "manual");
    const before = getLatestState(owner.db, "github");

    // second refresh: hermes now also fails → partial, github keeps last good
    const bothBad = [stubCollector("hermes", { ok: false }), bad];
    const out2 = await runRefresh(ctx(owner, bothBad), "manual");
    expect(out2.status).toBe("failed");
    const after = getLatestState(owner.db, "github");
    expect(after).toEqual(before); // last-good preserved
    expect(getRefreshMeta(owner.db, "last_failure_at")).not.toBeNull();
    owner.close();
  });

  test("overlapping refresh is refused (single in-process guard)", async () => {
    const owner = openMemoryDatabase();
    const slow = {
      ...stubCollector("hermes", { data: { usage: null } }),
      async collect(): Promise<CollectorResult<SourceData>> {
        await new Promise((r) => setTimeout(r, 100));
        return { source: "hermes", ok: true, data: emptySourceData(), durationMs: 100, warnings: [], errors: [], unavailable: false };
      },
    };
    const context = ctx(owner, [slow]);
    const p1 = runRefresh(context, "manual");
    await new Promise((r) => setTimeout(r, 20));
    const p2 = runRefresh(context, "poller");
    const [o1, o2] = await Promise.all([p1, p2]);
    expect(o1.status).toBe("success");
    expect(o2.status).toBe("failed");
    expect(o2.results.length).toBe(0); // refused before running collectors
    owner.close();
  });

  test("complete failure never touches latest_state", async () => {
    const owner = openMemoryDatabase();
    const out = await runRefresh(ctx(owner, [stubCollector("github", { ok: false })]), "manual");
    expect(out.status).toBe("failed");
    expect(getLatestState(owner.db, "github")).toBeNull();
    owner.close();
  });

  test("reset-lock semantics: cleared lock allows the next refresh", async () => {
    const owner = openMemoryDatabase();
    const context = ctx(owner, [stubCollector("hermes", { data: { usage: null } })]);
    await runRefresh(context, "manual");
    context.lock.reset();
    const out = await runRefresh(context, "manual");
    expect(out.status).toBe("success");
    owner.close();
  });

  test("github refresh persists latest_state + daily metrics but no snapshots", async () => {
    const owner = openMemoryDatabase();
    const run = {
      id: "w1", name: "ci", status: "completed", conclusion: "success",
      createdAt: "2026-09-01T00:00:00Z", completedAt: "2026-09-01T00:01:00Z",
      headSha: "a".repeat(40), repo: "o/r", repoKey: "github:o/r",
      branch: "main", workflowName: "ci", url: "https://example.com/w1",
    };
    const github = stubCollector("github", {
      data: {
        repositories: [
          { repoKey: "github:o/r", name: "r", localPath: null, remoteUrl: null,
            githubOwner: "o", githubRepo: "r", source: "github",
            isPrivate: false, present: true, lastSeenAt: null },
        ],
        workflowRuns: [run],
      },
    });
    const out = await runRefresh(ctx(owner, [github]), "manual");
    expect(out.status).toBe("success");
    // latest_state + daily metrics still written
    expect(getLatestState(owner.db, "github")).not.toBeNull();
    expect(queryDailyMetrics(owner.db, { from: "2026-09-01", to: "2026-09-01" }).length).toBeGreaterThan(0);
    // …but no snapshot row for github
    const n = (owner.db.query("SELECT COUNT(*) AS n FROM snapshots WHERE source='github'").get() as { n: number }).n;
    expect(n).toBe(0);
    owner.close();
  });

  test("non-github sources still write snapshots", async () => {
    const owner = openMemoryDatabase();
    const hermes = stubCollector("hermes", { data: { usage: null } });
    await runRefresh(ctx(owner, [hermes]), "manual");
    const n = (owner.db.query("SELECT COUNT(*) AS n FROM snapshots WHERE source='hermes'").get() as { n: number }).n;
    expect(n).toBe(1);
    owner.close();
  });

  test("git snapshots dedupe across passes; latest_state keeps live lastSeenAt", async () => {
    const owner = openMemoryDatabase();
    // The real git collector stamps lastSeenAt per pass — simulate that,
    // otherwise the dedupe under test never gets a chance to fail.
    const git: Collector = {
      id: "git", tier: "core", title: "git",
      async collect() {
        const data = emptySourceData();
        data.localGit.push({
          repoKey: "github:o/r", path: "/tmp/r", repoName: "r", remoteUrl: null,
          githubOwner: "o", githubRepo: "r", defaultBranch: "main", isGitRepo: true,
          recentCommits: 1, authors: ["a"], latestCommitAt: "2026-09-01T00:00:00Z",
          error: null, present: true, lastSeenAt: new Date().toISOString(),
        });
        return { source: "git", ok: true, data, durationMs: 1, warnings: [], errors: [], unavailable: false };
      },
    };
    await runRefresh(ctx(owner, [git]), "manual");
    await runRefresh(ctx(owner, [git]), "poller");
    const n = (owner.db.query("SELECT COUNT(*) AS n FROM snapshots WHERE source='git'").get() as { n: number }).n;
    expect(n).toBe(1); // second pass deduped — volatility no longer defeats change detection
    const state = JSON.parse(getLatestState(owner.db, "git")!.data) as { data: { localGit: Array<{ lastSeenAt: string | null }> } };
    expect(state.data.localGit[0].lastSeenAt).not.toBeNull(); // diagnostics keep the live value
    owner.close();
  });
});
