/**
 * Aggregates windowing tests — the dashboard time-range filter (7/30/90 days)
 * is implemented server-side in computeAggregates. These pin the windowing
 * contract: usage totals slice byDay, byModel picks the precomputed per-window
 * breakdown (falling back to the period aggregate), cycle time counts only
 * PRs merged inside the window, and throughput/CI are window-filtered.
 */

import { describe, expect, test } from "bun:test";
import type { PersistedState } from "../../src/config/types";
import type { RuntimeConfig } from "../../src/config/types";
import type { SourceData } from "../../src/shared/types";
import { computeAggregates, mergeModelRows, type UsageAggregate } from "../../src/orchestrator/aggregates";
import { emptySourceData } from "../../src/shared/types";
import { utcDay, utcDaysAgo } from "../../src/shared/dates";

const config: RuntimeConfig = {
  dev: false,
  environment: "production",
  host: "0.0.0.0",
  port: 8999,
  db: { dir: "/tmp", file: "metrics.db", path: "/tmp/metrics.db" },
  auth: { username: "signal-house", password: "", enabled: false },
  github: { token: null, owner: null, repo: null },
  git: { repos: [], roots: [], globs: ["*"], maxDepth: 3, excludes: [] },
  hermes: { dbPath: "/tmp/hermes.db" },
  opencode: { dbPath: "/tmp/opencode.db" },
  usage: { periodDays: 90 },
  poller: { enabled: false, intervalSeconds: 300, startupDelaySeconds: 5, runOnStartup: true },
  orchestrator: { concurrency: 3, lookbackDays: 90, githubIntervalSeconds: 600 },
  staleness: { staleThresholdDays: 14, staleThresholdMinutes: 15 },
  retention: { snapshotsDays: 30, dailyMetricsDays: 90 },
  privacy: { showPrivateRepoItems: false },
  refresh: { lockStaleMs: 600_000 },
    estimateCosts: false,
    hostMetrics: { enabled: false },
};

function state(source: string, data: SourceData): PersistedState {
  return {
    source: source as PersistedState["source"],
    ok: true,
    unavailable: false,
    capturedAt: Date.now(),
    window: { start: utcDaysAgo(90), end: utcDay() },
    data,
    warnings: [],
    errors: [],
    usage: data.usage,
  };
}

/** Usage fixture: N days of byDay ending today, each day one session worth $1. */
function usageDays(n: number): PersistedState {
  const data = emptySourceData();
  data.usage = {
    source: "hermes",
    periodDays: 90,
    byDay: Array.from({ length: n }, (_, i) => {
      const date = utcDaysAgo(n - 1 - i);
      return {
        date,
        sessions: 1,
        messages: 2,
        tokensInput: 1000,
        tokensOutput: 100,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensReasoning: 0,
        cost: 1,
      };
    }),
    byModel: [],
  };
  return state("hermes", data);
}

describe("computeAggregates windowing", () => {
  test("window reflects the requested days; default is 30", () => {
    const s = usageDays(40);
    expect(computeAggregates([s], config).window.days).toBe(30);
    expect(computeAggregates([s], config).window.start).toBe(utcDaysAgo(30));
    expect(computeAggregates([s], config, 7).window.days).toBe(7);
    expect(computeAggregates([s], config, 90).window.start).toBe(utcDaysAgo(90));
  });

  test("usage totals slice byDay to the window", () => {
    const s = usageDays(40); // $1 per day, 40 days of history
    const a7 = computeAggregates([s], config, 7);
    // Window is [today-7, today] inclusive — 8 calendar days of $1 rows.
    expect(a7.usage!.totalSessions).toBe(8);
    expect(a7.usage!.totalCost).toBeCloseTo(8, 5);

    const a90 = computeAggregates([s], config, 90);
    expect(a90.usage!.totalSessions).toBe(40);
    expect(a90.usage!.totalCost).toBeCloseTo(40, 5);
  });

  test("bySource slices to the window too", () => {
    const s = usageDays(40);
    const a7 = computeAggregates([s], config, 7);
    expect(a7.usage!.bySource.hermes.sessions).toBe(8);
    expect(a7.usage!.bySource.hermes.cost).toBeCloseTo(8, 5);
  });

  test("usageOverride (daily_metrics history) wins when provided", () => {
    const s = usageDays(40);
    const override: UsageAggregate = {
      totalSessions: 999,
      totalMessages: null,
      totalTokens: 1000,
      totalCost: 42,
      bySource: { opencode: { sessions: 999, cost: 42, tokens: 1000 } },
      byModel: [{ model: "Weekmodel", family: null, sessions: 2, cost: 2, tokens: 2 }],
    };
    const a = computeAggregates([s], config, 7, override);
    expect(a.usage!.totalSessions).toBe(999);
    expect(a.usage!.totalCost).toBeCloseTo(42, 5);
    expect(a.usage!.byModel[0].model).toBe("Weekmodel");
  });

  test("usage falls back to the snapshot when no history override is given", () => {
    const s = usageDays(40);
    const a = computeAggregates([s], config, 7, null);
    expect(a.usage!.totalSessions).toBe(8);
    expect(a.usage!.totalCost).toBeCloseTo(8, 5);
  });

  test("cycle time counts only PRs merged inside the window", () => {
    const data = emptySourceData();
    const iso = (daysAgo: number, hour = 10): string => {
      // Anchor the fixture to the current UTC day so the test stays valid
      // regardless of the calendar date the suite runs on.
      const [y, m, d] = utcDaysAgo(daysAgo).split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d, hour)).toISOString();
    };
    data.pullRequests = [
      // merged 40 days ago — inside a 90-day window, outside a 7-day one
      { id: "old", repoKey: "r", repo: "r", title: "old", state: "closed", url: "", author: "u", createdAt: iso(41), updatedAt: iso(40), mergedAt: iso(40), closedAt: iso(40), headSha: null, labels: [], additions: null, deletions: null, changedFiles: null, ciStatus: null },
      // merged yesterday — inside both windows
      { id: "new", repoKey: "r", repo: "r", title: "new", state: "closed", url: "", author: "u", createdAt: iso(2), updatedAt: iso(1), mergedAt: iso(1), closedAt: iso(1), headSha: null, labels: [], additions: null, deletions: null, changedFiles: null, ciStatus: null },
    ];
    // Aggregates apply the privacy filter (fail-closed): declare "r" public.
    data.repositories = [{ repoKey: "github:r", name: "r", localPath: null, remoteUrl: null, githubOwner: "r", githubRepo: "r", source: "github", isPrivate: false, present: true, lastSeenAt: null }];
    // ...and the PRs must reference that key to be visible.
    for (const pr of data.pullRequests) pr.repoKey = "github:r";
    const s = state("github", data);

    const a7 = computeAggregates([s], config, 7);
    expect(a7.cycleTime!.sampleSize).toBe(1);
    // 41h-2h... merged yesterday created 2 days ago → ~24h+ delta in seconds
    expect(a7.cycleTime!.medianSeconds).toBeCloseTo((Date.parse(iso(1)) - Date.parse(iso(2))) / 1000, 2);

    const a90 = computeAggregates([s], config, 90);
    expect(a90.cycleTime!.sampleSize).toBe(2);
  });

  test("throughput and CI are window-filtered", () => {
    const data = emptySourceData();
    const day = (daysAgo: number): string => utcDaysAgo(daysAgo);
    // Aggregates apply the privacy filter (fail-closed): declare "r" public.
    data.repositories = [{ repoKey: "github:r", name: "r", localPath: null, remoteUrl: null, githubOwner: "r", githubRepo: "r", source: "github", isPrivate: false, present: true, lastSeenAt: null }];
    data.issues = [
      { id: "i1", repoKey: "github:r", repo: "r", title: "recent", state: "closed", url: "", createdAt: day(2), updatedAt: day(2), closedAt: day(2), labels: [], assignee: null, milestone: null },
      { id: "i2", repoKey: "github:r", repo: "r", title: "old", state: "closed", url: "", createdAt: day(40), updatedAt: day(40), closedAt: day(40), labels: [], assignee: null, milestone: null },
    ];
    data.workflowRuns = [
      { id: "w1", name: "ci", status: "completed", conclusion: "success", createdAt: day(1), completedAt: day(1), headSha: "a", repo: "r", repoKey: "github:r", branch: "main", workflowName: "ci", url: "" },
      { id: "w2", name: "ci", status: "completed", conclusion: "failure", createdAt: day(35), completedAt: day(35), headSha: "b", repo: "r", repoKey: "github:r", branch: "main", workflowName: "ci", url: "" },
    ];
    const s = state("github", data);

    const a7 = computeAggregates([s], config, 7);
    expect(a7.throughput!.issuesClosed).toBe(1);
    expect(a7.ci!.totalRuns).toBe(1);
    expect(a7.ci!.passRate).toBeCloseTo(1, 5);

    const a90 = computeAggregates([s], config, 90);
    expect(a90.throughput!.issuesClosed).toBe(2);
    expect(a90.ci!.totalRuns).toBe(2);
    expect(a90.ci!.passRate).toBeCloseTo(0.5, 5);
  });
});

describe("mergeModelRows cache preservation", () => {
  test("preserves cacheReadTokens and source discrimination", () => {
    const rows = [
      { model: "deepseek-v4-pro", provider: null, source: "hermes", sessions: 2, messages: null, inputTokens: 700, outputTokens: 0, cacheReadTokens: 300, cacheWriteTokens: 0, reasoningTokens: 0, cost: 1 },
      { model: "DeepSeek-V4-Pro", provider: null, source: "opencode", sessions: 1, messages: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 1000, cacheWriteTokens: 0, reasoningTokens: 0, cost: 2 },
    ];
    const merged = mergeModelRows(rows, { rates: new Map(), enabled: false });
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.model).toBe("DeepSeek V4 Pro");
    expect(m.sessions).toBe(3);
    expect(m.cacheReadTokens).toBe(1300);
    // (1300 / (1300 + 700)) = 0.65
    expect(m.cacheHitRate).toBeCloseTo(1300 / 2000, 5);
    expect(Object.keys(m.bySource ?? {})).toContain("hermes");
    expect(Object.keys(m.bySource ?? {})).toContain("opencode");
    expect((m.bySource ?? {}).hermes.cacheReadTokens).toBe(300);
    expect((m.bySource ?? {}).opencode.cacheReadTokens).toBe(1000);
  });

  test("handles rows without source using provider fallback", () => {
    const rows = [
      { model: "kimi-k27-code", provider: "opencode", source: undefined, sessions: 1, messages: null, inputTokens: 100, outputTokens: 0, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 0, cost: 1 },
    ];
    const merged = mergeModelRows(rows, { rates: new Map(), enabled: false });
    expect(merged[0].cacheReadTokens).toBe(100);
    expect(Object.keys(merged[0].bySource ?? {})).toContain("opencode");
  });
});

describe("computeAggregates privacy filtering", () => {
  const OLD = new Date(Date.now() - 40 * 86_400_000).toISOString(); // 40d ago — past any threshold
  const RECENT = new Date(Date.now() - 2 * 86_400_000).toISOString();

  /** Github fixture: one public repo with a fresh open issue, one private
      repo with a stale open issue + an old workflow run. */
  function ghState(): PersistedState {
    const data = emptySourceData();
    data.repositories = [
      { repoKey: "github:acme/public", name: "public", localPath: null, remoteUrl: null, githubOwner: "acme", githubRepo: "public", source: "github", isPrivate: false, present: true, lastSeenAt: null },
      { repoKey: "github:acme/secret", name: "secret", localPath: null, remoteUrl: null, githubOwner: "acme", githubRepo: "secret", source: "github", isPrivate: true, present: true, lastSeenAt: null },
    ];
    data.issues = [
      { id: "1", title: "fresh public", state: "open", createdAt: RECENT, updatedAt: RECENT, closedAt: null, repo: "acme/public", repoKey: "github:acme/public", labels: [], assignee: null, milestone: null, url: "" },
      { id: "2", title: "stale private", state: "open", createdAt: OLD, updatedAt: OLD, closedAt: null, repo: "acme/secret", repoKey: "github:acme/secret", labels: [], assignee: null, milestone: null, url: "" },
    ];
    data.pullRequests = [];
    data.workflowRuns = [
      { id: "1", name: "ci", status: "completed", conclusion: "success", createdAt: RECENT, completedAt: null, headSha: "abc", repo: "acme/secret", repoKey: "github:acme/secret", branch: "main", workflowName: "CI", url: "" },
    ];
    return state("github", data);
  }

  test("stale counts exclude private repos when showPrivateRepoItems is off", () => {
    const agg = computeAggregates([ghState()], config);
    // The private stale issue must NOT leak into the card...
    expect(agg.staleWork?.staleIssues).toBe(0);
    // ...but the public in-window issue still counts.
    expect(agg.throughput?.issuesOpened ?? 0).toBe(1);
  });

  test("stale counts include private repos on the explicit operator opt-in", () => {
    const cfg = { ...config, privacy: { showPrivateRepoItems: true } };
    const agg = computeAggregates([ghState()], cfg);
    expect(agg.staleWork?.staleIssues).toBe(1);
    expect(agg.throughput?.issuesOpened ?? 0).toBe(1);
  });

  test("fail-closed: issues from repos missing from the map are excluded too", () => {
    const s = ghState();
    s.data!.issues.push({ id: "3", title: "ghost repo issue", state: "open", createdAt: OLD, updatedAt: OLD, closedAt: null, repo: "acme/unlisted", repoKey: "github:acme/unlisted", labels: [], assignee: null, milestone: null, url: "" });
    const agg = computeAggregates([s], config);
    expect(agg.staleWork?.staleIssues).toBe(0);
  });
});
